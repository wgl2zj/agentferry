// @vitest-environment node
// 命令层（commands）测试：Rust commands.rs 内联测试的逐条翻译，测试名保持一致。

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  defaultOutputDirIn,
  listProfiles,
  loadSettingsFrom,
  resolveTargetRoot,
  saveSettingsTo,
  settingsPathIn,
} from "../commands";
import { pack } from "./packer";
import { homeDir, profileById } from "./profile";
import { AppError } from "./error";

const APP_VERSION = "0.1.6";

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "af-cmd-"));
  tempDirs.push(dir);
  return dir;
}

describe("commands_list_profiles_returns_full_category_table", () => {
  it("契约守护：list_profiles 返回完整类别表，id/档位/策略与档案一致", () => {
    const profiles = listProfiles();
    expect(profiles).toHaveLength(3);

    const zcode = profiles[0];
    expect(zcode.id).toBe("zcode");
    expect(zcode.categories).toHaveLength(15);
    const ids = zcode.categories.map((c) => c.id);
    for (const must of [
      "global_rules", "skills", "commands", "agent_defs", "memories",
      "main_config", "v2_config", "plugin_manifests",
      "session_db", "artifacts", "rollout", "tasks_index", "v2_sessions",
      "credentials", "caches",
    ]) {
      expect(ids).toContain(must);
    }
    const get = (id: string) => zcode.categories.find((c) => c.id === id)!;
    expect(get("skills").tier).toBe("recommended");
    expect(get("session_db").tier).toBe("full");
    expect(get("session_db").strategy).toBe("sqlite");
    expect(get("main_config").strategy).toBe("copy_text_path_adapt");
    expect(get("credentials").tier).toBe("excluded");
    expect(get("caches").strategy).toBe("excluded");
    // 展示名非空且中文（UI 不显示内部 id）
    for (const c of zcode.categories) {
      expect(c.display_name).not.toBe("");
    }

    // Codex 档案：类别数、档位/策略定性、token 警告透传、默认根
    const codex = profiles[1];
    expect(codex.id).toBe("codex");
    expect(codex.categories).toHaveLength(15);
    const cget = (id: string) => codex.categories.find((c) => c.id === id)!;
    expect(cget("main_config").strategy).toBe("copy_text_path_adapt");
    expect(cget("main_config").pack_warning).toBe(
      "本包含 API 凭据：config.toml 的 experimental_bearer_token 将随包迁移，请妥善保管迁移包",
    );
    expect(cget("session_index").strategy).toBe("copy_text_path_adapt");
    expect(cget("memories_db").strategy).toBe("sqlite");
    expect(cget("sessions").tier).toBe("full");
    expect(cget("credentials").strategy).toBe("excluded");
    expect(cget("credentials").tier).toBe("excluded");
    expect(codex.categories.filter((c) => c.id !== "main_config").every((c) => c.pack_warning === null)).toBe(true);

    // Claude 档案：类别数、策略定性、token 警告透传、无 SQLite 类别
    const claude = profiles[2];
    expect(claude.id).toBe("claude");
    expect(claude.categories).toHaveLength(10);
    const lget = (id: string) => claude.categories.find((c) => c.id === id)!;
    expect(lget("settings").strategy).toBe("copy_text_path_adapt");
    expect(lget("settings").pack_warning).toBe(
      "本包含 API 凭据：settings.json 的 ANTHROPIC_AUTH_TOKEN 将随包迁移，请妥善保管迁移包",
    );
    expect(lget("config").tier).toBe("excluded");
    expect(lget("projects").tier).toBe("full");
    expect(claude.categories.some((c) => c.strategy === "sqlite")).toBe(false);
    expect(claude.categories.filter((c) => c.id !== "settings").every((c) => c.pack_warning === null)).toBe(true);
  });
});

it("commands_resolve_target_root_derives_codex_home：codex/claude 包缺省目标 = 本机对应家目录", async () => {
  {
    const root = await tempDir();
    fs.writeFileSync(path.join(root, "config.toml"), "x = 1\n");
    const out = path.join(root, "codex-包.zam");
    await pack(profileByIdOrThrow("codex"), root, ["main_config"], "custom", out, [], APP_VERSION, () => {});
    expect(await resolveTargetRoot(out, undefined)).toBe(path.join(homeDir(), ".codex"));
  }
  {
    const root = await tempDir();
    fs.writeFileSync(path.join(root, "settings.json"), "{}");
    const out = path.join(root, "claude-包.zam");
    await pack(profileByIdOrThrow("claude"), root, ["settings"], "custom", out, [], APP_VERSION, () => {});
    expect(await resolveTargetRoot(out, undefined)).toBe(path.join(homeDir(), ".claude"));
  }
});

it("commands_resolve_target_root_prefers_explicit：显式目标优先（不去读包），空白串视为未传", async () => {
  const got = await resolveTargetRoot("Z:/不存在的包.zam", "E:\\恢复目录");
  expect(got).toBe("E:\\恢复目录");
  // 空白串等同未传 → 走档案推导（此处的包不存在，必须报错而不是静默用包旁目录）
  await expect(resolveTargetRoot("Z:/不存在的包.zam", "   ")).rejects.toMatchObject({
    code: "invalid_package",
  });
});

it("commands_default_output_dir_requires_existing_downloads：home 下有 Downloads 才采用，否则为空", async () => {
  const home = await tempDir();
  expect(defaultOutputDirIn(home)).toBe("");
  const downloads = path.join(home, "Downloads");
  fs.mkdirSync(downloads, { recursive: true });
  expect(defaultOutputDirIn(home)).toBe(downloads);
});

it("load/save settings：读写 userData 下 settings.json，往返一致", async () => {
  const userData = await tempDir();
  const settingsPath = settingsPathIn(userData);
  // 无文件 → 首用默认（本机 home 有 Downloads 时为其，否则空）
  const first = await loadSettingsFrom(settingsPath);
  expect(first.default_output_dir).toBe(defaultOutputDirIn(homeDir()));
  // 保存后读回
  await saveSettingsTo(settingsPath, { default_output_dir: "D:\\迁移包" });
  const loaded = await loadSettingsFrom(settingsPath);
  expect(loaded).toEqual({ default_output_dir: "D:\\迁移包" });
  await expect(loadSettingsFrom(path.join(userData, "不存在.json"))).resolves.toBeTruthy();
});

function profileByIdOrThrow(id: string) {
  const p = profileById(id);
  if (!p) throw new AppError("path_setup", `未知档案：${id}`);
  return p;
}
