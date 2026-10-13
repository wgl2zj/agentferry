// 契约守护测试：mock 类别表 ↔ 主进程 list_profiles 输出的一致性（两者同源自引擎档案数据）。
// 防线目标：list_profiles 的 CategoryInfo 映射（tier/strategy 字符串化）与演示层映射
// 任一侧漂移时立即失败；token 警告文案逐字断言防 serde/JSON 漂移。
// （历史教训：前端硬编码假 id 导致真实模式推荐档静默丢 6 类纯资产。）
// 产品收窄（spec 决策 1）：list_profiles 仅返回 zcode；codex/claude 档案定义保留在
// 数据模块（仅供旧包解包推导），其 mock 表改为直测引擎档案数据的派生一致性。
import { describe, expect, it } from "vitest";
import { listProfiles } from "../../electron/commands";
import { claudeProfile } from "../../electron/engine/profile/claude";
import { codexProfile } from "../../electron/engine/profile/codex";
import {
  MOCK_CLAUDE_CATEGORIES,
  MOCK_CODEX_CATEGORIES,
  MOCK_ZCODE_CATEGORIES,
  toCategoryInfos,
} from "./mock";

describe("档案契约守护（list_profiles ↔ mock 类别表，同源引擎数据）", () => {
  it("list_profiles 仅返回 zcode，mock 类别表与输出逐字段一致（id/档位/策略/pack_warning）", () => {
    const profiles = listProfiles();
    // 产品收窄（spec 决策 1）：注册中心仅 zcode，codex/claude 不出现
    expect(profiles).toHaveLength(1);
    expect(profiles.map((p) => p.id)).toEqual(["zcode"]);
    expect(MOCK_ZCODE_CATEGORIES).toEqual(profiles[0].categories);
  });

  it("旧包兼容档案表（codex/claude mock 表）仍与引擎档案数据派生一致——档案定义保留的契约锁", () => {
    // codex/claude 不在 list_profiles 输出中，但其 mock 表必须继续从引擎数据模块派生
    //（删除/漂移档案定义或 mock 手写漂移时此处变红——旧包解包的类别名解析依赖它）
    expect(MOCK_CODEX_CATEGORIES).toEqual(toCategoryInfos(codexProfile().categories));
    expect(MOCK_CLAUDE_CATEGORIES).toEqual(toCategoryInfos(claudeProfile().categories));
  });

  it("类别数：zcode 26 / codex 15 / claude 10（与引擎档案锁定一致；zcode v2 = 推荐 17 + 完整 7 + 排除 2）", () => {
    expect(MOCK_ZCODE_CATEGORIES).toHaveLength(26);
    expect(
      MOCK_ZCODE_CATEGORIES.filter((c) => c.tier === "recommended"),
    ).toHaveLength(17);
    expect(MOCK_ZCODE_CATEGORIES.filter((c) => c.tier === "full")).toHaveLength(7);
    expect(MOCK_ZCODE_CATEGORIES.filter((c) => c.tier === "excluded")).toHaveLength(2);
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

  it("zcode 仅两个凭据类别携带 pack_warning 且文案逐字一致（v2 起接入；其余类别零警告）", () => {
    const provider = MOCK_ZCODE_CATEGORIES.find((x) => x.id === "provider_config");
    expect(provider?.pack_warning).toBe(
      "本包含 API 凭据：v2/provider_config.json 的 access.apiKey（嵌套字段）将随包迁移，请妥善保管迁移包",
    );
    const openviking = MOCK_ZCODE_CATEGORIES.find((x) => x.id === "openviking_state");
    expect(openviking?.pack_warning).toBe(
      "本包含 API 凭据：openviking/ 配置的 userKey 将随包迁移，请妥善保管迁移包",
    );
    // 回归锁（v2 形态）：除这两类外全部类别无警告——不选它们时 warnings 行为零变化
    expect(
      MOCK_ZCODE_CATEGORIES.filter(
        (x) => x.id !== "provider_config" && x.id !== "openviking_state",
      ).every((x) => x.pack_warning === null),
    ).toBe(true);
  });
});
