// 档案注册中心：产品在产档案的唯一清单（仅 zcode）+ 旧包档案字典（codex/claude 仅为旧包兼容保留）。
// spec（zcode-v2）实施决策 1：注册中心只注册 zcode；codex/claude 档案定义保留在数据模块，
// 仅供旧迁移包解包时的目标根推导使用，不暴露任何打包入口。

import { claudeProfile } from "./claude";
import { codexProfile } from "./codex";
import { defaultRoot, homeDir } from "./runtime";
import type { Profile } from "./types";
import { zcodeProfile } from "./zcode";

/** 在产档案清单（产品收窄后仅 zcode；list_profiles 与打包/扫描入口的唯一数据源）。 */
export function builtinProfiles(): Profile[] {
  return [zcodeProfile()];
}

/** 按 id 取在产档案；未知 id 返回 null（命令层报 path_setup——codex/claude 不再可打包/扫描）。 */
export function profileById(id: string): Profile | null {
  return builtinProfiles().find((p) => p.id === id) ?? null;
}

/** 已知档案全集（在产 zcode + 仅旧包兼容的 codex/claude）。
 *  唯一用途：解包向导按旧迁移包 manifest 的 profile_id 推导目标根（spec 决策 1）；
 *  不得用于注册打包入口。 */
function knownProfiles(): Profile[] {
  return [zcodeProfile(), codexProfile(), claudeProfile()];
}

/** 按 id 取已知档案（含仅旧包兼容的 codex/claude）；未知 id 返回 null。
 *  仅供 resolveTargetRoot 的旧包目标根推导；打包/扫描请走 profileById。 */
export function legacyProfileById(id: string): Profile | null {
  return knownProfiles().find((p) => p.id === id) ?? null;
}

export { defaultRoot, homeDir };
