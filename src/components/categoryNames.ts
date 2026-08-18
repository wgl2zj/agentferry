// 类别展示与档位判定：唯一数据源是 list_profiles 返回的 ProfileSummary.categories
// （CategoryInfo{id, display_name, tier, strategy}），前端禁止硬编码类别 id。
import type { CategoryInfo } from "../lib/ipc";

export type PresetKind = "recommended" | "full" | "custom";

/** 类别中文名：以档案类别表为准，未知名称回退为原始 id（新增类别不报错）。 */
export function categoryLabel(categories: CategoryInfo[], id: string): string {
  return categories.find((c) => c.id === id)?.display_name ?? id;
}

/** 推荐档包含的类别：tier === "recommended"（excluded 类别 tier 已折为 "excluded"）。 */
export function recommendedIds(categories: CategoryInfo[]): string[] {
  return categories.filter((c) => c.tier === "recommended").map((c) => c.id);
}

/** 完整档包含的类别：全部非 excluded。 */
export function fullIds(categories: CategoryInfo[]): string[] {
  return categories.filter((c) => c.tier !== "excluded").map((c) => c.id);
}

/** 永不迁移的排除类（凭据、可再生缓存），展示在"不迁移"区。 */
export function excludedCategories(categories: CategoryInfo[]): CategoryInfo[] {
  return categories.filter((c) => c.tier === "excluded");
}
