// 契约守护测试：前端 mock 类别表与后端三档案（zcode.rs / codex.rs / claude.rs）静态一致性。
// 防线目标：类别 id / 档位 / 策略 / pack_warning 任何一侧改动而另一侧未同步时，本测试立即失败
//（历史教训：前端硬编码假 id 导致真实模式推荐档静默丢 6 类纯资产；
//  pack_warning 文案必须与后端 serde 输出逐字一致，前端不得手写第二份）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOCK_CLAUDE_CATEGORIES,
  MOCK_CODEX_CATEGORIES,
  MOCK_ZCODE_CATEGORIES,
} from "./mock";
import type { CategoryInfo } from "./ipc";

const PROFILE_DIR = resolve(process.cwd(), "src-tauri/src/profile");

/** Rust 侧 tier/strategy 枚举到 serde 字符串的映射（与 commands.rs 的 tier_str/strategy_str 一致）。 */
const TIER_MAP: Record<string, string> = {
  Recommended: "recommended",
  Full: "full",
};
const STRATEGY_MAP: Record<string, string> = {
  Copy: "copy",
  CopyTextNeedsPathAdapt: "copy_text_path_adapt",
  SqliteDb: "sqlite",
  Excluded: "excluded",
};

interface RustCategory {
  id: string;
  tier: string;
  strategy: string;
  packWarning: string | null;
}

/** 静态解析指定档案 .rs 中每个 AssetCategory 块的 id/tier/strategy/pack_warning。 */
function parseRustCategories(fileName: string): RustCategory[] {
  const src = readFileSync(resolve(PROFILE_DIR, fileName), "utf-8");
  const blocks = src.split("AssetCategory {").slice(1);
  return blocks.map((block) => {
    const id = /id:\s*"([^"]+)"/.exec(block)?.[1];
    const tierRaw = /tier:\s*PresetTier::(\w+)/.exec(block)?.[1];
    const strategyRaw = /strategy:\s*CategoryStrategy::(\w+)/.exec(block)?.[1];
    if (!id || !tierRaw || !strategyRaw) {
      throw new Error(`${fileName} 类别块解析失败：${block.slice(0, 80)}`);
    }
    const strategy = STRATEGY_MAP[strategyRaw];
    // 与后端 tier_str 一致：Excluded 策略的类别序列化 tier 折为 "excluded"
    const tier = strategy === "excluded" ? "excluded" : TIER_MAP[tierRaw];
    // pack_warning：Some("...".into()) 取字面量；None 折为 null
    const someMatch = /pack_warning:\s*Some\(\s*"([^"]+)"/.exec(block);
    const noneMatch = /pack_warning:\s*None/.test(block);
    if (!someMatch && !noneMatch) {
      throw new Error(`${fileName} 类别 ${id} 的 pack_warning 解析失败`);
    }
    return { id, tier, strategy, packWarning: someMatch?.[1] ?? null };
  });
}

/** 三档案对照表：.rs 文件 ↔ mock 类别表（新增档案在此登记一行即可纳入守护）。 */
const PROFILE_PAIRS: { fileName: string; label: string; mock: CategoryInfo[] }[] = [
  { fileName: "zcode.rs", label: "zcode", mock: MOCK_ZCODE_CATEGORIES },
  { fileName: "codex.rs", label: "codex", mock: MOCK_CODEX_CATEGORIES },
  { fileName: "claude.rs", label: "claude", mock: MOCK_CLAUDE_CATEGORIES },
];

describe.each(PROFILE_PAIRS)(
  "档案契约守护（$fileName ↔ mock 类别表）",
  ({ fileName, mock }) => {
    it("类别 id 集合完全一致（顺序无关）", () => {
      const rustIds = parseRustCategories(fileName)
        .map((c) => c.id)
        .sort();
      const mockIds = mock.map((c) => c.id).sort();
      expect(mockIds).toEqual(rustIds);
    });

    it("每个类别的 tier 与 strategy 序列化值一致", () => {
      const rust = parseRustCategories(fileName);
      for (const rc of rust) {
        const mc = mock.find((c) => c.id === rc.id);
        expect(mc, `mock 缺类别 ${rc.id}`).toBeDefined();
        expect(mc!.tier, `${rc.id} 的 tier 不一致`).toBe(rc.tier);
        expect(mc!.strategy, `${rc.id} 的 strategy 不一致`).toBe(rc.strategy);
      }
    });

    it("每个类别的 pack_warning 与 .rs 字面量逐字一致（None ↔ null）", () => {
      const rust = parseRustCategories(fileName);
      for (const rc of rust) {
        const mc = mock.find((c) => c.id === rc.id);
        expect(mc, `mock 缺类别 ${rc.id}`).toBeDefined();
        expect(mc!.pack_warning, `${rc.id} 的 pack_warning 不一致`).toBe(rc.packWarning);
      }
    });
  },
);

describe("token 警告文案防线（serde 漂移哨兵）", () => {
  it("codex main_config 的 pack_warning 与后端文案逐字一致", () => {
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

  it("claude settings 的 pack_warning 与后端文案逐字一致", () => {
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
