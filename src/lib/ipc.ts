// 类型化 IPC 层：命令名常量唯一来源 + 后端事件 Hook + 数据类型镜像（Electron 版）。
// 命令名与主进程唯一 ipcMain.handle 注册列表一致（electron/protocol.ts 为共享来源）；
// 数据类型直接从引擎侧以 import type 引入（编译期擦除，不会把 Node 依赖带进渲染层）。
import { useEffect, useRef } from "react";
import { COMMANDS } from "../../electron/protocol";

export { COMMANDS };

/** 预加载层暴露的受控桥（contextBridge）。 */
export interface AgentFerryBridge {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, handler: (e: { payload: unknown }) => void) => () => void;
  pickDirectory: (current?: string) => Promise<string | null>;
  pickPackage: (current?: string) => Promise<string | null>;
}

declare global {
  interface Window {
    agentferry?: AgentFerryBridge;
    __AGENTFERRY_BRIDGE__?: boolean;
  }
}

/** 后端统一错误（AppError 序列化形态；主进程 reject {code,message}）。 */
export type { AppErrorPayload } from "../../electron/protocol";

function bridge(): AgentFerryBridge {
  const b = window.agentferry;
  if (!b) throw new Error("桌面桥未就绪：当前非 Electron 环境或预加载脚本未加载");
  return b;
}

// ---- 数据类型镜像（引擎侧单一来源经 re-export 引入，杜绝手写镜像漂移；
//      snake_case 字段保持不变；code review 2026-09-06 撤销手写 ActionKind 镜像）----

export type { FileKind, CategoryStatus } from "../../electron/engine/scanner";
export type { ApplyMode, ActionKind } from "../../electron/engine/applier";

export type { ScannedFile } from "../../electron/engine/scanner";
export type { CategoryReport, ScanReport } from "../../electron/engine/scanner";
export type { Manifest, ManifestFile, PackResult } from "../../electron/engine/packer";
export type { SourceInfo, PresetInfo } from "../../electron/engine/packer";
export type { ApplyPlan, ApplyReport, PlanItem, ExecutedItem } from "../../electron/engine/applier";
export type { DetectResult, DetectFile, PathSeed, PathFixReport, ReplacedFile } from "../../electron/engine/pathfix";
export type { ProgressPayload } from "../../electron/engine/progress";
export type { ProfileSummary, Settings, AppInfo, CategoryInfo, IpcResult } from "../../electron/protocol";

// ---- 进度事件 ----

/**
 * 订阅后端事件的自定义 Hook（统一入口，组件不得散写 listen）。
 * handler 变化不重订阅（用 ref 保存最新回调）。
 */
export function useBackendEvent<T>(event: string, handler: (payload: T) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const b = window.agentferry;
    if (!b) return;
    return b.listen(event, (e) => ref.current(e.payload as T));
  }, [event]);
}

/** 类型化 invoke 的薄封装：统一附加命令名约束。 */
export function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return bridge().invoke(cmd, args ?? {}) as Promise<T>;
}
