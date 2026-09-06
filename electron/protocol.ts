// IPC 协议常量与共享载荷类型：渲染层与主进程的唯一契约来源。
// 纯模块：禁止依赖 Node API 与 Electron（渲染层演示 mock 与主进程命令层共同引用）。

/** 全部后端命令名（与主进程唯一 ipcMain.handle 注册列表一一对应）。 */
export const COMMANDS = {
  appInfo: "app_info",
  listProfiles: "list_profiles",
  scanAssets: "scan_assets",
  packAssets: "pack_assets",
  openPackage: "open_package",
  planApply: "plan_apply",
  executeApply: "execute_apply",
  detectPathMappings: "detect_path_mappings",
  applyPathMappings: "apply_path_mappings",
  loadSettings: "load_settings",
  saveSettings: "save_settings",
} as const;

/** 后端统一错误（AppError 序列化形态）。 */
export interface AppErrorPayload {
  code: string;
  message: string;
}

/** IPC 结果信封：主进程不抛异常跨桥（Electron 会吞掉结构），改为显式信封由预加载层还原。 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload };

/** 类别信息（前端展示与档位判定用；tier/strategy 为稳定字符串契约）。 */
export interface CategoryInfo {
  id: string;
  display_name: string;
  description: string;
  /** recommended / full / excluded。 */
  tier: "recommended" | "full" | "excluded";
  /** copy / copy_text_path_adapt / sqlite / excluded。 */
  strategy: "copy" | "copy_text_path_adapt" | "sqlite" | "excluded";
  /** 该类别入包时的具体警告（与 manifest.warnings 同源；null = 无）。 */
  pack_warning: string | null;
}

/** 档案摘要（UI 档案选择页展示，含完整类别表）。 */
export interface ProfileSummary {
  id: string;
  display_name: string;
  version: number;
  category_count: number;
  default_root: string;
  categories: CategoryInfo[];
}

/** 应用设置（v1：默认输出目录）。 */
export interface Settings {
  default_output_dir: string;
}

/** app_info 返回（前端"关于"展示与 IPC 联调自检用）。 */
export interface AppInfo {
  name: string;
  displayName: string;
  version: string;
  packageFormat: string;
}
