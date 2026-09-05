// 命令层：前端 IPC ↔ 引擎的桥接（对应 Rust 版 commands.rs）。
// 本模块不 import Electron——保持 vitest 可直测；Electron 侧装配（ipcMain.handle、
// 进度事件桥、错误信封）在 main.ts 完成。

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  executeApply,
  openPackage,
  planApply,
  type ApplyPlan,
  type ApplyMode,
  type ApplyReport,
} from "./engine/applier";
import { AppError } from "./engine/error";
import { pack, readManifest, type PackResult } from "./engine/packer";
import {
  applyMappings,
  detect,
  type DetectResult,
  type PathFixReport,
} from "./engine/pathfix";
import { builtinProfiles, defaultRoot, homeDir, profileById } from "./engine/profile";
import { strategyStr, tierStr, type Profile } from "./engine/profile/types";
import type { ProgressFn } from "./engine/progress";
import { scan, type ScanReport } from "./engine/scanner";
import type { ProfileSummary, Settings } from "./protocol";

/** 列出内置档案（UI 档案选择与档位判定的唯一数据源）。 */
export function listProfiles(): ProfileSummary[] {
  return builtinProfiles().map((p) => ({
    id: p.id,
    display_name: p.display_name,
    version: p.version,
    category_count: p.categories.length,
    default_root: defaultRoot(p),
    categories: p.categories.map((c) => ({
      id: c.id,
      display_name: c.display_name,
      description: c.description,
      tier: tierStr(c.tier, c.strategy),
      strategy: strategyStr(c.strategy),
      pack_warning: c.pack_warning,
    })),
  }));
}

function requireProfile(profileId: string): Profile {
  const p = profileById(profileId);
  if (!p) throw new AppError("path_setup", `未知档案：${profileId}`);
  return p;
}

/** 扫描盘点（完整档含数百 MB 库的全量哈希；root 缺省用档案默认根）。 */
export async function scanAssets(profileId: string, root?: string): Promise<ScanReport> {
  const profile = requireProfile(profileId);
  return scan(profile, root && root.length > 0 ? root : defaultRoot(profile));
}

/** 打包参数（pack_assets）。 */
export interface PackAssetsArgs {
  profileId: string;
  root: string;
  categories: string[];
  presetKind: string;
  outputPath: string;
  warnings: string[];
  appVersion: string;
}

export function packAssets(args: PackAssetsArgs, progress: ProgressFn): Promise<PackResult> {
  const profile = requireProfile(args.profileId);
  return pack(
    profile,
    args.root,
    args.categories,
    args.presetKind,
    args.outputPath,
    args.warnings,
    args.appVersion,
    progress,
  );
}

/** 打开并校验包（逐文件哈希校验）。 */
export function openPackageCmd(packagePath: string, progress: ProgressFn) {
  return openPackage(packagePath, progress);
}

/** 解包目标根目录解析：显式传入（非空）优先；否则读包内档案推导该软件的本机资产目录
 *  （如 ZCode → `~/.zcode`）。真实试用事故修复：此前目标固定为包旁 `-restored` 目录，
 *  导致"解包成功但 ZCode 无变化"。 */
export async function resolveTargetRoot(packagePath: string, targetRoot?: string): Promise<string> {
  if (targetRoot !== undefined && targetRoot.trim().length > 0) {
    return targetRoot.trim();
  }
  const manifest = await readManifest(packagePath);
  const profile = profileById(manifest.profile_id);
  if (!profile) {
    throw new AppError("invalid_package", `未知档案：${manifest.profile_id}`);
  }
  return defaultRoot(profile);
}

/** 生成 dry-run 计划（纯只读；增量模式的冲突改判经 conflictOverrides 传入）。 */
export async function planApplyCmd(
  args: { path: string; mode: ApplyMode; conflictOverrides?: string[]; targetRoot?: string },
  progress: ProgressFn,
): Promise<ApplyPlan> {
  const target = await resolveTargetRoot(args.path, args.targetRoot);
  return planApply(args.path, target, args.mode, args.conflictOverrides ?? [], progress);
}

/** 执行已确认计划（令牌双道校验在引擎内完成）。 */
export function executeApplyCmd(plan: ApplyPlan, progress: ProgressFn): Promise<ApplyReport> {
  return executeApply(plan, progress);
}

/** 检出旧机路径映射建议（读已解包目标树，纯只读）。 */
export async function detectPathMappingsCmd(
  packagePath: string,
  targetRoot?: string,
): Promise<DetectResult> {
  const manifest = await readManifest(packagePath);
  const target = await resolveTargetRoot(packagePath, targetRoot);
  return detect(target, manifest);
}

/** 路径映射入参。 */
export interface PathMappingIn {
  old: string;
  new: string;
}

/** 应用路径映射（用户确认后的旧→新列表；替换前必备份——红线不可关闭）。 */
export async function applyPathMappingsCmd(
  packagePath: string,
  mappings: PathMappingIn[],
  targetRoot?: string,
): Promise<PathFixReport> {
  const manifest = await readManifest(packagePath);
  const target = await resolveTargetRoot(packagePath, targetRoot);
  const pairs = mappings.map((m) => [m.old, m.new] as [string, string]);
  // 备份固定开启：任何替换前必备份是决策红线，命令层不留关闭口子
  return applyMappings(target, manifest, pairs, true);
}

/** 设置文件路径（userData 目录下；由 main.ts 提供 userData）。 */
export function settingsPathIn(userDataDir: string): string {
  return path.join(userDataDir, "settings.json");
}

/** 读取设置（无文件时按首用默认值：家目录下存在 Downloads 目录则作为默认输出目录）。 */
export async function loadSettingsFrom(settingsPath: string): Promise<Settings> {
  if (!fs.existsSync(settingsPath) || !fs.statSync(settingsPath).isFile()) {
    return { default_output_dir: defaultOutputDirIn(homeDir()) };
  }
  const text = await fsp.readFile(settingsPath, "utf8");
  try {
    return JSON.parse(text) as Settings;
  } catch (e) {
    throw new AppError("internal", `设置解析失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 首用默认输出目录推导（纯函数便于测试）：home 下有 Downloads 目录则采用，否则空。 */
export function defaultOutputDirIn(home: string): string {
  const dir = path.join(home, "Downloads");
  try {
    return fs.statSync(dir).isDirectory() ? dir : "";
  } catch {
    return "";
  }
}

/** 保存设置。 */
export async function saveSettingsTo(settingsPath: string, settings: Settings): Promise<void> {
  await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
  await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}
