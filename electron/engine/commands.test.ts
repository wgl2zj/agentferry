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
  scanAssets,
  settingsPathIn,
} from "../commands";
import { pack } from "./packer";
import { homeDir, legacyProfileById, profileById } from "./profile";
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
    // 产品收窄（spec 决策 1）：注册中心仅返回 zcode 一个档案
    expect(profiles).toHaveLength(1);
    expect(profiles.map((p) => p.id)).toEqual(["zcode"]);

    const zcode = profiles[0];
    expect(zcode.id).toBe("zcode");
    // v2 契约（spec 实施决策第 3 条）：26 类别 = 推荐档 17 + 完整档 7 + 排除 2 类承载
    expect(zcode.categories).toHaveLength(26);
    expect(zcode.categories.filter((c) => c.tier === "recommended")).toHaveLength(17);
    expect(zcode.categories.filter((c) => c.tier === "full")).toHaveLength(7);
    expect(zcode.categories.filter((c) => c.tier === "excluded")).toHaveLength(2);
    const ids = zcode.categories.map((c) => c.id);
    for (const must of [
      "global_rules", "skills", "commands", "agent_defs", "memories",
      "main_config", "v2_config", "plugin_manifests",
      "hooks_config", "mcp_config", "app_settings", "provider_config", "bot_config",
      "agents_state", "openviking_state", "user_scripts", "plugin_state",
      "session_db", "artifacts", "rollout", "tasks_index", "v2_sessions",
      "checkpoints", "visualizations",
      "credentials", "caches",
    ]) {
      expect(ids).toContain(must);
    }
    const get = (id: string) => zcode.categories.find((c) => c.id === id)!;
    expect(get("skills").tier).toBe("recommended");
    expect(get("session_db").tier).toBe("full");
    expect(get("session_db").strategy).toBe("sqlite");
    expect(get("main_config").strategy).toBe("copy_text_path_adapt");
    // E4：三个新类别（hooks/应用设置/服务商）同样需要路径适配
    expect(get("hooks_config").strategy).toBe("copy_text_path_adapt");
    expect(get("app_settings").strategy).toBe("copy_text_path_adapt");
    expect(get("provider_config").strategy).toBe("copy_text_path_adapt");
    // E5：检查点/可视化归完整档
    expect(get("checkpoints").tier).toBe("full");
    expect(get("visualizations").tier).toBe("full");
    expect(get("credentials").tier).toBe("excluded");
    expect(get("caches").strategy).toBe("excluded");
    // E3：凭据类别警告透传（点名具体字段），其余类别无警告
    expect(get("provider_config").pack_warning).toBe(
      "本包含 API 凭据：v2/provider_config.json 的 access.apiKey（嵌套字段）将随包迁移，请妥善保管迁移包",
    );
    expect(get("openviking_state").pack_warning).toBe(
      "本包含 API 凭据：openviking/ 配置的 userKey 将随包迁移，请妥善保管迁移包",
    );
    expect(
      zcode.categories
        .filter((c) => c.id !== "provider_config" && c.id !== "openviking_state")
        .every((c) => c.pack_warning === null),
    ).toBe(true);
    // 展示名非空且中文（UI 不显示内部 id）
    for (const c of zcode.categories) {
      expect(c.display_name).not.toBe("");
    }

    // 反向断言（产品收窄）：codex/claude 不得出现在档案列表命令——档案选择与打包入口仅 ZCode；
    // 其档案定义保留在数据模块（契约由 profile.test.ts 直测数据模块承接），仅供旧包解包推导。
    expect(profiles.some((p) => p.id === "codex" || p.id === "claude")).toBe(false);
  });

  it("反向：codex/claude 无打包入口——scan_assets/pack_assets 层直接拒绝（旧档案仅供旧包解包推导）", async () => {
    const root = await tempDir();
    // requireProfile 走在产档案清单（仅 zcode），codex/claude 一律报 path_setup，
    // 防止注册中心将来被改回全量导致打包入口复活
    await expect(scanAssets("codex", root)).rejects.toMatchObject({ code: "path_setup" });
    await expect(scanAssets("claude", root)).rejects.toMatchObject({ code: "path_setup" });
    expect(profileById("codex")).toBeNull();
    expect(profileById("claude")).toBeNull();
    // 对照：在产档案 zcode 可正常解析；旧包字典仍含全量（解包侧依赖）
    expect(profileById("zcode")?.id).toBe("zcode");
    expect(legacyProfileById("codex")?.id).toBe("codex");
    expect(legacyProfileById("claude")?.id).toBe("claude");
  });
});

it("commands_resolve_target_root_derives_zcode_home：zcode 包缺省目标 = 本机 ~/.zcode（唯一在产档案）", async () => {
  const root = await tempDir();
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "SKILL.md"), "技能");
  const out = path.join(root, "zcode-包.zam");
  await pack(profileByIdOrThrow("zcode"), root, ["skills"], "custom", out, [], APP_VERSION, () => {});
  expect(await resolveTargetRoot(out, undefined)).toBe(path.join(homeDir(), ".zcode"));
});

it("commands_resolve_target_root_derives_codex_home_legacy_package：旧包兼容——codex/claude 旧包缺省目标仍 = 本机对应家目录", async () => {
  // 旧包模拟：用旧版注册形态（已知档案全集）打出的包。收窄后 codex/claude 无打包入口，
  // 此处直接经 legacyProfileById 取档案数据构造"历史上打出的包"，验证解包推导不被收窄破坏。
  {
    const root = await tempDir();
    fs.writeFileSync(path.join(root, "config.toml"), "x = 1\n");
    const out = path.join(root, "codex-包.zam");
    await pack(legacyProfileOrThrow("codex"), root, ["main_config"], "custom", out, [], APP_VERSION, () => {});
    expect(await resolveTargetRoot(out, undefined)).toBe(path.join(homeDir(), ".codex"));
  }
  {
    const root = await tempDir();
    fs.writeFileSync(path.join(root, "settings.json"), "{}");
    const out = path.join(root, "claude-包.zam");
    await pack(legacyProfileOrThrow("claude"), root, ["settings"], "custom", out, [], APP_VERSION, () => {});
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

function legacyProfileOrThrow(id: string) {
  const p = legacyProfileById(id);
  if (!p) throw new AppError("path_setup", `未知档案：${id}`);
  return p;
}
