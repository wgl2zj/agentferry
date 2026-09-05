// 档案注册中心：内置三档案（zcode/codex/claude）的唯一清单。
// 新增软件 = 新增档案数据文件 + 在此注册一行。

import { claudeProfile } from "./claude";
import { codexProfile } from "./codex";
import { defaultRoot, homeDir } from "./runtime";
import type { Profile } from "./types";
import { zcodeProfile } from "./zcode";

/** 内置档案清单（档案数据驱动，后续按实测增补；顺序即 UI 展示顺序）。 */
export function builtinProfiles(): Profile[] {
  return [zcodeProfile(), codexProfile(), claudeProfile()];
}

/** 按 id 取内置档案；未知 id 返回 null（命令层报 path_setup）。 */
export function profileById(id: string): Profile | null {
  return builtinProfiles().find((p) => p.id === id) ?? null;
}

export { defaultRoot, homeDir };
