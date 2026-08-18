//! AgentFerry（资产摆渡）Tauri 应用入口与命令注册中心。
//! 全部命令集中注册于唯一 `invoke_handler`；业务引擎为纯 Rust 模块，
//! 不依赖 Tauri 类型，可独立 `cargo test`。

pub mod applier;
mod commands;
mod error;
pub mod packer;
pub mod pathfix;
pub mod profile;
pub mod progress;
pub mod scanner;

use error::AppResult;

/// 返回应用基本信息（前端"关于"展示与 IPC 联调自检用）。
#[tauri::command]
fn app_info() -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({
        "name": "AgentFerry",
        "displayName": "资产摆渡",
        "version": env!("CARGO_PKG_VERSION"),
        "packageFormat": "zam",
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            commands::list_profiles,
            commands::scan_assets,
            commands::pack_assets,
            commands::open_package,
            commands::plan_apply_cmd,
            commands::execute_apply_cmd,
            commands::detect_path_mappings_cmd,
            commands::apply_path_mappings_cmd,
            commands::load_settings,
            commands::save_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
