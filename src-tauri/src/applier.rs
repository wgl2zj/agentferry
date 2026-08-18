//! 解包引擎：校验 `.zam` 包 → dry-run 变更计划（四组动作）→ 确认后执行（备份→写入→复验）。
//! 安全铁律：计划未确认（令牌不符）绝不写目标；两种模式都不删除目标任何已有文件；
//! 任何"替换已存在文件"的动作执行前先把原文件备份到 `zam-backups/<时间戳>/`。

use crate::error::{AppError, AppResult};
use crate::packer::{self, Manifest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// 备份根目录名（位于解包目标根下）。
pub const BACKUP_DIR: &str = "zam-backups";
/// 备份保留次数上限；超过时返回提示（不静默删除）。
pub const BACKUP_KEEP: usize = 5;

/// 解包模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApplyMode {
    /// 覆盖：冲突文件备份后替换。
    Overwrite,
    /// 增量：冲突默认保留目标，可逐条改判为替换。
    Incremental,
}

/// 单文件动作判定。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    /// 包有、目标无 → 写入。
    Create,
    /// 都有且哈希一致 → 跳过。
    SkipSame,
    /// 都有且哈希不同 → 见 mode/override：Replace=备份后替换，Keep=保留目标。
    Replace,
    Keep,
}

/// dry-run 计划中的单条动作。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanItem {
    pub target_rel: String,
    pub category: String,
    pub sha256: String,
    pub size: u64,
    pub action: ActionKind,
    /// 冲突文件当前目标侧哈希（仅冲突时有值，供 UI 展示差异）。
    pub target_sha256: Option<String>,
}

/// dry-run 变更计划。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyPlan {
    /// 参与的包路径（执行时核对）。
    pub package_path: String,
    /// 解包目标根目录（执行与令牌校验均以此为准，防生成计划后目标被篡改）。
    pub target_root: String,
    pub mode: ApplyMode,
    /// 包内文件的 SHA-256 快照（执行时核对，防包被调包）。
    pub package_digest: String,
    pub items: Vec<PlanItem>,
    /// 计划摘要令牌：execute_apply 必须原样回传且与重算一致。
    pub plan_token: String,
    /// 用户确认的冲突改判清单（增量模式）。执行时据此独立重放核对，
    /// 不得从 items 反推（防计划被篡改后自我认证）。
    pub confirmed_overrides: Vec<String>,
    /// 执行前的备份清理提示（备份超限时非空）。
    pub backup_cleanup_hint: Option<String>,
}

/// 打开并完整校验包（manifest 解析 + 逐文件哈希校验）。
/// 返回清单与逐文件校验进度回调（已校验数、总数、相对路径）。
/// 性能约束：归档全程只打开一次——每文件重开归档会各自完整解析一遍
/// 中央目录，文件数 N 时总代价 O(N²)，且逐文件整块进内存会令峰值内存
/// 等于包内最大文件；此处统一 64KB 流式哈希。
pub fn open_package(
    package_path: &Path,
    progress: &mut packer::ProgressFn,
) -> AppResult<Manifest> {
    let manifest = packer::read_manifest(package_path)?;
    let total = manifest.files.len();
    let file = File::open(package_path)?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| AppError::InvalidPackage(format!("包损坏：{e}")))?;
    for (idx, mf) in manifest.files.iter().enumerate() {
        let mut entry = zip
            .by_name(&mf.path)
            .map_err(|_| AppError::InvalidPackage(format!("包内缺少 {}", mf.path)))?;
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        drop(entry); // 归还借用，供下一条目使用
        let sha = hex::encode(hasher.finalize());
        if sha != mf.sha256 {
            return Err(AppError::HashMismatch(format!(
                "包内文件 {} 校验失败（清单 {}，实际 {}）",
                mf.target_rel, mf.sha256, sha
            )));
        }
        progress(idx + 1, total, &mf.target_rel);
    }
    Ok(manifest)
}

/// 计算包整体摘要（全部文件哈希的再哈希，防执行前包被调包）。
fn package_digest(manifest: &Manifest) -> String {
    let mut hasher = Sha256::new();
    for f in &manifest.files {
        hasher.update(f.target_rel.as_bytes());
        hasher.update(f.sha256.as_bytes());
    }
    hex::encode(hasher.finalize())
}

/// 计划摘要令牌：包摘要 + 模式 + 目标根目录 + 全部动作的哈希。任一要素变化令牌即失效。
fn plan_token(package_digest: &str, mode: ApplyMode, target_root: &str, items: &[PlanItem]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(package_digest.as_bytes());
    hasher.update(format!("{mode:?}").as_bytes());
    hasher.update(target_root.as_bytes());
    for it in items {
        hasher.update(it.target_rel.as_bytes());
        hasher.update(it.sha256.as_bytes());
        hasher.update(format!("{:?}", it.action).as_bytes());
    }
    hex::encode(hasher.finalize())
}

/// 生成 dry-run 计划（纯只读：只读包与目标目录，不写任何文件）。
///
/// * `target_root`：解包目标根目录（显式指定；UI 默认按档案推导为该软件的本机资产目录）。
/// * `conflict_overrides`：增量模式下把指定 target_rel 的冲突改判为"备份后替换"。
///   覆盖模式忽略该参数（全部冲突本来就是替换）。
pub fn plan_apply(
    package_path: &Path,
    target_root: &Path,
    mode: ApplyMode,
    conflict_overrides: &[String],
    progress: &mut packer::ProgressFn,
) -> AppResult<ApplyPlan> {
    let manifest = open_package(package_path, progress)?;
    make_plan(package_path, &manifest, target_root, mode, conflict_overrides)
}

/// zip-slip 防护（共享校验，make_plan 与 pathfix 统一调用）：
/// 拒绝空路径、含反斜杠、含 `..`、以 `/` 开头、含盘符冒号的相对路径；
/// 并做兜底断言——join 后词法归一化的绝对路径必须仍在 `target_root` 前缀下。
pub fn safe_join(target_root: &Path, rel: &str) -> AppResult<PathBuf> {
    if rel.is_empty()
        || rel.contains('\\')
        || rel.contains("..")
        || rel.starts_with('/')
        || rel.contains(':')
    {
        return Err(AppError::InvalidPackage(format!("清单包含不安全路径：{rel}")));
    }
    let abs = target_root.join(rel);
    let normalized = lexical_normalize(&abs);
    if !normalized.starts_with(target_root) {
        return Err(AppError::InvalidPackage(format!("路径逃逸目标根：{rel}")));
    }
    Ok(abs)
}

/// 词法路径归一化（不触碰文件系统）：消除 `.` 与 `..` 段。
fn lexical_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// 允许 UI 指定其他目标根（自定义解包位置）。
pub fn make_plan(
    package_path: &Path,
    manifest: &Manifest,
    target_root: &Path,
    mode: ApplyMode,
    conflict_overrides: &[String],
) -> AppResult<ApplyPlan> {
    let digest = package_digest(manifest);
    let mut items = Vec::with_capacity(manifest.files.len());
    for mf in &manifest.files {
        let abs = safe_join(target_root, &mf.target_rel)?;
        // 目标哈希只算一次（存在时），判定与展示复用
        let existing_sha = if abs.is_file() { Some(sha256_of(&abs)?) } else { None };
        let action = match &existing_sha {
            None => ActionKind::Create,
            Some(t) if *t == mf.sha256 => ActionKind::SkipSame,
            Some(_) => match mode {
                ApplyMode::Overwrite => ActionKind::Replace,
                ApplyMode::Incremental => {
                    if conflict_overrides.contains(&mf.target_rel) {
                        ActionKind::Replace
                    } else {
                        ActionKind::Keep
                    }
                }
            },
        };
        items.push(PlanItem {
            target_rel: mf.target_rel.clone(),
            category: mf.category.clone(),
            sha256: mf.sha256.clone(),
            size: mf.size,
            action,
            target_sha256: existing_sha,
        });
    }
    let target_root_str = target_root.to_string_lossy().to_string();
    let token = plan_token(&digest, mode, &target_root_str, &items);
    let backup_cleanup_hint = check_backup_retention(target_root);
    Ok(ApplyPlan {
        package_path: package_path.to_string_lossy().to_string(),
        target_root: target_root_str,
        mode,
        package_digest: digest,
        items,
        plan_token: token,
        confirmed_overrides: conflict_overrides.to_vec(),
        backup_cleanup_hint,
    })
}

/// 备份保留检查：超过 BACKUP_KEEP 次时返回提示（不删除）。
fn check_backup_retention(target_root: &Path) -> Option<String> {
    let backup_root = target_root.join(BACKUP_DIR);
    let Ok(entries) = std::fs::read_dir(&backup_root) else {
        return None;
    };
    let stamps: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    if stamps.len() >= BACKUP_KEEP {
        Some(format!(
            "备份目录已有 {} 次历史备份（保留上限 {} 次），建议清理旧备份后继续；本次将继续创建新备份",
            stamps.len(),
            BACKUP_KEEP
        ))
    } else {
        None
    }
}

/// 执行结果。
#[derive(Debug, Clone, Serialize)]
pub struct ApplyReport {
    pub target_root: String,
    pub executed: Vec<ExecutedItem>,
    pub backup_dir: Option<String>,
    pub verified_files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecutedItem {
    pub target_rel: String,
    pub action: ActionKind,
    /// 执行结果（ok=已写入并复验，skipped=计划内跳过）。
    pub status: &'static str,
}

/// 执行已确认的计划。
///
/// 安全检查（任一不符即拒绝，目标零写入）：
/// 1. `plan.plan_token` 与重算一致（计划未被篡改，含目标根目录）；
/// 2. `plan.package_digest` 与包当前摘要一致（包未被调包）；
/// 3. 执行动作只可能是 Create / Replace / SkipSame / Keep——不存在删除。
pub fn execute_apply(
    plan: &ApplyPlan,
    progress: &mut packer::ProgressFn,
) -> AppResult<ApplyReport> {
    let target_root = PathBuf::from(&plan.target_root);
    execute_apply_to(plan, &target_root, progress)
}

/// 执行已确认的计划到指定目标根（execute_apply 的可指定目标版本，测试与自定义解包路径共用）。
pub fn execute_apply_to(
    plan: &ApplyPlan,
    target_root: &Path,
    progress: &mut packer::ProgressFn,
) -> AppResult<ApplyReport> {
    let package_path = PathBuf::from(&plan.package_path);
    if !package_path.is_file() {
        return Err(AppError::InvalidPackage(format!("迁移包不存在：{}", plan.package_path)));
    }
    let manifest = packer::read_manifest(&package_path)?;

    // 第一道：传入计划的 items 摘要必须与其令牌一致（防计划对象被篡改后仍持有旧令牌）
    let items_digest = plan_token(&plan.package_digest, plan.mode, &plan.target_root, &plan.items);
    if items_digest != plan.plan_token {
        return Err(AppError::PlanNotConfirmed(
            "计划令牌校验失败：计划内容与令牌不符，请重新生成计划".into(),
        ));
    }
    // 第二道：独立重放核对——用计划携带的"用户确认改判清单"重建计划，
    // 与传入令牌比对。包被调包、目标已变化、改判清单被篡改都会导致不一致。
    let replay = make_plan(&package_path, &manifest, target_root, plan.mode, &plan.confirmed_overrides)?;
    if replay.plan_token != plan.plan_token || replay.package_digest != plan.package_digest {
        return Err(AppError::PlanNotConfirmed(
            "计划令牌校验失败：包或目标已变化，请重新生成计划".into(),
        ));
    }

    // 备份目录（仅当存在 Replace 动作时创建）
    let has_replace = plan.items.iter().any(|i| i.action == ActionKind::Replace);
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup_dir = if has_replace {
        let d = target_root.join(BACKUP_DIR).join(&stamp);
        std::fs::create_dir_all(&d)?;
        Some(d.to_string_lossy().to_string())
    } else {
        None
    };

    let total = plan.items.len();
    let mut executed = Vec::with_capacity(total);
    let mut verified = 0usize;

    // 打开一次 zip 归档，逐条流式写盘（大文件不整块进内存）
    let zip_file = File::open(&package_path)?;
    let mut zip = zip::ZipArchive::new(zip_file)
        .map_err(|e| AppError::InvalidPackage(format!("包损坏：{e}")))?;

    for (idx, item) in plan.items.iter().enumerate() {
        match item.action {
            ActionKind::Create | ActionKind::Replace => {
                let abs = safe_join(target_root, &item.target_rel)?;
                if let Some(parent) = abs.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                if item.action == ActionKind::Replace {
                    // 备份原文件（保持相对路径结构）
                    let backup_path = target_root
                        .join(BACKUP_DIR)
                        .join(&stamp)
                        .join(&item.target_rel);
                    if let Some(p) = backup_path.parent() {
                        std::fs::create_dir_all(p)?;
                    }
                    std::fs::copy(&abs, &backup_path)?;
                }
                // 流式写入包内内容
                let mut entry = zip
                    .by_name(&format!("payload/{}", item.target_rel))
                    .map_err(|_| AppError::InvalidPackage(format!(
                        "包内缺少 payload/{}",
                        item.target_rel
                    )))?;
                let mut out = File::create(&abs)?;
                std::io::copy(&mut entry, &mut out)?;
                out.flush()?;
                drop(entry); // 归还借用，供下一条目使用
                // 逐文件复验
                let sha = sha256_of(&abs)?;
                if sha != item.sha256 {
                    return Err(AppError::HashMismatch(format!(
                        "写入后复验失败：{}（期望 {}，实际 {}），已停止后续写入",
                        item.target_rel, item.sha256, sha
                    )));
                }
                verified += 1;
                executed.push(ExecutedItem {
                    target_rel: item.target_rel.clone(),
                    action: item.action,
                    status: "ok",
                });
            }
            ActionKind::SkipSame => {
                verified += 1;
                executed.push(ExecutedItem {
                    target_rel: item.target_rel.clone(),
                    action: item.action,
                    status: "skipped",
                });
            }
            ActionKind::Keep => {
                executed.push(ExecutedItem {
                    target_rel: item.target_rel.clone(),
                    action: item.action,
                    status: "skipped",
                });
            }
        }
        progress(idx + 1, total, &item.target_rel);
    }

    Ok(ApplyReport {
        target_root: target_root.to_string_lossy().to_string(),
        executed,
        backup_dir,
        verified_files: verified,
    })
}

/// 流式计算文件 SHA-256（不整块读入内存）。
fn sha256_of(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packer::pack;
    use crate::profile::zcode::zcode_profile;
    use crate::profile::{category_ids_for_preset, Preset};
    use std::fs;
    use tempfile::TempDir;

    /// 前端契约锁定：跨 IPC 枚举序列化为前端类型镜像（src/lib/ipc.ts）的小写字面量。
    #[test]
    fn applier_enum_serialization_matches_frontend_contract() {
        assert_eq!(
            serde_json::to_value(ApplyMode::Overwrite).unwrap(),
            serde_json::json!("overwrite")
        );
        assert_eq!(
            serde_json::to_value(ApplyMode::Incremental).unwrap(),
            serde_json::json!("incremental")
        );
        assert_eq!(serde_json::to_value(ActionKind::Create).unwrap(), serde_json::json!("create"));
        assert_eq!(
            serde_json::to_value(ActionKind::SkipSame).unwrap(),
            serde_json::json!("skip_same")
        );
        assert_eq!(
            serde_json::to_value(ActionKind::Replace).unwrap(),
            serde_json::json!("replace")
        );
        assert_eq!(serde_json::to_value(ActionKind::Keep).unwrap(), serde_json::json!("keep"));
    }

    /// 造包：返回 (临时目录, 包路径)。树内含规则、技能、config、无 WAL 的库。
    fn make_package() -> (TempDir, PathBuf) {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "规则 v1").unwrap();
        fs::create_dir_all(root.join("skills/a")).unwrap();
        fs::write(root.join("skills/a/SKILL.md"), "技能A").unwrap();
        fs::create_dir_all(root.join("cli")).unwrap();
        fs::write(root.join("cli/config.json"), r#"{"py":"C:\\Users\\old\\py.exe"}"#).unwrap();
        fs::create_dir_all(root.join("cli/db")).unwrap();
        fs::write(root.join("cli/db/db.sqlite"), "库数据").unwrap();
        let ids = category_ids_for_preset(&zcode_profile(), &Preset::Full);
        let out = dir.path().join("pkg/资产包.zam");
        pack(&zcode_profile(), root, &ids, "full", &out, vec![], &mut |_, _, _| {}).unwrap();
        (dir, out)
    }

    /// 包篡改场景：改掉包内一个文件后 open_package 必须报哈希差异。
    #[test]
    fn applier_open_detects_tampered_entry() {
        let (_src, pkg) = make_package();
        // 用 zip 重写：读出全部条目，替换一个文件内容，重新打包
        let file = File::open(&pkg).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
        for i in 0..zip.len() {
            let mut e = zip.by_index(i).unwrap();
            let name = e.name().to_string();
            let mut buf = Vec::new();
            std::io::Read::read_to_end(&mut e, &mut buf).unwrap();
            entries.push((name, buf));
        }
        drop(zip);
        let out_file = File::create(&pkg).unwrap();
        let mut w = zip::ZipWriter::new(out_file);
        let opts = zip::write::SimpleFileOptions::default();
        for (name, mut data) in entries {
            if name == "payload/AGENTS.md" {
                data = "篡改内容".as_bytes().to_vec();
            }
            w.start_file(&name, opts).unwrap();
            w.write_all(&data).unwrap();
        }
        w.finish().unwrap();

        let err = open_package(&pkg, &mut |_, _, _| {}).unwrap_err();
        assert_eq!(err.code(), "hash_mismatch");
        assert!(err.to_string().contains("AGENTS.md"), "差异报告应点名文件");
    }

    /// dry-run 四组归类：新增/一致/冲突/保留。
    #[test]
    fn applier_plan_groups_four_actions() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标机");
        // 目标：AGENTS.md 相同（一致）、cli/config.json 不同（冲突）、无 skills（新增）、多一个本地新文件（保留）
        fs::create_dir_all(target.join("cli")).unwrap();
        fs::write(target.join("AGENTS.md"), "规则 v1").unwrap();
        fs::write(target.join("cli/config.json"), r#"{"py":"D:\\new\\py.exe"}"#).unwrap();
        fs::write(target.join("cli/本地新增.md"), "目标独有").unwrap();

        // 增量模式
        let plan = plan_apply(&pkg, &target, ApplyMode::Incremental, &[], &mut |_, _, _| {}).unwrap();
        let get = |rel: &str| plan.items.iter().find(|i| i.target_rel == rel).unwrap();
        assert_eq!(get("AGENTS.md").action, ActionKind::SkipSame);
        assert_eq!(get("cli/config.json").action, ActionKind::Keep); // 冲突默认保留
        assert_eq!(get("skills/a/SKILL.md").action, ActionKind::Create);
        assert!(get("cli/config.json").target_sha256.is_some());

        // 增量 + 改判
        let plan2 = plan_apply(
            &pkg,
            &target,
            ApplyMode::Incremental,
            &["cli/config.json".into()],
            &mut |_, _, _| {},
        )
        .unwrap();
        assert_eq!(plan2.items.iter().find(|i| i.target_rel == "cli/config.json").unwrap().action, ActionKind::Replace);

        // 覆盖模式：冲突全部 Replace
        let plan3 = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        assert_eq!(plan3.items.iter().find(|i| i.target_rel == "cli/config.json").unwrap().action, ActionKind::Replace);
    }

    /// 反向测试：dry-run 未确认执行时，目标目录零变化（字节级）。
    #[test]
    fn applier_plan_only_writes_nothing() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标机");
        fs::create_dir_all(&target).unwrap();
        let plan = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        assert!(std::fs::read_dir(&target).unwrap().count() == 0,
            "dry-run 不得在目标创建任何内容（token={}）", plan.plan_token);
    }

    /// 覆盖模式执行：冲突备份后替换、执行后哈希复验通过、目标原有文件不减。
    #[test]
    fn applier_execute_overwrite_with_backup() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标机");
        fs::create_dir_all(target.join("cli")).unwrap();
        fs::write(target.join("cli/config.json"), "旧配置").unwrap();
        fs::write(target.join("cli/目标独有.txt"), "保留我").unwrap();

        let plan = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        let report = execute_apply(&plan, &mut |_, _, _| {}).unwrap();

        // 备份存在且内容与替换前一致
        assert!(report.backup_dir.is_some());
        let backup = PathBuf::from(report.backup_dir.clone().unwrap());
        let backed = fs::read_to_string(backup.join("cli/config.json")).unwrap();
        assert_eq!(backed, "旧配置");
        // 替换后的内容 = 包内内容
        let now = fs::read_to_string(target.join("cli/config.json")).unwrap();
        assert!(now.contains("old"));
        // 目标独有文件仍在（不删除）
        assert!(target.join("cli/目标独有.txt").is_file());
        assert_eq!(report.verified_files, plan.items.len());
    }

    /// 增量模式执行：冲突默认保留目标原文件。
    #[test]
    fn applier_execute_incremental_keeps_conflict() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标机");
        fs::create_dir_all(target.join("cli")).unwrap();
        fs::write(target.join("cli/config.json"), "目标新配置").unwrap();

        let plan = plan_apply(&pkg, &target, ApplyMode::Incremental, &[], &mut |_, _, _| {}).unwrap();
        execute_apply(&plan, &mut |_, _, _| {}).unwrap();
        assert_eq!(fs::read_to_string(target.join("cli/config.json")).unwrap(), "目标新配置");
        // 新增文件正常写入
        assert!(target.join("AGENTS.md").is_file());
    }

    /// 反向测试：执行前后目标侧原有文件集合不减（无删除语义）。
    #[test]
    fn applier_execute_never_deletes_target_files() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标机");
        fs::create_dir_all(target.join("cli")).unwrap();
        fs::write(target.join("cli/独占文件.md"), "独占").unwrap();
        let before: Vec<String> = list_files(&target);
        let plan = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        execute_apply(&plan, &mut |_, _, _| {}).unwrap();
        let after: Vec<String> = list_files(&target);
        for f in &before {
            assert!(after.contains(f), "执行后目标文件 {f} 消失（不得删除）");
        }
    }

    /// 真实试用事故回归锁（2026-08-17）：解包必须落显式目标根目录，
    /// 不得写包旁目录——曾因 target_root_for 落包旁 -restored 导致"解包成功但 ZCode 无变化"。
    #[test]
    fn applier_executes_to_explicit_target_not_package_dir() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("真正的目标");
        let plan = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        execute_apply(&plan, &mut |_, _, _| {}).unwrap();

        assert!(target.join("AGENTS.md").is_file(), "文件必须写入显式目标");
        assert_eq!(plan.target_root, target.to_string_lossy().to_string());
        // 旧约定的包旁 -restored 目录不得出现（事故根位）
        let legacy = pkg.with_file_name("资产包-restored");
        assert!(!legacy.exists(), "不得再写包旁 -restored 目录：{}", legacy.display());
        // 包文件本身保持完好（未被当作目标写入）
        assert!(pkg.is_file());
    }

    /// 令牌防篡改（目标根目录）：生成计划后改写 plan.target_root → 执行拒绝。
    #[test]
    fn applier_rejects_tampered_target_root() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标A");
        let mut plan = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        plan.target_root = pkg.parent().unwrap().join("目标B").to_string_lossy().to_string();
        let err = execute_apply(&plan, &mut |_, _, _| {}).unwrap_err();
        assert_eq!(err.code(), "plan_not_confirmed");
    }

    /// 令牌防篡改：手工改动计划里的动作后执行被拒绝。
    #[test]
    fn applier_rejects_tampered_plan_token() {
        let (_src, pkg) = make_package();
        let target = pkg.parent().unwrap().join("目标机");
        let mut plan = plan_apply(&pkg, &target, ApplyMode::Incremental, &[], &mut |_, _, _| {}).unwrap();
        // 篡改：把 Keep 改成 Replace（越权改判）
        for it in plan.items.iter_mut() {
            if it.target_rel == "AGENTS.md" {
                it.action = ActionKind::Replace;
            }
        }
        let err = execute_apply(&plan, &mut |_, _, _| {}).unwrap_err();
        assert_eq!(err.code(), "plan_not_confirmed");
    }

    /// 清单含路径穿越（../）→ 拒绝。
    #[test]
    fn applier_rejects_zip_slip_paths() {
        let mut manifest = packer::read_manifest(&make_package().1).unwrap();
        manifest.files[0].target_rel = "../escape.txt".into();
        let pkg = make_package().1;
        let target = PathBuf::from("Z:/no");
        let err = make_plan(&pkg, &manifest, &target, ApplyMode::Overwrite, &[]);
        assert!(err.is_err());
    }

    /// 反向测试：反斜杠绝对路径 / UNC / 盘符变体全部被 safe_join 拒绝
    /// （Windows 下 `join("\\evil")` 会逃逸目标根，是历史校验漏网向量）。
    #[test]
    fn applier_safe_join_rejects_backslash_and_unc() {
        let root = Path::new("D:/restored");
        for evil in [
            "\\evil\\x.txt",       // 反斜杠绝对路径
            "\\\\server\\share\\f", // UNC
            "C:/evil",             // 盘符
            "../up",               // 上跳
            "/abs",                // 正斜杠绝对
            "",                    // 空
            "a\\b",                // 混入反斜杠
        ] {
            assert!(safe_join(root, evil).is_err(), "应拒绝不安全路径：{evil:?}");
        }
        // 合法相对路径通过
        assert!(safe_join(root, "cli/config.json").is_ok());
    }

    /// 旧格式兼容锁：sqlite 条目为 Deflated 的存量包（Stored 策略上线前打的包）
    /// 仍可校验与解包——applier 全程不感知压缩方法（哈希针对内容）。
    #[test]
    fn applier_reads_legacy_deflated_sqlite_package() {
        let (_src, pkg) = make_package(); // 含 cli/db/db.sqlite（新引擎下为 Stored）

        // 重写为"旧格式"：全部条目 Deflated（内容不动，只改压缩方法）
        let file = File::open(&pkg).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
        for i in 0..zip.len() {
            let mut e = zip.by_index(i).unwrap();
            let name = e.name().to_string();
            let mut buf = Vec::new();
            std::io::Read::read_to_end(&mut e, &mut buf).unwrap();
            entries.push((name, buf));
        }
        drop(zip);
        let out_file = File::create(&pkg).unwrap();
        let mut w = zip::ZipWriter::new(out_file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            w.start_file(&name, opts).unwrap();
            w.write_all(&data).unwrap();
        }
        w.finish().unwrap();

        let mut calls = 0usize;
        let manifest = open_package(&pkg, &mut |_, _, _| {
            calls += 1;
        })
        .unwrap();
        assert_eq!(calls, manifest.files.len(), "校验回调按文件计数推进");
        let target = pkg.parent().unwrap().join("旧包目标");
        let plan = plan_apply(&pkg, &target, ApplyMode::Overwrite, &[], &mut |_, _, _| {}).unwrap();
        execute_apply(&plan, &mut |_, _, _| {}).unwrap();
        assert!(target.join("cli/db/db.sqlite").is_file(), "Deflated sqlite 条目应正常解出");
    }

    /// 校验规模锁：open_package 耗时随条目数线性增长。防 O(N²) 回归——
    /// 曾因每文件重开归档（各自完整解析一遍中央目录）导致平方级。
    #[test]
    fn applier_open_package_scales_linearly() {
        let (_small, pkg_small) = make_wide_package(100);
        let (_large, pkg_large) = make_wide_package(1000);

        let t0 = std::time::Instant::now();
        open_package(&pkg_small, &mut |_, _, _| {}).unwrap();
        let d_small = t0.elapsed();
        let t1 = std::time::Instant::now();
        open_package(&pkg_large, &mut |_, _, _| {}).unwrap();
        let d_large = t1.elapsed();

        let ratio_files = 1000.0f64 / 100.0;
        let ratio_time = d_large.as_millis() as f64 / d_small.as_millis().max(1) as f64;
        assert!(
            ratio_time <= ratio_files * 3.0,
            "校验耗时随条目数超线性恶化：{ratio_time:.1}x（条目 {ratio_files}x）"
        );
    }

    fn make_wide_package(n: usize) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "规则").unwrap();
        let skills = root.join("skills");
        fs::create_dir_all(&skills).unwrap();
        for i in 0..n {
            let sub = skills.join(format!("s{i:04}"));
            fs::create_dir_all(&sub).unwrap();
            fs::write(sub.join("SKILL.md"), format!("技能 {i} ").repeat(10)).unwrap();
        }
        let out = dir.path().join("pkg/wide.zam");
        pack(&zcode_profile(), root, &["skills".to_string()], "custom", &out, vec![], &mut |_, _, _| {})
            .unwrap();
        (dir, out)
    }

    fn list_files(root: &Path) -> Vec<String> {
        walkdir::WalkDir::new(root)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_string_lossy().to_string())
            .collect()
    }
}
