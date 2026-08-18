// IPC 层守护测试：命令名常量与后端注册列表的一致性（快照锁定）+ 类型镜像完整性。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./ipc";

const BACKEND_ENTRY = resolve(process.cwd(), "src-tauri/src/lib.rs");

describe("IPC 命令名一致性", () => {
  it("COMMANDS 常量表快照（增删命令必须显式更新此快照）", () => {
    expect(Object.values(COMMANDS)).toEqual([
      "app_info",
      "list_profiles",
      "scan_assets",
      "pack_assets",
      "open_package",
      "plan_apply_cmd",
      "execute_apply_cmd",
      "detect_path_mappings_cmd",
      "apply_path_mappings_cmd",
      "load_settings",
      "save_settings",
    ]);
  });

  it("后端 generate_handler 注册了全部命令名（读 lib.rs 静态核对）", () => {
    const libRs = readFileSync(BACKEND_ENTRY, "utf-8");
    for (const name of Object.values(COMMANDS)) {
      if (name === "app_info") {
        // 本地命令直接出现在 generate_handler
        expect(libRs).toContain(`app_info,`);
        continue;
      }
      // commands:: 前缀注册
      expect(libRs).toContain(`commands::${name}`);
    }
  });
});
