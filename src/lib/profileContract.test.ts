// 契约守护测试：mock 类别表 ↔ 主进程 list_profiles 输出的一致性（两者同源自引擎档案数据）。
// 防线目标：list_profiles 的 CategoryInfo 映射（tier/strategy 字符串化）与演示层映射
// 任一侧漂移时立即失败；token 警告文案逐字断言防 serde/JSON 漂移。
// （历史教训：前端硬编码假 id 导致真实模式推荐档静默丢 6 类纯资产。）
import { describe, expect, it } from "vitest";
import { listProfiles } from "../../electron/commands";
import {
  MOCK_CLAUDE_CATEGORIES,
  MOCK_CODEX_CATEGORIES,
  MOCK_ZCODE_CATEGORIES,
} from "./mock";

describe("档案契约守护（list_profiles ↔ mock 类别表，同源引擎数据）", () => {
  it("mock 三张类别表与 list_profiles 输出逐字段一致（id/档位/策略/pack_warning）", () => {
    const profiles = listProfiles();
    expect(profiles).toHaveLength(3);
    expect(profiles.map((p) => p.id)).toEqual(["zcode", "codex", "claude"]);
    expect(MOCK_ZCODE_CATEGORIES).toEqual(profiles[0].categories);
    expect(MOCK_CODEX_CATEGORIES).toEqual(profiles[1].categories);
    expect(MOCK_CLAUDE_CATEGORIES).toEqual(profiles[2].categories);
  });

  it("类别数：zcode 15 / codex 15 / claude 10（与引擎档案锁定一致）", () => {
    expect(MOCK_ZCODE_CATEGORIES).toHaveLength(15);
    expect(MOCK_CODEX_CATEGORIES).toHaveLength(15);
    expect(MOCK_CLAUDE_CATEGORIES).toHaveLength(10);
  });
});

describe("token 警告文案防线（JSON 序列化漂移哨兵）", () => {
  it("codex main_config 的 pack_warning 与引擎文案逐字一致", () => {
    const c = MOCK_CODEX_CATEGORIES.find((x) => x.id === "main_config");
    expect(c?.pack_warning).toBe(
      "本包含 API 凭据：config.toml 的 experimental_bearer_token 将随包迁移，请妥善保管迁移包",
    );
    // codex 其余类别一律无警告
    expect(
      MOCK_CODEX_CATEGORIES.filter((x) => x.id !== "main_config").every(
        (x) => x.pack_warning === null,
      ),
    ).toBe(true);
  });

  it("claude settings 的 pack_warning 与引擎文案逐字一致", () => {
    const c = MOCK_CLAUDE_CATEGORIES.find((x) => x.id === "settings");
    expect(c?.pack_warning).toBe(
      "本包含 API 凭据：settings.json 的 ANTHROPIC_AUTH_TOKEN 将随包迁移，请妥善保管迁移包",
    );
    // claude 其余类别一律无警告
    expect(
      MOCK_CLAUDE_CATEGORIES.filter((x) => x.id !== "settings").every(
        (x) => x.pack_warning === null,
      ),
    ).toBe(true);
  });

  it("zcode 全部类别无 pack_warning（回归锁：zcode warnings 行为零变化）", () => {
    expect(MOCK_ZCODE_CATEGORIES.every((x) => x.pack_warning === null)).toBe(true);
  });
});
