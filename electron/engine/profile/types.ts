// 资产档案（profile）类型与纯逻辑：档案 = 软件 → 资产类别 → 路径规则 → 处理策略。
// 纯数据模块：不依赖 Node API，可被渲染进程（mock 演示层）与主进程引擎共同引用——
// 迁移后三档案类别表只有一个事实来源（前端不再手写第二份）。

export type CategoryStrategy =
  | { kind: "Copy" }
  | { kind: "CopyTextNeedsPathAdapt" }
  | { kind: "SqliteDb" }
  | { kind: "Excluded" };

export type PathRule =
  | { type: "File"; rel: string }
  | { type: "Dir"; rel: string }
  | { type: "Many"; rels: string[] };

export type PresetTier = "Recommended" | "Full";

export interface AssetCategory {
  /** 稳定标识（如 "skills"），manifest 与 UI 依赖。 */
  id: string;
  /** 中文展示名。 */
  display_name: string;
  /** 一句话说明（UI 展示）。 */
  description: string;
  tier: PresetTier;
  strategy: CategoryStrategy;
  rule: PathRule;
  /** 该类别入包时必须写入 manifest.warnings 的具体警告；null = 无（文案沉在档案数据里）。 */
  pack_warning: string | null;
}

export interface Profile {
  id: string;
  display_name: string;
  /** 档案版本（写入 manifest，用于兼容判断）。 */
  version: number;
  categories: AssetCategory[];
}

export type Preset =
  | { kind: "Recommended" }
  | { kind: "Full" }
  | { kind: "Custom"; ids: string[] };

/** 按类别 id 查找。 */
export function categoryOf(profile: Profile, id: string): AssetCategory | undefined {
  return profile.categories.find((c) => c.id === id);
}

/** 解析档位为类别 id 集合（保持档案内顺序；排除项任何档位都不可选入）。 */
export function categoryIdsForPreset(profile: Profile, preset: Preset): string[] {
  const packable = (c: AssetCategory) => c.strategy.kind !== "Excluded";
  switch (preset.kind) {
    case "Recommended":
      return profile.categories
        .filter((c) => c.tier === "Recommended" && packable(c))
        .map((c) => c.id);
    case "Full":
      return profile.categories.filter(packable).map((c) => c.id);
    case "Custom":
      return profile.categories
        .filter((c) => preset.ids.includes(c.id) && packable(c))
        .map((c) => c.id);
  }
}

/** tier → 稳定字符串契约（Excluded 策略的类别序列化 tier 折为 "excluded"）。 */
export function tierStr(tier: PresetTier, strategy: CategoryStrategy): "recommended" | "full" | "excluded" {
  if (strategy.kind === "Excluded") return "excluded";
  return tier === "Recommended" ? "recommended" : "full";
}

/** strategy → 稳定字符串契约（前端 CategoryInfo.strategy）。 */
export function strategyStr(strategy: CategoryStrategy): "copy" | "copy_text_path_adapt" | "sqlite" | "excluded" {
  switch (strategy.kind) {
    case "Copy":
      return "copy";
    case "CopyTextNeedsPathAdapt":
      return "copy_text_path_adapt";
    case "SqliteDb":
      return "sqlite";
    case "Excluded":
      return "excluded";
  }
}
