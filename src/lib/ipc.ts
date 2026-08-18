// 类型化 IPC 层：命令名常量唯一来源 + 后端事件 Hook + 数据类型镜像。
// 命令名必须与 src-tauri/src/lib.rs 的 generate_handler 列表一致（有快照测试锁定）。
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

/** 全部后端命令名（与后端唯一 invoke_handler 注册列表一一对应）。 */
export const COMMANDS = {
  appInfo: "app_info",
  listProfiles: "list_profiles",
  scanAssets: "scan_assets",
  packAssets: "pack_assets",
  openPackage: "open_package",
  planApply: "plan_apply_cmd",
  executeApply: "execute_apply_cmd",
  detectPathMappings: "detect_path_mappings_cmd",
  applyPathMappings: "apply_path_mappings_cmd",
  loadSettings: "load_settings",
  saveSettings: "save_settings",
} as const;

/** 后端统一错误（AppError 序列化形态）。 */
export interface AppErrorPayload {
  code: string;
  message: string;
}

// ---- 数据类型镜像（Rust 侧 serde 序列化，字段保持 snake_case）----

export type FileKind = "text" | "binary" | "sqlite";
export type ApplyMode = "overwrite" | "incremental";
export type ActionKind = "create" | "skip_same" | "replace" | "keep";
export type CategoryStatus =
  | { status: "ready" }
  | { status: "blocked"; detail: string }
  | { status: "missing" };

export interface ScannedFile {
  rel_path: string;
  size: number;
  sha256: string;
  kind: FileKind;
}

export interface CategoryReport {
  category_id: string;
  status: CategoryStatus;
  files: ScannedFile[];
  total_bytes: number;
}

export interface ScanReport {
  profile_id: string;
  profile_version: number;
  root: string;
  categories: CategoryReport[];
}

export interface CategoryInfo {
  id: string;
  display_name: string;
  description: string;
  /** recommended / full / excluded。 */
  tier: "recommended" | "full" | "excluded";
  /** copy / copy_text_path_adapt / sqlite / excluded。 */
  strategy: "copy" | "copy_text_path_adapt" | "sqlite" | "excluded";
  /** 该类别入包时的具体警告（与 manifest.warnings 同源；null = 无，如 API token 随包提醒）。 */
  pack_warning: string | null;
}

export interface ProfileSummary {
  id: string;
  display_name: string;
  version: number;
  category_count: number;
  default_root: string;
  /** 完整类别表：前端档位判定与类别名称的唯一数据源（禁止前端硬编码类别 id）。 */
  categories: CategoryInfo[];
}

export interface SourceInfo {
  os: string;
  arch: string;
  hostname: string;
  username: string;
}

export interface ManifestFile {
  path: string;
  target_rel: string;
  category: string;
  sha256: string;
  size: number;
  kind: FileKind;
  needs_path_adapt: boolean;
}

export interface Manifest {
  format_version: number;
  app_version: string;
  created_at: string;
  source: SourceInfo;
  profile_id: string;
  profile_version: number;
  preset: { kind: string; categories: string[] };
  files: ManifestFile[];
  counts: { files: number; categories: number };
  total_bytes: number;
  warnings: string[];
}

export interface PackResult {
  output_path: string;
  package_bytes: number;
  manifest: Manifest;
}

export interface PlanItem {
  target_rel: string;
  category: string;
  sha256: string;
  size: number;
  action: ActionKind;
  target_sha256: string | null;
}

export interface ApplyPlan {
  package_path: string;
  /** 解包目标根目录（默认按包内档案推导为本机资产目录，如 ~/.zcode / ~/.codex；执行与令牌校验均以此为准）。 */
  target_root: string;
  mode: ApplyMode;
  package_digest: string;
  items: PlanItem[];
  plan_token: string;
  confirmed_overrides: string[];
  backup_cleanup_hint: string | null;
}

export interface ExecutedItem {
  target_rel: string;
  action: ActionKind;
  /** ok=已写入并复验 / skipped=计划内跳过（与后端 applier.rs 契约一致）。 */
  status: "ok" | "skipped";
}

export interface ApplyReport {
  target_root: string;
  executed: ExecutedItem[];
  backup_dir: string | null;
  verified_files: number;
}

export interface PathSeed {
  old: string;
  new: string;
  total_hits: number;
}

export interface DetectFile {
  target_rel: string;
  total_hits: number;
  skipped_reason: string | null;
}

export interface DetectResult {
  seeds: PathSeed[];
  files: DetectFile[];
}

export interface ReplacedFile {
  target_rel: string;
  replacements: number;
}

export interface PathFixReport {
  replaced: ReplacedFile[];
  skipped: { target_rel: string; reason: string }[];
  backup_dir: string | null;
}

export interface Settings {
  default_output_dir: string;
}

// ---- 进度事件 ----

/** `progress` 事件载荷（后端 progress.rs ProgressPayload）。 */
export interface ProgressPayload {
  task: string;
  phase: string;
  message: string;
  current: number;
  total: number;
}

/**
 * 订阅后端事件的自定义 Hook（统一入口，组件不得散写 listen）。
 * handler 变化不重订阅（用 ref 保存最新回调）。
 */
export function useBackendEvent<T>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<T>(event, (e) => ref.current(e.payload)).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event]);
}

/** 类型化 invoke 的薄封装：统一附加命令名约束。 */
export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args ?? {});
}
