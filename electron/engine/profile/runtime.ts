// 档案运行时定位：家目录与默认资产根目录。
// 家目录取值口径的唯一实现（档案默认根、设置默认输出目录共用）。

import { join } from "node:path";
import type { Profile } from "./types";

/** 用户家目录：Windows 优先 USERPROFILE，其余平台 HOME；取不到为空串。 */
export function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || "";
}

/** 档案对应的家目录子目录名（各档案自带映射，非裸 id）。 */
export function homeDirName(profileId: string): string {
  switch (profileId) {
    case "zcode":
      return ".zcode";
    case "codex":
      return ".codex";
    case "claude":
      return ".claude";
    default:
      return profileId;
  }
}

/** 该档案根目录在本机的默认位置（home 下的软件目录）。 */
export function defaultRoot(profile: Profile): string {
  return join(homeDir(), homeDirName(profile.id));
}
