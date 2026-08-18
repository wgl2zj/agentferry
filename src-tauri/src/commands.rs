//! Tauri 命令层：前端 ↔ 引擎的桥接。全部命令集中注册于 lib.rs 的唯一 invoke_handler。
//! 长任务用 `tokio::task::spawn_blocking` 包裹引擎调用，进度经 `progress` 事件汇报。

use crate::applier::{self, ApplyMode, ApplyPlan};
use crate::error::AppResult;
use crate::packer;
use crate::pathfix;
use crate::profile::{claude::claude_profile, codex::codex_profile, zcode::zcode_profile, Profile};
use crate::progress;
use crate::scanner::{self, ScanReport};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// 档案摘要（UI 档案选择页展示），含完整类别表（前端数据驱动档位与名称的唯一来源）。
#[derive(Debug, Clone, Serialize)]
pub struct ProfileSummary {
    pub id: String,
    pub display_name: String,
    pub version: u32,
    pub category_count: usize,
    pub default_root: String,
    pub categories: Vec<CategoryInfo>,
}

/// 类别信息（前端展示与档位判定用；tier/strategy 转为稳定字符串契约）。
#[derive(Debug, Clone, Serialize)]
pub struct CategoryInfo {
    pub id: String,
    pub display_name: String,
    pub description: String,
    /// recommended / full / excluded。
    pub tier: &'static str,
    /// copy / copy_text_path_adapt / sqlite / excluded。
    pub strategy: &'static str,
    /// 该类别入包时的具体警告（与 manifest.warnings 同源；None = 无）。
    pub pack_warning: Option<String>,
}

fn tier_str(t: crate::profile::PresetTier, strategy: &crate::profile::CategoryStrategy) -> &'static str {
    use crate::profile::{CategoryStrategy, PresetTier};
    if matches!(strategy, CategoryStrategy::Excluded) {
        return "excluded";
    }
    match t {
        PresetTier::Recommended => "recommended",
        PresetTier::Full => "full",
    }
}

fn strategy_str(s: &crate::profile::CategoryStrategy) -> &'static str {
    use crate::profile::CategoryStrategy;
    match s {
        CategoryStrategy::Copy => "copy",
        CategoryStrategy::CopyTextNeedsPathAdapt => "copy_text_path_adapt",
        CategoryStrategy::SqliteDb => "sqlite",
        CategoryStrategy::Excluded => "excluded",
    }
}

pub(crate) fn profile_by_id(id: &str) -> Option<Profile> {
    match id {
        "zcode" => Some(zcode_profile()),
        "codex" => Some(codex_profile()),
        "claude" => Some(claude_profile()),
        _ => None,
    }
}

/// 内置档案清单（档案数据驱动，后续按实测增补）。
fn builtin_profiles() -> Vec<Profile> {
    vec![zcode_profile(), codex_profile(), claude_profile()]
}

/// 列出内置档案（UI 档案选择与档位判定的唯一数据源）。
#[tauri::command]
pub fn list_profiles() -> AppResult<Vec<ProfileSummary>> {
    Ok(builtin_profiles()
        .into_iter()
        .map(|p| {
            let categories = p
                .categories
                .iter()
                .map(|c| CategoryInfo {
                    id: c.id.clone(),
                    display_name: c.display_name.clone(),
                    description: c.description.clone(),
                    tier: tier_str(c.tier, &c.strategy),
                    strategy: strategy_str(&c.strategy),
                    pack_warning: c.pack_warning.clone(),
                })
                .collect();
            ProfileSummary {
                id: p.id.clone(),
                display_name: p.display_name.clone(),
                version: p.version,
                category_count: p.categories.len(),
                default_root: p.default_root().to_string_lossy().to_string(),
                categories,
            }
        })
        .collect())
}

/// 扫描盘点（完整档含数百 MB 库的全量哈希，按长任务处理：阻塞线程执行，不冻结 UI）。
#[tauri::command]
pub async fn scan_assets(profile_id: String, root: Option<String>) -> AppResult<ScanReport> {
    let profile = profile_by_id(&profile_id)
        .ok_or_else(|| crate::error::AppError::PathSetup(format!("未知档案：{profile_id}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = root.map(PathBuf::from).unwrap_or_else(|| profile.default_root());
        scanner::scan(&profile, &root)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("扫描任务异常终止：{e}")))?
}

/// 打包（长任务：扫描 + 逐文件哈希 + zip 写入，全部在阻塞线程执行）。
#[tauri::command]
pub async fn pack_assets(
    app: tauri::AppHandle,
    profile_id: String,
    root: String,
    categories: Vec<String>,
    preset_kind: String,
    output_path: String,
    warnings: Vec<String>,
) -> AppResult<packer::PackResult> {
    let profile = profile_by_id(&profile_id)
        .ok_or_else(|| crate::error::AppError::PathSetup(format!("未知档案：{profile_id}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        progress::emit_progress(&app, "pack", "scanning", "正在扫描资产", 0, 0);
        let mut progress = progress::bridge(app, "pack", "packing");
        packer::pack(
            &profile,
            Path::new(&root),
            &categories,
            &preset_kind,
            Path::new(&output_path),
            warnings,
            &mut progress,
        )
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("打包任务异常终止：{e}")))?
}

use std::path::Path;

/// 打开并校验包（长任务：逐文件哈希校验）。
#[tauri::command]
pub async fn open_package(
    app: tauri::AppHandle,
    path: String,
) -> AppResult<packer::Manifest> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut progress = progress::bridge(app, "open", "verifying");
        applier::open_package(Path::new(&path), &mut progress)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("校验任务异常终止：{e}")))?
}

/// 解包目标根目录解析：显式传入（非空）优先；否则读包内档案推导该软件的本机资产目录
/// （如 ZCode → `~/.zcode`）。真实试用事故修复：此前目标固定为包旁 `-restored` 目录，
/// 导致"解包成功但 ZCode 无变化"。
fn resolve_target_root(path: &Path, target_root: Option<String>) -> AppResult<PathBuf> {
    if let Some(t) = target_root {
        if !t.trim().is_empty() {
            return Ok(PathBuf::from(t.trim()));
        }
    }
    let manifest = packer::read_manifest(path)?;
    let profile = profile_by_id(&manifest.profile_id).ok_or_else(|| {
        crate::error::AppError::InvalidPackage(format!("未知档案：{}", manifest.profile_id))
    })?;
    Ok(profile.default_root())
}

/// 生成 dry-run 计划（纯只读；增量模式的冲突改判经 conflict_overrides 传入）。
/// `target_root`：解包目标根目录；缺省按包内档案推导本机资产目录（如 `~/.zcode`）。
#[tauri::command]
pub async fn plan_apply_cmd(
    app: tauri::AppHandle,
    path: String,
    mode: ApplyMode,
    conflict_overrides: Vec<String>,
    target_root: Option<String>,
) -> AppResult<ApplyPlan> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut progress = progress::bridge(app, "plan", "planning");
        let target = resolve_target_root(Path::new(&path), target_root)?;
        applier::plan_apply(Path::new(&path), &target, mode, &conflict_overrides, &mut progress)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("计划任务异常终止：{e}")))?
}

/// 执行已确认计划（长任务；令牌双道校验在引擎内完成）。
#[tauri::command]
pub async fn execute_apply_cmd(
    app: tauri::AppHandle,
    plan: ApplyPlan,
) -> AppResult<applier::ApplyReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut progress = progress::bridge(app, "apply", "applying");
        applier::execute_apply(&plan, &mut progress)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("执行任务异常终止：{e}")))?
}

/// 检出旧机路径映射建议（读已解包目标树，纯只读）。
/// `target_root`：解包时使用的目标根目录（须与解包一致）；缺省按包内档案推导。
#[tauri::command]
pub async fn detect_path_mappings_cmd(
    app: tauri::AppHandle,
    path: String,
    target_root: Option<String>,
) -> AppResult<pathfix::DetectResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = packer::read_manifest(Path::new(&path))?;
        let target = resolve_target_root(Path::new(&path), target_root)?;
        let _ = &app; // 检出为快任务，不发进度
        pathfix::detect(&target, &manifest)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("检出任务异常终止：{e}")))?
}

/// 应用路径映射（用户确认后的旧→新列表；替换前必备份——红线不可关闭）。
/// `target_root`：解包时使用的目标根目录（须与解包一致）；缺省按包内档案推导。
#[tauri::command]
pub async fn apply_path_mappings_cmd(
    app: tauri::AppHandle,
    path: String,
    mappings: Vec<PathMappingIn>,
    target_root: Option<String>,
) -> AppResult<pathfix::PathFixReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let manifest = packer::read_manifest(Path::new(&path))?;
        let target = resolve_target_root(Path::new(&path), target_root)?;
        let pairs: Vec<(String, String)> = mappings.into_iter().map(|m| (m.old, m.new)).collect();
        let _ = &app;
        // 备份固定开启：任何替换前必备份是决策红线，命令层不留关闭口子
        pathfix::apply_mappings(&target, &manifest, &pairs, true)
    })
    .await
    .map_err(|e| crate::error::AppError::Internal(format!("替换任务异常终止：{e}")))?
}

/// 路径映射入参。
#[derive(Debug, Clone, Deserialize)]
pub struct PathMappingIn {
    pub old: String,
    pub new: String,
}

/// 应用设置（v1：默认输出目录）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub default_output_dir: String,
}

fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("settings.json")
}

/// 读取设置（无文件时按首用默认值：家目录下存在 Downloads 目录则作为默认输出目录）。
#[tauri::command]
pub fn load_settings(app: tauri::AppHandle) -> AppResult<Settings> {
    let path = settings_path(&app);
    if !path.is_file() {
        return Ok(Settings { default_output_dir: default_output_dir_in(&crate::profile::home_dir()) });
    }
    let text = std::fs::read_to_string(&path)?;
    serde_json::from_str(&text)
        .map_err(|e| crate::error::AppError::Internal(format!("设置解析失败：{e}")))
}

/// 首用默认输出目录推导（纯函数便于测试）：home 下有 Downloads 目录则采用，否则空。
fn default_output_dir_in(home: &Path) -> String {
    let dir = home.join("Downloads");
    if dir.is_dir() {
        dir.to_string_lossy().to_string()
    } else {
        String::new()
    }
}

/// 保存设置。
#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> AppResult<()> {
    let path = settings_path(&app);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let text = serde_json::to_string_pretty(&settings)
        .map_err(|e| crate::error::AppError::Internal(format!("设置序列化失败：{e}")))?;
    std::fs::write(&path, text)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 契约守护：list_profiles 返回完整类别表，id/档位/策略与档案一致
    /// （前端档位判定完全依赖此表，缺失即真实模式打包不完整——审查严重问题 1 的防线）。
    #[test]
    fn commands_list_profiles_returns_full_category_table() {
        let profiles = list_profiles().unwrap();
        assert_eq!(profiles.len(), 3, "内置档案数：zcode/codex/claude");

        let zcode = &profiles[0];
        assert_eq!(zcode.id, "zcode");
        assert_eq!(zcode.categories.len(), 15, "ZCode 档案类别数");
        let ids: Vec<&str> = zcode.categories.iter().map(|c| c.id.as_str()).collect();
        for must in [
            "global_rules", "skills", "commands", "agent_defs", "memories",
            "main_config", "v2_config", "plugin_manifests",
            "session_db", "artifacts", "rollout", "tasks_index", "v2_sessions",
            "credentials", "caches",
        ] {
            assert!(ids.contains(&must), "类别表缺 {must}");
        }
        let get = |id: &str| zcode.categories.iter().find(|c| c.id == id).unwrap();
        assert_eq!(get("skills").tier, "recommended");
        assert_eq!(get("session_db").tier, "full");
        assert_eq!(get("session_db").strategy, "sqlite");
        assert_eq!(get("main_config").strategy, "copy_text_path_adapt");
        assert_eq!(get("credentials").tier, "excluded");
        assert_eq!(get("caches").strategy, "excluded");
        // 展示名非空且中文（UI 不显示内部 id）
        for c in &zcode.categories {
            assert!(!c.display_name.is_empty());
        }

        // Codex 档案：类别数、档位/策略定性、token 警告透传、默认根
        let codex = &profiles[1];
        assert_eq!(codex.id, "codex");
        assert_eq!(codex.categories.len(), 15, "Codex 档案类别数");
        let cget = |id: &str| codex.categories.iter().find(|c| c.id == id).unwrap();
        assert_eq!(cget("main_config").strategy, "copy_text_path_adapt");
        assert_eq!(
            cget("main_config").pack_warning.as_deref(),
            Some("本包含 API 凭据：config.toml 的 experimental_bearer_token 将随包迁移，请妥善保管迁移包")
        );
        assert_eq!(cget("session_index").strategy, "copy_text_path_adapt");
        assert_eq!(cget("memories_db").strategy, "sqlite");
        assert_eq!(cget("sessions").tier, "full");
        assert_eq!(cget("credentials").strategy, "excluded");
        assert_eq!(cget("credentials").tier, "excluded");
        assert!(codex.categories.iter().filter(|c| c.id != "main_config").all(|c| c.pack_warning.is_none()));

        // Claude 档案：类别数、策略定性、token 警告透传、无 SQLite 类别
        let claude = &profiles[2];
        assert_eq!(claude.id, "claude");
        assert_eq!(claude.categories.len(), 10, "Claude 档案类别数");
        let lget = |id: &str| claude.categories.iter().find(|c| c.id == id).unwrap();
        assert_eq!(lget("settings").strategy, "copy_text_path_adapt");
        assert_eq!(
            lget("settings").pack_warning.as_deref(),
            Some("本包含 API 凭据：settings.json 的 ANTHROPIC_AUTH_TOKEN 将随包迁移，请妥善保管迁移包")
        );
        assert_eq!(lget("config").tier, "excluded");
        assert_eq!(lget("projects").tier, "full");
        assert!(!claude.categories.iter().any(|c| c.strategy == "sqlite"));
        assert!(claude.categories.iter().filter(|c| c.id != "settings").all(|c| c.pack_warning.is_none()));
    }

    /// 解包目标推导：codex 包缺省目标 = 本机 ~/.codex（home_dir_name 映射 + 档案根推导，
    /// 吸取 zcode"解包目标错位"事故教训：目标必须按包内档案正确推导并测试锁定）。
    #[test]
    fn commands_resolve_target_root_derives_codex_home() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        std::fs::write(root.join("config.toml"), "x = 1\n").unwrap();
        let out = dir.path().join("codex-包.zam");
        crate::packer::pack(
            &profile_by_id("codex").unwrap(),
            root,
            &["main_config".to_string()],
            "custom",
            &out,
            vec![],
            &mut |_, _, _| {},
        )
        .unwrap();
        let got = resolve_target_root(&out, None).unwrap();
        assert_eq!(got, crate::profile::home_dir().join(".codex"));
        let got_claude = {
            // 同法验证 claude 包推导 ~/.claude
            let dir2 = tempfile::TempDir::new().unwrap();
            std::fs::write(dir2.path().join("settings.json"), "{}").unwrap();
            let out2 = dir2.path().join("claude-包.zam");
            crate::packer::pack(
                &profile_by_id("claude").unwrap(),
                dir2.path(),
                &["settings".to_string()],
                "custom",
                &out2,
                vec![],
                &mut |_, _, _| {},
            )
            .unwrap();
            resolve_target_root(&out2, None).unwrap()
        };
        assert_eq!(got_claude, crate::profile::home_dir().join(".claude"));
    }

    /// 首用默认输出目录：home 下有 Downloads 才采用，否则为空（不凭空造目录）。
    #[test]
    fn commands_default_output_dir_requires_existing_downloads() {
        let home = tempfile::TempDir::new().unwrap();
        assert_eq!(default_output_dir_in(home.path()), "", "无 Downloads 时空");
        let downloads = home.path().join("Downloads");
        std::fs::create_dir_all(&downloads).unwrap();
        assert_eq!(
            default_output_dir_in(home.path()),
            downloads.to_string_lossy().to_string(),
            "存在 Downloads 时作为默认输出目录"
        );
    }

    /// 解包目标解析：显式目标优先（不去读包），空白串视为未传。
    #[test]
    fn commands_resolve_target_root_prefers_explicit() {
        let got = resolve_target_root(Path::new("Z:/不存在的包.zam"), Some("E:\\恢复目录".into()))
            .unwrap();
        assert_eq!(got, PathBuf::from("E:\\恢复目录"));
        // 空白串等同未传 → 走档案推导（此处的包不存在，必须报错而不是静默用包旁目录）
        let err = resolve_target_root(Path::new("Z:/不存在的包.zam"), Some("   ".into()))
            .unwrap_err();
        assert_eq!(err.code(), "invalid_package");
    }
}
