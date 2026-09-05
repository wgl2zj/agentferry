// Electron 预加载脚本：以最小受控面暴露 IPC（contextBridge，渲染层无 Node 权限）。
// invoke 把主进程错误信封还原为异常（reject {code,message}，与原 Tauri 行为一致）；
// listen 提供 Tauri 风格 { payload } 事件回调签名，前端 Hook 无需改动。

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

interface IpcEnvelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

const api = {
  invoke: async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    const result = (await ipcRenderer.invoke(cmd, args ?? {})) as IpcEnvelope;
    if (result && result.ok) return result.data;
    throw (result && result.error) ?? { code: "internal", message: String(result) };
  },
  listen: (event: string, handler: (e: { payload: unknown }) => void): (() => void) => {
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => handler({ payload });
    ipcRenderer.on(event, wrapped);
    return () => {
      ipcRenderer.removeListener(event, wrapped);
    };
  },
  pickDirectory: (current?: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pickDirectory", current),
  pickPackage: (current?: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pickPackage", current),
};

contextBridge.exposeInMainWorld("agentferry", api);
// 渲染层据此判定"桌面真实模式 vs 浏览器演示模式"（mock.ts isMock）。
contextBridge.exposeInMainWorld("__AGENTFERRY_BRIDGE__", true);
