// IPC 层守护测试：命令名常量快照 + Electron 主进程注册完整性（静态核对 electron/main.ts）。
// 迁移注记：后端注册面已从 src-tauri/src/lib.rs 的 generate_handler 换岗到
// main.ts 的唯一 handle() 装配（守护测试随之换岗，2026-09-06 code review C2）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./ipc";

const MAIN_ENTRY = resolve(process.cwd(), "electron/main.ts");

describe("IPC 命令名一致性", () => {
  it("COMMANDS 常量表快照（增删命令必须显式更新此快照）", () => {
    expect(Object.values(COMMANDS)).toEqual([
      "app_info",
      "list_profiles",
      "scan_assets",
      "pack_assets",
      "open_package",
      "plan_apply",
      "execute_apply",
      "detect_path_mappings",
      "apply_path_mappings",
      "load_settings",
      "save_settings",
    ]);
  });

  it("主进程 handle() 注册了全部命令（读 main.ts 静态核对，防 protocol 加键漏注册）", () => {
    const mainTs = readFileSync(MAIN_ENTRY, "utf-8");
    for (const key of Object.keys(COMMANDS)) {
      expect(mainTs, `COMMANDS.${key} 未在 main.ts 的 handle() 装配中注册`).toContain(
        `handle(COMMANDS.${key}`,
      );
    }
  });
});
