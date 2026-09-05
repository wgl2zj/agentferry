// @vitest-environment node
// 档案（profile）模块测试：Rust profile/mod.rs + codex.rs + claude.rs 内联测试的逐条翻译。
// 测试名与 Rust 侧一致，FEATURE_MAP 的"测试锁定"标注继续有效。

import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeProfile } from "./profile/claude";
import { codexProfile } from "./profile/codex";
import { categoryIdsForPreset, categoryOf } from "./profile/types";
import type { Profile } from "./profile/types";
import { zcodeProfile } from "./profile/zcode";

describe("profile_preset_filters_categories（zcode 档位解析）", () => {
  it("推荐档只含纯资产，完整档排除 Excluded，自定义档过滤排除项", () => {
    const profile = zcodeProfile();
    const rec = categoryIdsForPreset(profile, { kind: "Recommended" });
    expect(rec).toContain("skills");
    expect(rec).not.toContain("session_db");
    // 排除项（凭据/缓存）不得混入任何档位
    expect(rec).not.toContain("credentials");
    expect(rec).not.toContain("caches");

    const full = categoryIdsForPreset(profile, { kind: "Full" });
    expect(full).toContain("session_db");
    expect(full).not.toContain("credentials");
    expect(full).not.toContain("caches");

    // 自定义档请求排除类别时被过滤掉
    const custom = categoryIdsForPreset(profile, { kind: "Custom", ids: ["skills", "credentials"] });
    expect(custom).toEqual(["skills"]);
  });
});

describe("codex 档案", () => {
  it("codex_preset_filters_categories：推荐档六个纯资产类别，排除项任何档位不可选", () => {
    const p = codexProfile();
    const rec = categoryIdsForPreset(p, { kind: "Recommended" });
    expect(rec).toEqual([
      "global_rules",
      "main_config",
      "skills",
      "rules",
      "memories_dir",
      "memories_db",
    ]);
    const full = categoryIdsForPreset(p, { kind: "Full" });
    expect(full).toContain("sessions");
    expect(full).toContain("session_index");
    expect(full).toContain("plugins_sources");
    expect(full).not.toContain("credentials");
    expect(full).not.toContain("caches");
    const custom = categoryIdsForPreset(p, { kind: "Custom", ids: ["skills", "credentials"] });
    expect(custom).toEqual(["skills"]);
  });

  it("codex_default_root_maps_to_dot_dir：默认根映射到家目录下 .codex（home_dir_name 映射，非裸 id）", async () => {
    const { defaultRoot, homeDir } = await import("./profile/runtime");
    expect(defaultRoot(codexProfile())).toBe(path.join(homeDir(), ".codex"));
  });

  it("codex_main_config_carries_token_warning：token 警告沉在档案数据里（决策 1-A）", () => {
    const p = codexProfile();
    const warning = categoryOf(p, "main_config")?.pack_warning;
    expect(warning).toBeTruthy();
    expect(warning).toContain("experimental_bearer_token");
    // 其余类别无警告
    expect(p.categories.filter((c) => c.id !== "main_config").every((c) => c.pack_warning === null)).toBe(true);
  });

  it("codex_key_strategies：主配置与会话索引需路径适配，两个 SQLite 库走 wal 阻断", () => {
    const p = codexProfile();
    const get = (id: string) => categoryOf(p, id)!;
    expect(get("main_config").strategy).toEqual({ kind: "CopyTextNeedsPathAdapt" });
    expect(get("session_index").strategy).toEqual({ kind: "CopyTextNeedsPathAdapt" });
    expect(get("plugins_sources").strategy).toEqual({ kind: "CopyTextNeedsPathAdapt" });
    expect(get("memories_db").strategy).toEqual({ kind: "SqliteDb" });
    expect(get("goals_db").strategy).toEqual({ kind: "SqliteDb" });
    expect(get("credentials").strategy).toEqual({ kind: "Excluded" });
    expect(get("caches").strategy).toEqual({ kind: "Excluded" });
  });
});

describe("claude 档案", () => {
  it("claude_preset_filters_categories：推荐档四个纯资产类别，排除项任何档位不可选", () => {
    const p = claudeProfile();
    const rec = categoryIdsForPreset(p, { kind: "Recommended" });
    expect(rec).toEqual(["settings", "global_memory", "skills", "plugins"]);
    const full = categoryIdsForPreset(p, { kind: "Full" });
    expect(full).toContain("projects");
    expect(full).toContain("history");
    expect(full).not.toContain("config");
    expect(full).not.toContain("caches");
    const custom = categoryIdsForPreset(p, { kind: "Custom", ids: ["skills", "config"] });
    expect(custom).toEqual(["skills"]);
  });

  it("claude_default_root_maps_to_dot_dir：默认根映射到家目录下 .claude", async () => {
    const { defaultRoot, homeDir } = await import("./profile/runtime");
    expect(defaultRoot(claudeProfile())).toBe(path.join(homeDir(), ".claude"));
  });

  it("claude_settings_carries_token_warning：settings 携带具体字段名的警告（决策 1-A）", () => {
    const p = claudeProfile();
    const warning = categoryOf(p, "settings")?.pack_warning;
    expect(warning).toBeTruthy();
    expect(warning).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(p.categories.filter((c) => c.id !== "settings").every((c) => c.pack_warning === null)).toBe(true);
  });

  it("claude_key_strategies：settings 需路径适配，凭据与缓存排除，无 SQLite 类别", () => {
    const p = claudeProfile();
    const get = (id: string) => categoryOf(p, id)!;
    expect(get("settings").strategy).toEqual({ kind: "CopyTextNeedsPathAdapt" });
    expect(get("config").strategy).toEqual({ kind: "Excluded" });
    expect(get("caches").strategy).toEqual({ kind: "Excluded" });
    expect(p.categories.every((c) => c.strategy.kind !== "SqliteDb")).toBe(true);
  });
});

/** 未使用的导入守卫（保持 noUnusedLocals 干净）：类型仅在断言辅助中使用。 */
const _typeGuard: Profile["categories"] = [];
void _typeGuard;
