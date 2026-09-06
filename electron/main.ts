// Electron 主进程入口：窗口生命周期 + 命令注册中心（对应 Rust 版 lib.rs）。
// 全部命令集中注册于唯一 ipcMain.handle 装配；长任务为异步实现（不冻结主进程），
// 进度经 "progress" 事件按 50ms 节流汇报（引擎回调次数不变，首末必发）。

import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import * as commands from "./commands";
import { AppError, toAppError } from "./engine/error";
import { bridge, type ProgressPayload } from "./engine/progress";
import type { ApplyPlan, ApplyMode } from "./engine/applier";
import type { Settings } from "./protocol";
import { COMMANDS } from "./protocol";

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: "资产摆渡 AgentFerry",
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  return win;
}

function emitProgress(payload: ProgressPayload): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("progress", payload);
  }
}

/** 命令装配：错误信封化——Electron 跨桥抛错会丢失结构，改为 {ok,error} 由预加载层还原为异常。 */
function handle<T>(name: string, fn: (args: Record<string, unknown>) => Promise<T> | T): void {
  ipcMain.handle(
    name,
    async (_event, args: Record<string, unknown> | undefined): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }> => {
      try {
        return { ok: true, data: await fn(args ?? {}) };
      } catch (e) {
        const err = toAppError(e);
        return { ok: false, error: { code: err.code, message: err.message } };
      }
    },
  );
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const optStr = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim().length > 0 ? v : undefined;
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : String(x))) : [];

function registerCommands(): void {
  const appVersion = app.getVersion();

  handle(COMMANDS.appInfo, () => ({
    name: "AgentFerry",
    displayName: "资产摆渡",
    version: appVersion,
    packageFormat: "zam",
  }));
  handle(COMMANDS.listProfiles, () => commands.listProfiles());
  handle(COMMANDS.scanAssets, (args) => commands.scanAssets(str(args.profileId), optStr(args.root)));
  handle(COMMANDS.packAssets, (args) => {
    // 打包前先发一条 scanning 进度（与 Rust 命令层行为一致，进度条能立即启动）
    emitProgress({ task: "pack", phase: "scanning", message: "正在扫描资产", current: 0, total: 0 });
    return commands.packAssets(
      {
        profileId: str(args.profileId),
        root: str(args.root),
        categories: strList(args.categories),
        presetKind: str(args.presetKind),
        outputPath: str(args.outputPath),
        warnings: strList(args.warnings),
        appVersion,
      },
      bridge(emitProgress, "pack", "packing"),
    );
  });
  handle(COMMANDS.openPackage, (args) =>
    commands.openPackageCmd(str(args.path), bridge(emitProgress, "open", "verifying")),
  );
  handle(COMMANDS.planApply, (args) => {
    const rawMode = str(args.mode);
    if (rawMode !== "overwrite" && rawMode !== "incremental") {
      // 非法 mode 显式拒绝而非静默归一（code review 2026-09-06）
      throw new AppError("internal", `未知的恢复模式：${rawMode}`);
    }
    const mode: ApplyMode = rawMode;
    return commands.planApplyCmd(
      {
        path: str(args.path),
        mode,
        conflictOverrides: strList(args.conflictOverrides),
        targetRoot: optStr(args.targetRoot),
        mergeRelPaths: strList(args.mergeRelPaths),
      },
      bridge(emitProgress, "plan", "planning"),
    );
  });
  handle(COMMANDS.executeApply, (args) => {
    // plan 形状防御：畸形对象在引擎令牌重放前就显式拒绝（引擎侧令牌校验仍是主防线）
    const plan = args.plan as ApplyPlan | undefined;
    if (!plan || typeof plan !== "object" || !Array.isArray(plan.items) || typeof plan.plan_token !== "string") {
      throw new AppError("internal", "执行计划格式不合法，请重新生成计划");
    }
    return commands.executeApplyCmd(plan, bridge(emitProgress, "apply", "applying"));
  });
  handle(COMMANDS.detectPathMappings, (args) =>
    commands.detectPathMappingsCmd(str(args.path), optStr(args.targetRoot)),
  );
  handle(COMMANDS.applyPathMappings, (args) =>
    commands.applyPathMappingsCmd(
      str(args.path),
      Array.isArray(args.mappings)
        ? (args.mappings as Record<string, unknown>[]).map((m) => ({ old: str(m?.old), new: str(m?.new) }))
        : [],
      optStr(args.targetRoot),
    ),
  );
  handle(COMMANDS.loadSettings, () =>
    commands.loadSettingsFrom(commands.settingsPathIn(app.getPath("userData"))),
  );
  handle(COMMANDS.saveSettings, (args) => {
    const s = (args.settings ?? {}) as Partial<Settings>;
    return commands.saveSettingsTo(commands.settingsPathIn(app.getPath("userData")), {
      default_output_dir: str(s.default_output_dir),
    });
  });

  // 系统对话框（对应 tauri-plugin-dialog；取消返回 null，与原契约一致）
  ipcMain.handle("dialog:pickDirectory", async (event, current?: unknown): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win) throw new AppError("internal", "没有可用的应用窗口");
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      ...(typeof current === "string" && current.trim() ? { defaultPath: current.trim() } : {}),
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
  ipcMain.handle("dialog:pickPackage", async (event, current?: unknown): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win) throw new AppError("internal", "没有可用的应用窗口");
    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "资产摆渡迁移包", extensions: ["zam"] }],
      ...(typeof current === "string" && current.trim() ? { defaultPath: current.trim() } : {}),
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
}

app.whenReady().then(() => {
  // 与 Tauri 版一致：不设应用菜单栏（去掉 Electron 默认的英文 File/Edit/View 菜单）
  Menu.setApplicationMenu(null);
  registerCommands();
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
