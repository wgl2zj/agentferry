//! 打包引擎：把选中类别压缩为 `.zam` 迁移包（实质 ZIP + 包根 manifest.json）。
//! 打包全程对源目录只读；每个入包文件记录 SHA-256，供解包复验。

use crate::error::{AppError, AppResult};
use crate::profile::{CategoryStrategy, Profile};
use crate::scanner::{self, FileKind, ScanReport};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

/// 当前包格式版本。
pub const FORMAT_VERSION: u32 = 1;

/// 包内负载目录前缀（与包根 manifest.json 隔离）。
const PAYLOAD_PREFIX: &str = "payload/";

/// 来源机信息（路径适配的种子来源）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceInfo {
    pub os: String,
    pub arch: String,
    pub hostname: String,
    pub username: String,
}

/// 档位记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetInfo {
    /// recommended / full / custom。
    pub kind: String,
    /// 实际选中的类别 id。
    pub categories: Vec<String>,
}

/// 清单中的单文件条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    /// 包内路径（payload/ 前缀）。
    pub path: String,
    /// 解包目标相对路径（相对档案根，`/` 分隔）。
    pub target_rel: String,
    pub category: String,
    pub sha256: String,
    pub size: u64,
    pub kind: FileKind,
    /// 是否需要路径适配（来自类别策略 CopyTextNeedsPathAdapt）。
    pub needs_path_adapt: bool,
}

/// 迁移包清单（包根 manifest.json）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub format_version: u32,
    pub app_version: String,
    pub created_at: String,
    pub source: SourceInfo,
    pub profile_id: String,
    pub profile_version: u32,
    pub preset: PresetInfo,
    pub files: Vec<ManifestFile>,
    pub counts: ManifestCounts,
    pub total_bytes: u64,
    /// 打包期已产生的警告（如"跳过会话历史库"）。
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestCounts {
    pub files: usize,
    pub categories: usize,
}

/// 打包结果摘要。
#[derive(Debug, Clone, Serialize)]
pub struct PackResult {
    pub output_path: String,
    pub package_bytes: u64,
    pub manifest: Manifest,
}

/// 收集来源机信息。
fn source_info() -> SourceInfo {
    SourceInfo {
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        hostname: std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".into()),
        username: std::env::var("USERNAME")
            .or_else(|_| std::env::var("USER"))
            .unwrap_or_else(|_| "unknown".into()),
    }
}

/// 进度回调：(已完成文件数, 总文件数, 当前文件相对路径)。
pub type ProgressFn<'a> = dyn FnMut(usize, usize, &str) + 'a;

/// 按文件种类选择 zip 压缩方法（经决策者拍板的方案 B，2026-08-18）：
/// SQLite 页式二进制压缩率只有 30%–60% 却吃掉打包耗时的大头（deflate
/// 单线程几十 MB/s），一律 Stored（仅存储）；文本/其余二进制压缩率高、
/// 体量小，保持 Deflated。迁移包是一次性搬运介质，不为省磁盘牺牲等待时间。
/// 决策约束：判定只走 FileKind，不按扩展名/大小阈值启发式；
/// manifest 不加压缩方法字段（新旧包互兼容，applier 不感知压缩方法）。
fn compression_for(kind: &FileKind) -> zip::CompressionMethod {
    match kind {
        FileKind::Sqlite => zip::CompressionMethod::Stored,
        _ => zip::CompressionMethod::Deflated,
    }
}

/// 打包入口：扫描选中类别 → 校验阻断 → 逐文件入包（边写边算哈希）→ 写清单。
///
/// 性能契约：
/// * 只扫描选中类别（未选中类别零触碰，含其内容读取）；
/// * 扫描期不算哈希，写包时对所写内容流式计算——同一文件只读一遍，
///   且哈希即所写内容，不存在"清单哈希与包内容不一致"的窗口。
///
/// * `warnings` 由调用方传入（如 UI 上"跳过会话历史库"的说明），原样写入清单。
/// * 选中类别存在 Blocked（WAL/SHM）时返回 `SourceNotQuiet`；跳过该库 = 不选它。
pub fn pack(
    profile: &Profile,
    root: &Path,
    category_ids: &[String],
    preset_kind: &str,
    output_path: &Path,
    warnings: Vec<String>,
    progress: &mut ProgressFn,
) -> AppResult<PackResult> {
    if !root.is_dir() {
        return Err(AppError::PathSetup(format!("打包根目录不存在：{}", root.display())));
    }
    let report = scanner::scan_selected(profile, root, category_ids)?;

    // 阻断校验：选中的 SQLite 类别若检测到 WAL/SHM，拒绝打包
    for cat_id in category_ids {
        if let Some(cr) = report.categories.iter().find(|c| &c.category_id == cat_id) {
            if let scanner::CategoryStatus::Blocked(reason) = &cr.status {
                return Err(AppError::SourceNotQuiet(format!("类别 {cat_id}：{reason}")));
            }
        }
    }

    // 汇总清单条目（保持类别顺序，类内文件按扫描序）
    // source_paths：rel → 源文件物理绝对路径（链接场景 root.join(rel) 要穿越
    // junction，提权进程被 Windows 拒绝 os error 448，会被 is_file 误判为文件消失）
    let mut files: Vec<ManifestFile> = Vec::new();
    let mut source_paths: std::collections::HashMap<String, std::path::PathBuf> =
        std::collections::HashMap::new();
    for cat_id in category_ids {
        let cat = profile
            .category(cat_id)
            .ok_or_else(|| AppError::InvalidPackage(format!("未知类别：{cat_id}")))?;
        if matches!(cat.strategy, CategoryStrategy::Excluded) {
            return Err(AppError::InvalidPackage(format!(
                "类别 {cat_id} 为排除项（缓存/凭据），不得入包"
            )));
        }
        let cr = report
            .categories
            .iter()
            .find(|c| &c.category_id == cat_id)
            .ok_or_else(|| AppError::Internal(format!("盘点缺少类别 {cat_id}")))?;
        let needs_adapt = matches!(cat.strategy, CategoryStrategy::CopyTextNeedsPathAdapt);
        for f in &cr.files {
            source_paths.insert(f.rel_path.clone(), f.source_abs.clone());
            files.push(ManifestFile {
                path: format!("{PAYLOAD_PREFIX}{}", f.rel_path),
                target_rel: f.rel_path.clone(),
                category: cat.id.clone(),
                sha256: f.sha256.clone(),
                size: f.size,
                kind: f.kind,
                needs_path_adapt: needs_adapt,
            });
        }
    }
    let total_files = files.len();
    let total_bytes = files.iter().map(|f| f.size).sum();

    // 选中类别的档案级警告追加在调用方传入警告之后（经决策者授权的 packer 增量例外：
    // 文案沉在档案数据里，打包确认页经 list_profiles 拿到的是同一字符串，同源展示）
    let mut all_warnings = warnings;
    for cat_id in category_ids {
        if let Some(w) = profile
            .category(cat_id)
            .and_then(|c| c.pack_warning.clone())
        {
            all_warnings.push(w);
        }
    }

    let mut manifest = Manifest {
        format_version: FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: Utc::now().to_rfc3339(),
        source: source_info(),
        profile_id: profile.id.clone(),
        profile_version: profile.version,
        preset: PresetInfo {
            kind: preset_kind.into(),
            categories: category_ids.to_vec(),
        },
        files,
        counts: ManifestCounts { files: total_files, categories: category_ids.len() },
        total_bytes,
        warnings: all_warnings,
    };

    // 写包
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let out_file = File::create(output_path)?;
    let mut zip = zip::ZipWriter::new(out_file);

    for (idx, mf) in manifest.files.iter_mut().enumerate() {
        // 优先物理源路径（链接内文件）；无映射时回退 root.join（兼容反序列化的报告）
        let abs = source_paths
            .get(&mf.target_rel)
            .cloned()
            .unwrap_or_else(|| root.join(&mf.target_rel));
        if !abs.is_file() {
            return Err(AppError::InvalidPackage(format!("打包时源文件消失：{}", mf.target_rel)));
        }
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(compression_for(&mf.kind));
        zip.start_file(&mf.path, options)
            .map_err(|e| AppError::Internal(format!("zip 写入失败 {}: {e}", mf.path)))?;
        let mut src = File::open(&abs)?;
        // 流式写入并对所写内容同步计算哈希：源文件只读一遍，哈希必与包内容一致
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = src.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            zip.write_all(&buf[..n])?;
        }
        mf.sha256 = hex::encode(hasher.finalize());
        progress(idx + 1, total_files, &mf.target_rel);
    }

    // 清单最后写入包根（JSON 文本，保持 Deflated）
    let manifest_str = serde_json::to_string_pretty(&manifest)
        .map_err(|e| AppError::Internal(format!("manifest 序列化失败：{e}")))?;
    let manifest_options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", manifest_options)
        .map_err(|e| AppError::Internal(format!("写入 manifest 失败：{e}")))?;
    zip.write_all(manifest_str.as_bytes())?;
    zip.finish()
        .map_err(|e| AppError::Internal(format!("收尾 zip 失败：{e}")))?;

    let package_bytes = output_path.metadata()?.len();
    Ok(PackResult { output_path: output_path.to_string_lossy().to_string(), package_bytes, manifest })
}

/// 读取 `.zam` 包内的 manifest.json（不做哈希校验，校验见 applier::open_package）。
pub fn read_manifest(package_path: &Path) -> AppResult<Manifest> {
    let file = File::open(package_path)
        .map_err(|e| AppError::InvalidPackage(format!("打开迁移包失败：{e}")))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::InvalidPackage(format!("不是有效的 .zam/ZIP 包：{e}")))?;
    let mut entry = zip
        .by_name("manifest.json")
        .map_err(|_| AppError::InvalidPackage("包内缺少 manifest.json".into()))?;
    let mut text = String::new();
    entry
        .read_to_string(&mut text)
        .map_err(|e| AppError::InvalidPackage(format!("manifest.json 读取失败：{e}")))?;
    let manifest: Manifest = serde_json::from_str(&text)
        .map_err(|e| AppError::InvalidPackage(format!("manifest.json 解析失败：{e}")))?;
    if manifest.format_version != FORMAT_VERSION {
        return Err(AppError::InvalidPackage(format!(
            "包格式版本 {} 不受支持（当前支持 {}）",
            manifest.format_version, FORMAT_VERSION
        )));
    }
    Ok(manifest)
}

/// 供测试复用：打开包内指定文件并读出全部字节（生产路径已全部改为
/// 归档只开一次的流式读取，无调用方；测试断言包内容时使用）。
#[cfg(test)]
pub(crate) fn read_entry(package_path: &Path, entry_path: &str) -> AppResult<Vec<u8>> {
    let file = File::open(package_path)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::InvalidPackage(format!("包损坏：{e}")))?;
    let mut entry = zip
        .by_name(entry_path)
        .map_err(|_| AppError::InvalidPackage(format!("包内缺少 {entry_path}")))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .map_err(|e| AppError::InvalidPackage(format!("读取 {entry_path} 失败：{e}")))?;
    Ok(buf)
}

/// 从盘点报告提取选中类别的文件总数（供 UI 预估）。
pub fn estimate_files(report: &ScanReport, category_ids: &[String]) -> usize {
    report
        .categories
        .iter()
        .filter(|c| category_ids.contains(&c.category_id))
        .map(|c| c.files.len())
        .sum()
}

/// 把路径转为跨平台稳定字符串（工具函数，applier/pathfix 共用）。
pub fn to_rel_string(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::zcode::zcode_profile;
    use std::fs;
    use tempfile::TempDir;

    fn make_fake_tree() -> TempDir {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "# 规则\n").unwrap();
        fs::create_dir_all(root.join("skills/animate")).unwrap();
        fs::write(root.join("skills/animate/SKILL.md"), "技能内容".repeat(10)).unwrap();
        fs::create_dir_all(root.join("cli")).unwrap();
        fs::write(root.join("cli/config.json"), r#"{"mcp":"C:\\Users\\old\\py.exe"}"#).unwrap();
        fs::create_dir_all(root.join("cli/db")).unwrap();
        fs::write(root.join("cli/db/db.sqlite"), "sqlite-bytes-0123456789").unwrap();
        fs::write(root.join("cli/db/db.sqlite-wal"), "wal").unwrap();
        fs::create_dir_all(root.join("v2")).unwrap();
        fs::write(root.join("v2/credentials.json"), "enc:v1:secret").unwrap();
        fs::create_dir_all(root.join("cli/log")).unwrap();
        fs::write(root.join("cli/log/run.log"), "日志".repeat(100)).unwrap();
        dir
    }

    fn recommended_ids() -> Vec<String> {
        crate::profile::category_ids_for_preset(
            &zcode_profile(),
            &crate::profile::Preset::Recommended,
        )
    }

    /// 链接内源文件经物理路径入包：junction/symlink 技能打包成功且包内容正确。
    /// 真实事故（2026-08-17）回归锁：提权进程用 root.join(rel) 穿越链接路径读源
    /// 被拒（os error 448），is_file 误判为"源文件消失"。
    #[test]
    fn packer_packs_linked_sources_via_physical_path() {
        let external = TempDir::new().unwrap();
        let skill = external.path().join("linked-skill");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "外链技能内容").unwrap();

        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "规则").unwrap();
        let link = root.join("skills").join("linked-skill");
        fs::create_dir_all(root.join("skills")).unwrap();
        #[cfg(windows)]
        junction::create(&skill, &link).unwrap();
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(&skill, &link).unwrap();

        let out = dir.path().join("pkg/包.zam");
        let ids = vec!["skills".to_string()];
        pack(&zcode_profile(), root, &ids, "custom", &out, vec![], &mut |_, _, _| {})
            .expect("链接技能打包失败");

        let manifest = read_manifest(&out).unwrap();
        let entry = manifest
            .files
            .iter()
            .find(|f| f.target_rel == "skills/linked-skill/SKILL.md")
            .expect("链接技能未入包");
        let bytes = read_entry(&out, &entry.path).unwrap();
        assert_eq!(String::from_utf8(bytes).unwrap(), "外链技能内容");
    }

    /// 打包 → 清单字段齐全 → 包内容与源一致且哈希吻合。
    #[test]
    fn packer_roundtrip_manifest_and_hashes() {
        let dir = make_fake_tree();
        let out = dir.path().join("out/迁移包.zam");
        let ids = recommended_ids();
        let mut calls = 0usize;
        let result = pack(
            &zcode_profile(),
            dir.path(),
            &ids,
            "recommended",
            &out,
            vec![],
            &mut |done, total, _rel| {
                calls += 1;
                assert!(done <= total);
            },
        )
        .unwrap();

        assert!(out.is_file());
        let m = &result.manifest;
        assert_eq!(m.format_version, 1);
        assert_eq!(m.profile_id, "zcode");
        assert_eq!(m.preset.kind, "recommended");
        assert_eq!(m.counts.files, m.files.len());
        assert!(!m.source.username.is_empty());
        // 进度回调按文件计数推进
        assert_eq!(calls, m.files.len());

        // 读回清单与文件内容：哈希吻合、needs_path_adapt 正确
        let readback = read_manifest(&out).unwrap();
        assert_eq!(readback.files.len(), m.files.len());
        for mf in &readback.files {
            let bytes = read_entry(&out, &mf.path).unwrap();
            use sha2::{Digest, Sha256};
            let sha = hex::encode(Sha256::digest(&bytes));
            assert_eq!(sha, mf.sha256, "包内文件 {} 哈希与清单不符", mf.path);
            if mf.category == "main_config" {
                assert!(mf.needs_path_adapt);
                assert_eq!(mf.kind, FileKind::Text);
            }
            if mf.category == "skills" {
                assert!(!mf.needs_path_adapt);
            }
        }
        // config.json 内容原样入包
        let cfg = read_entry(&out, "payload/cli/config.json").unwrap();
        assert!(String::from_utf8(cfg).unwrap().contains(r"C:\\Users\\old\\py.exe"));
    }

    /// 反向测试：打包前后源目录零变化（内容与 mtime）。
    #[test]
    fn packer_source_stays_untouched() {
        let dir = make_fake_tree();
        let before = snapshot(dir.path());
        let out = dir.path().join("包.zam");
        pack(&zcode_profile(), dir.path(), &recommended_ids(), "recommended", &out, vec![], &mut |_, _, _| {})
            .unwrap();
        let after = snapshot(dir.path());
        // 排除打包产物自身后比对
        let filter = |v: Vec<(String, u64, std::time::SystemTime)>| {
            v.into_iter().filter(|(p, _, _)| p != "包.zam").collect::<Vec<_>>()
        };
        assert_eq!(filter(before), filter(after), "打包不得修改源目录任何文件");
    }

    /// 反向测试：排除项（凭据/缓存）绝不出现在包与清单中。
    #[test]
    fn packer_excluded_never_enters_package() {
        let dir = make_fake_tree();
        let out = dir.path().join("包.zam");
        let result = pack(
            &zcode_profile(),
            dir.path(),
            &recommended_ids(),
            "recommended",
            &out,
            vec![],
            &mut |_, _, _| {},
        )
        .unwrap();
        let all_paths: Vec<String> = result.manifest.files.iter().map(|f| f.target_rel.clone()).collect();
        assert!(!all_paths.iter().any(|p| p.contains("credentials")));
        assert!(!all_paths.iter().any(|p| p.contains("log/") || p.contains("image-cache")));
        // 物理读取包内全部条目名再核验一次
        let file = File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        for i in 0..zip.len() {
            let name = zip.by_index(i).unwrap().name().to_string();
            assert!(!name.contains("credentials"), "凭据泄漏进包：{name}");
            assert!(!name.contains("cli/log/"), "缓存泄漏进包：{name}");
        }
    }

    /// WAL 存在的 SQLite 类别被选中 → 拒绝打包（SourceNotQuiet）；
    /// 跳过该库（不选）后可打包，且警告写入清单。
    #[test]
    fn packer_blocked_sqlite_rejected_and_skippable() {
        let dir = make_fake_tree();
        let full_ids = crate::profile::category_ids_for_preset(
            &zcode_profile(),
            &crate::profile::Preset::Full,
        );
        let err = pack(&zcode_profile(), dir.path(), &full_ids, "full", &dir.path().join("包.zam"), vec![], &mut |_, _, _| {}).unwrap_err();
        assert_eq!(err.code(), "source_not_quiet");

        // 跳过会话历史（去掉 session_db）
        let skip_ids: Vec<String> = full_ids.into_iter().filter(|id| id != "session_db").collect();
        let out = dir.path().join("跳过.zam");
        let result = pack(
            &zcode_profile(),
            dir.path(),
            &skip_ids,
            "full",
            &out,
            vec!["会话历史库检测到 WAL，按用户选择跳过".into()],
            &mut |_, _, _| {},
        )
        .unwrap();
        assert_eq!(result.manifest.warnings.len(), 1);
        assert!(result.manifest.warnings[0].contains("跳过"));
        let readback = read_manifest(&out).unwrap();
        assert!(!readback.files.iter().any(|f| f.category == "session_db"));
    }

    /// 直接要求打包排除类别 → 拒绝（防御 UI 层误传）。
    #[test]
    fn packer_rejects_excluded_category_selection() {
        let dir = make_fake_tree();
        let err = pack(
            &zcode_profile(),
            dir.path(),
            &["credentials".to_string()],
            "custom",
            &dir.path().join("x.zam"),
            vec![],
            &mut |_, _, _| {},
        )
        .unwrap_err();
        assert_eq!(err.code(), "invalid_package");
    }

    /// 构造 Codex 最小假树（含凭据/缓存排除项与 token 配置）。
    fn make_fake_codex_tree() -> TempDir {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "# codex 规则\n").unwrap();
        fs::write(root.join("config.toml"), "experimental_bearer_token = \"sk-x\"\n").unwrap();
        fs::create_dir_all(root.join("skills/.system/imagegen")).unwrap();
        fs::write(root.join("skills/.system/imagegen/SKILL.md"), "系统技能").unwrap();
        fs::write(root.join("memories_1.sqlite"), "mem-db-bytes").unwrap();
        fs::write(root.join("session_index.jsonl"), "{\"p\":\"C:\\\\Users\\\\old\\\\x\"}\n").unwrap();
        // 排除项：凭据与巨型日志
        fs::write(root.join("auth.json"), "{\"token\":\"secret\"}").unwrap();
        fs::write(root.join("logs_2.sqlite"), "750MB-logs").unwrap();
        fs::write(root.join("logs_2.sqlite-wal"), "wal").unwrap();
        dir
    }

    /// 构造 Claude 最小假树（含凭据字段名排除项与 token 配置）。
    fn make_fake_claude_tree() -> TempDir {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("settings.json"), r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"k"}}"#).unwrap();
        fs::create_dir_all(root.join("skills/docx")).unwrap();
        fs::write(root.join("skills/docx/SKILL.md"), "技能").unwrap();
        fs::write(root.join("history.jsonl"), "{\"q\":\"hi\"}\n").unwrap();
        fs::write(root.join("config.json"), r#"{"primaryApiKey":"any"}"#).unwrap();
        fs::write(root.join(".last-cleanup"), "cache-marker").unwrap();
        dir
    }

    /// 经决策者授权的 packer 增量例外：选中携带 pack_warning 的类别时，
    /// manifest.warnings 含该确切字符串（调用方传入警告在前、档案警告在后）。
    #[test]
    fn packer_pack_warnings_enter_manifest() {
        let cases: Vec<(&str, TempDir, Vec<&str>)> = vec![
            ("codex", make_fake_codex_tree(), vec!["global_rules", "main_config"]),
            ("claude", make_fake_claude_tree(), vec!["settings", "skills"]),
        ];
        for (profile_id, dir, ids) in cases {
            let profile = crate::commands::profile_by_id(profile_id).unwrap();
            let cat_ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
            let out = dir.path().join(format!("{profile_id}-包.zam"));
            pack(
                &profile,
                dir.path(),
                &cat_ids,
                "recommended",
                &out,
                vec!["调用方警告".into()],
                &mut |_, _, _| {},
            )
            .unwrap();
            let readback = read_manifest(&out).unwrap();
            // 调用方警告在前，档案警告按选中顺序追加
            assert_eq!(readback.warnings[0], "调用方警告");
            let expected = profile
                .categories
                .iter()
                .filter(|c| ids.contains(&c.id.as_str()))
                .filter_map(|c| c.pack_warning.clone())
                .collect::<Vec<_>>();
            assert_eq!(&readback.warnings[1..], &expected[..], "{profile_id} 档案警告应原样入 manifest");
            assert!(readback.warnings.iter().any(|w| w.contains("API 凭据")), "{profile_id} 缺 token 警告");
        }
    }

    /// zcode 回归锁：档案无任何 pack_warning → manifest.warnings 与传入完全一致
    /// （证明授权例外对既有档案零行为变化）。
    #[test]
    fn packer_zcode_warnings_unchanged_by_pack_warning() {
        let dir = make_fake_tree();
        let out = dir.path().join("回归.zam");
        let passed_in = vec!["用户跳过说明".to_string()];
        let result = pack(
            &zcode_profile(),
            dir.path(),
            &recommended_ids(),
            "recommended",
            &out,
            passed_in.clone(),
            &mut |_, _, _| {},
        )
        .unwrap();
        assert_eq!(result.manifest.warnings, passed_in, "zcode 打包 warnings 必须与传入逐字节一致");
    }

    /// pack_warning=None 的类别不产生任何新增警告。
    #[test]
    fn packer_none_pack_warning_adds_nothing() {
        let dir = make_fake_codex_tree();
        let out = dir.path().join("仅技能.zam");
        let result = pack(
            &crate::commands::profile_by_id("codex").unwrap(),
            dir.path(),
            &["skills".to_string()],
            "custom",
            &out,
            vec![],
            &mut |_, _, _| {},
        )
        .unwrap();
        assert!(result.manifest.warnings.is_empty(), "None 类别不得产生警告");
    }

    /// 新档案排除项不入包（auth.json / config.json 等凭据与缓存）：
    /// manifest 与 zip 物理条目双重核验（吸取 zcode 事故教训：排除项双验）。
    #[test]
    fn packer_new_profiles_excluded_never_enters_package() {
        let cases: Vec<(&str, TempDir, Vec<&str>)> = vec![
            ("codex", make_fake_codex_tree(), vec!["main_config", "skills", "memories_db", "session_index"]),
            ("claude", make_fake_claude_tree(), vec!["settings", "skills", "history"]),
        ];
        for (profile_id, dir, ids) in cases {
            let profile = crate::commands::profile_by_id(profile_id).unwrap();
            let cat_ids: Vec<String> = ids.iter().map(|s| s.to_string()).collect();
            let out = dir.path().join(format!("{profile_id}-排除验.zam"));
            let result = pack(&profile, dir.path(), &cat_ids, "full", &out, vec![], &mut |_, _, _| {})
                .unwrap();
            for forbidden in ["auth.json", "logs_2", "config.json", ".last-cleanup", "primaryApiKey"] {
                assert!(
                    !result.manifest.files.iter().any(|f| f.target_rel.contains(forbidden)),
                    "{profile_id}：排除项 {forbidden} 泄漏进 manifest"
                );
            }
            let file = File::open(&out).unwrap();
            let mut zip = zip::ZipArchive::new(file).unwrap();
            for i in 0..zip.len() {
                let name = zip.by_index(i).unwrap().name().to_string();
                for forbidden in ["auth.json", "logs_2", "config.json", ".last-cleanup"] {
                    assert!(!name.contains(forbidden), "{profile_id}：排除项 {forbidden} 泄漏进 zip：{name}");
                }
            }
        }
    }

    fn snapshot(root: &Path) -> Vec<(String, u64, std::time::SystemTime)> {
        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
            let e = entry.unwrap();
            if e.file_type().is_file() {
                out.push((
                    e.path().strip_prefix(root).unwrap().to_string_lossy().to_string(),
                    e.metadata().unwrap().len(),
                    e.metadata().unwrap().modified().unwrap(),
                ));
            }
        }
        out
    }

    /// 压缩策略行为锁（decide-k3 拍板方案 B，2026-08-18）：Sqlite 条目 Stored、
    /// 其余 Deflated；Stored 条目读回与源字节一致（不压缩不得引入损坏）。
    #[test]
    fn packer_sqlite_stored_others_deflated() {
        let dir = make_fake_tree();
        let root = dir.path();
        // 无 WAL 的 sqlite 库（tasks_index 为 Full 档 File 规则；session_db 有 WAL 会被阻断）
        fs::write(root.join("v2/tasks-index.sqlite"), "idx-bytes-0123456789").unwrap();
        let full_ids = crate::profile::category_ids_for_preset(
            &zcode_profile(),
            &crate::profile::Preset::Full,
        );
        let ids: Vec<String> = full_ids.into_iter().filter(|id| id != "session_db").collect();
        let out = root.join("压缩.zam");
        pack(&zcode_profile(), root, &ids, "full", &out, vec![], &mut |_, _, _| {}).unwrap();

        let manifest = read_manifest(&out).unwrap();
        let file = File::open(&out).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut seen_sqlite = false;
        for mf in &manifest.files {
            let comp = zip.by_name(&mf.path).unwrap().compression();
            match mf.kind {
                FileKind::Sqlite => {
                    seen_sqlite = true;
                    assert_eq!(comp, zip::CompressionMethod::Stored, "{} 应 Stored", mf.target_rel);
                }
                _ => {
                    assert_eq!(comp, zip::CompressionMethod::Deflated, "{} 应 Deflated", mf.target_rel);
                }
            }
        }
        assert!(seen_sqlite, "测试树必须含 sqlite 条目");
        let mf = manifest.files.iter().find(|f| f.kind == FileKind::Sqlite).unwrap();
        let bytes = read_entry(&out, &mf.path).unwrap();
        assert_eq!(bytes, fs::read(root.join(&mf.target_rel)).unwrap(), "Stored 条目内容与源不一致");
    }

    /// 打包耗时与未选中类别的文件数无关（scan_selected 性能面锁）：选中 skills
    /// 打包，未选中的 rollout 目录 200 vs 2000 文件，耗时应基本持平；若回归为
    /// 全量扫描，大集合那次要多枚举+读 1800 个文件，比例显著恶化。
    #[test]
    fn packer_pack_time_ignores_unselected_categories() {
        let (small, out_small) = make_tree_with_rollout(200);
        let (large, out_large) = make_tree_with_rollout(2000);
        let ids = vec!["skills".to_string()];

        let t0 = std::time::Instant::now();
        pack(&zcode_profile(), small.path(), &ids, "custom", &out_small, vec![], &mut |_, _, _| {})
            .unwrap();
        let d_small = t0.elapsed();

        let t1 = std::time::Instant::now();
        pack(&zcode_profile(), large.path(), &ids, "custom", &out_large, vec![], &mut |_, _, _| {})
            .unwrap();
        let d_large = t1.elapsed();

        assert!(
            d_large.as_millis() as f64 <= d_small.as_millis().max(1) as f64 * 2.5,
            "打包耗时随未选中类别文件数恶化：200 文件 {d_small:?} vs 2000 文件 {d_large:?}"
        );
    }

    fn make_tree_with_rollout(n: usize) -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "# 规则\n").unwrap();
        fs::create_dir_all(root.join("skills/animate")).unwrap();
        fs::write(root.join("skills/animate/SKILL.md"), "技能内容".repeat(20)).unwrap();
        let rollout = root.join("cli/rollout");
        fs::create_dir_all(&rollout).unwrap();
        for i in 0..n {
            fs::write(rollout.join(format!("r{i:04}.jsonl")), format!("{{\"i\":{i}}}").repeat(50))
                .unwrap();
        }
        let out = root.join("pkg/包.zam");
        (dir, out)
    }
}
