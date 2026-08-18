//! 路径适配引擎：检出文本资产中的旧机绝对路径，按用户确认的映射执行替换。
//! 编码铁律：只处理 UTF-8 无 BOM 文本；含 BOM 或非 UTF-8 的文件跳过并警告，绝不强行改写；
//! 替换后的写回不引入 BOM（字节级保持 UTF-8 无 BOM）。

use crate::error::AppResult;
use crate::packer::Manifest;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// UTF-8 BOM 字节头。
const BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

/// 建议映射（旧串 → 新串）与全包命中统计。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathSeed {
    pub old: String,
    pub new: String,
    pub total_hits: usize,
}

/// 单文件检出结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectFile {
    pub target_rel: String,
    pub total_hits: usize,
    /// 非 None 表示被跳过（含 BOM / 非 UTF-8），值为原因。
    pub skipped_reason: Option<String>,
}

/// 检出结果：建议映射 + 逐文件命中。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectResult {
    pub seeds: Vec<PathSeed>,
    pub files: Vec<DetectFile>,
}

/// 替换执行结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PathFixReport {
    /// 已替换的文件与替换次数。
    pub replaced: Vec<ReplacedFile>,
    /// 被跳过的文件与原因。
    pub skipped: Vec<SkippedFile>,
    /// 备份目录（备份开启且有替换时）。
    pub backup_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplacedFile {
    pub target_rel: String,
    pub replacements: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedFile {
    pub target_rel: String,
    pub reason: String,
}

/// 生成默认映射种子：旧机用户名 → 当前机用户名，覆盖四种书写形式
/// （Windows 反斜杠、正斜杠、Unix /Users、/home）与 JSON 转义的双反斜杠形式。
pub fn default_seeds(old_username: &str) -> Vec<(String, String)> {
    let new_username = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".into());
    let forms: Vec<(String, String)> = vec![
        (format!(r"C:\Users\{old_username}\"), format!(r"C:\Users\{new_username}\")),
        (format!("C:/Users/{old_username}/"), format!("C:/Users/{new_username}/")),
        (format!(r"C:\\Users\\{old_username}\\"), format!(r"C:\\Users\\{new_username}\\")),
        (format!("/Users/{old_username}/"), format!("/Users/{new_username}/")),
        (format!("/home/{old_username}/"), format!("/home/{new_username}/")),
    ];
    // 同名（新旧机用户名一致）时无需替换
    forms.into_iter().filter(|(o, n)| o != n).collect()
}

/// 读取文本文件为字符串；BOM/非 UTF-8 返回原因。
fn read_text(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读取失败：{e}"))?;
    if bytes.starts_with(BOM) {
        return Err("文件含 UTF-8 BOM，跳过改写以保安全".into());
    }
    String::from_utf8(bytes).map_err(|_| "文件不是有效 UTF-8，跳过改写".into())
}

/// 检出：在目标根下扫描清单中 needs_path_adapt 且 kind=text 的文件，
/// 统计各映射种子的命中次数（纯只读）。
pub fn detect(target_root: &Path, manifest: &Manifest) -> AppResult<DetectResult> {
    let seeds_src = default_seeds(&manifest.source.username);
    let mut seeds: Vec<PathSeed> = seeds_src
        .iter()
        .map(|(o, n)| PathSeed { old: o.clone(), new: n.clone(), total_hits: 0 })
        .collect();
    let mut files = Vec::new();

    for mf in &manifest.files {
        if !mf.needs_path_adapt || mf.kind != crate::scanner::FileKind::Text {
            continue;
        }
        let abs = crate::applier::safe_join(target_root, &mf.target_rel)?;
        if !abs.is_file() {
            files.push(DetectFile {
                target_rel: mf.target_rel.clone(),
                total_hits: 0,
                skipped_reason: Some("文件尚未解包到目标".into()),
            });
            continue;
        }
        let mut total = 0usize;
        let skipped = match read_text(&abs) {
            Ok(text) => {
                for (pair, slot) in seeds_src.iter().zip(seeds.iter_mut()) {
                    let c = text.matches(pair.0.as_str()).count();
                    slot.total_hits += c;
                    total += c;
                }
                None
            }
            Err(reason) => Some(reason),
        };
        files.push(DetectFile { target_rel: mf.target_rel.clone(), total_hits: total, skipped_reason: skipped });
    }
    Ok(DetectResult { seeds, files })
}

/// 执行替换：对目标根下 needs_path_adapt 文本文件应用 `mappings`（用户已确认的旧→新列表）。
/// `backup=true` 时替换前把原文件备份到 `<target_root>/zam-backups/<时间戳>/pathfix/<rel>`。
/// 无匹配内容的文件不写回（保持 mtime 不动）。
pub fn apply_mappings(
    target_root: &Path,
    manifest: &Manifest,
    mappings: &[(String, String)],
    backup: bool,
) -> AppResult<PathFixReport> {
    let mut replaced = Vec::new();
    let mut skipped = Vec::new();
    let mut any_replaced = false;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();

    for mf in &manifest.files {
        if !mf.needs_path_adapt || mf.kind != crate::scanner::FileKind::Text {
            continue;
        }
        let abs = crate::applier::safe_join(target_root, &mf.target_rel)?;
        if !abs.is_file() {
            skipped.push(SkippedFile { target_rel: mf.target_rel.clone(), reason: "文件尚未解包到目标".into() });
            continue;
        }
        let text = match read_text(&abs) {
            Ok(t) => t,
            Err(reason) => {
                skipped.push(SkippedFile { target_rel: mf.target_rel.clone(), reason });
                continue;
            }
        };
        let mut count = 0usize;
        let mut next = text.clone();
        for (old, new) in mappings {
            if old == new || old.is_empty() {
                continue;
            }
            let hits = next.matches(old.as_str()).count();
            if hits > 0 {
                next = next.replace(old.as_str(), new.as_str());
                count += hits;
            }
        }
        if count == 0 {
            continue; // 无变化不写回
        }
        // 备份原文件
        if backup {
            let backup_path = target_root
                .join(crate::applier::BACKUP_DIR)
                .join(&stamp)
                .join("pathfix")
                .join(&mf.target_rel);
            if let Some(p) = backup_path.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(&abs, &backup_path)?;
            any_replaced = true;
        }
        // 写回：UTF-8 无 BOM（String → bytes 不产生 BOM）
        std::fs::write(&abs, next.as_bytes())?;
        replaced.push(ReplacedFile { target_rel: mf.target_rel.clone(), replacements: count });
    }

    let backup_dir = if backup && any_replaced {
        Some(
            target_root
                .join(crate::applier::BACKUP_DIR)
                .join(&stamp)
                .to_string_lossy()
                .to_string(),
        )
    } else {
        None
    };
    Ok(PathFixReport { replaced, skipped, backup_dir })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packer::{pack, ManifestFile};
    use crate::profile::zcode::zcode_profile;
    use crate::profile::{category_ids_for_preset, Preset};
    use crate::scanner::FileKind;
    use std::fs;
    use tempfile::TempDir;

    /// 造一个含旧机路径的包并解包到目标根，返回 (目标根, manifest)。
    fn setup_target_with_paths() -> (TempDir, PathBuf2, Manifest) {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "规则").unwrap();
        fs::create_dir_all(root.join("cli")).unwrap();
        fs::write(
            root.join("cli/config.json"),
            r#"{"mcp":[{"cmd":"C:\\Users\\olduser\\AppData\\Local\\Programs\\Python\\py.exe"}],"log":"C:/Users/olduser/log"}"#,
        )
        .unwrap();
        let ids = category_ids_for_preset(&zcode_profile(), &Preset::Recommended);
        let pkg = dir.path().join("pf/pkg.zam");
        pack(&zcode_profile(), root, &ids, "recommended", &pkg, vec![], &mut |_, _, _| {}).unwrap();
        let mut manifest = crate::packer::read_manifest(&pkg).unwrap();
        // 测试脱离打包机环境：把来源用户名改写为内容中实际出现的旧机用户名
        manifest.source.username = "olduser".into();

        // 直接解包到目标根（复用 applier）
        let target = pkg.parent().unwrap().join("target");
        let plan = crate::applier::make_plan(&pkg, &manifest, &target, crate::applier::ApplyMode::Overwrite, &[]).unwrap();
        crate::applier::execute_apply_to(&plan, &target, &mut |_, _, _| {}).unwrap();
        (dir, PathBuf2 { pkg, target }, manifest)
    }

    /// 兼容测试的多值返回包装。
    struct PathBuf2 {
        pkg: std::path::PathBuf,
        target: std::path::PathBuf,
    }

    /// 检出：四种书写形式的旧路径全部命中。
    #[test]
    fn pathfix_detects_old_machine_paths() {
        let (_dir, p, manifest) = setup_target_with_paths();
        let result = detect(&p.target, &manifest).unwrap();
        assert!(!result.seeds.is_empty());
        let total: usize = result.seeds.iter().map(|s| s.total_hits).sum();
        assert!(total >= 2, "至少检出反斜杠与正斜杠两处，实际 {total}");
        let cfg = result.files.iter().find(|f| f.target_rel == "cli/config.json").unwrap();
        assert!(cfg.skipped_reason.is_none());
        assert!(cfg.total_hits >= 2);
    }

    /// 替换：内容正确、无 BOM 引入（字节级）、有备份。
    #[test]
    fn pathfix_replaces_and_preserves_utf8_no_bom() {
        let (_dir, p, manifest) = setup_target_with_paths();
        let det = detect(&p.target, &manifest).unwrap();
        let mappings: Vec<(String, String)> =
            det.seeds.iter().map(|s| (s.old.clone(), s.new.clone())).collect();
        let report = apply_mappings(&p.target, &manifest, &mappings, true).unwrap();

        assert_eq!(report.replaced.len(), 1);
        let cfg_path = p.target.join("cli/config.json");
        let bytes = fs::read(&cfg_path).unwrap();
        assert!(!bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "替换不得引入 BOM");
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains("olduser"), "旧用户名应被替换：{text}");
        // 备份存在且为旧内容
        let binding = report.backup_dir.clone().unwrap();
        let backup_root = Path::new(&binding);
        let backup_cfg = walk_find(backup_root, "config.json");
        let old = fs::read_to_string(&backup_cfg).unwrap();
        assert!(old.contains("olduser"));
    }

    /// 含 BOM 的文件被跳过并警告，内容不动。
    #[test]
    fn pathfix_skips_bom_files() {
        let dir = TempDir::new().unwrap();
        let target = dir.path();
        fs::create_dir_all(target.join("cli")).unwrap();
        let mut with_bom: Vec<u8> = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice(r#"{"cmd":"C:\Users\olduser\x"}"#.as_bytes());
        fs::write(target.join("cli/config.json"), &with_bom).unwrap();

        let manifest = Manifest {
            format_version: 1,
            app_version: "t".into(),
            created_at: String::new(),
            source: crate::packer::SourceInfo {
                os: "windows".into(),
                arch: "x86_64".into(),
                hostname: String::new(),
                username: "olduser".into(),
            },
            profile_id: "zcode".into(),
            profile_version: 1,
            preset: crate::packer::PresetInfo { kind: "recommended".into(), categories: vec![] },
            files: vec![ManifestFile {
                path: "payload/cli/config.json".into(),
                target_rel: "cli/config.json".into(),
                category: "main_config".into(),
                sha256: String::new(),
                size: 0,
                kind: FileKind::Text,
                needs_path_adapt: true,
            }],
            counts: crate::packer::ManifestCounts { files: 1, categories: 1 },
            total_bytes: 0,
            warnings: vec![],
        };
        let det = detect(target, &manifest).unwrap();
        assert!(det.files[0].skipped_reason.as_deref().unwrap().contains("BOM"));

        let report = apply_mappings(
            target,
            &manifest,
            &[(r"C:\Users\olduser\".into(), r"C:\Users\newuser\".into())],
            false,
        )
        .unwrap();
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.replaced.len(), 0);
        // 文件原样
        let now = fs::read(target.join("cli/config.json")).unwrap();
        assert_eq!(now, with_bom);
    }

    /// 新旧用户名相同时无种子（无需替换）。
    #[test]
    fn pathfix_no_seeds_when_same_username() {
        let current = std::env::var("USERNAME").unwrap_or_default();
        if current.is_empty() {
            return; // 环境无用户名时跳过该断言
        }
        let seeds = default_seeds(&current);
        assert!(seeds.is_empty(), "同用户名不应产生替换种子");
    }

    fn walk_find(root: &Path, name: &str) -> std::path::PathBuf {
        for e in walkdir::WalkDir::new(root) {
            let e = e.unwrap();
            if e.file_name().to_string_lossy() == name {
                return e.into_path();
            }
        }
        panic!("备份中找不到 {name}");
    }
}
