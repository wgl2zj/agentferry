// 解包引擎：校验 `.zam` 包 → dry-run 变更计划（四组动作）→ 确认后执行（备份→写入→复验）。
// 安全铁律：计划未确认（令牌不符）绝不写目标；两种模式都不删除目标任何已有文件；
// 任何"替换已存在文件"的动作执行前先把原文件备份到 `zam-backups/<时间戳>/`。

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { AppError } from "./error";
import type { ProgressFn } from "./progress";
import { readManifest, type Manifest } from "./packer";
import { sha256File } from "./scanner";
import { entryStream, openZip, requireEntry } from "./zipio";

/** 备份根目录名（位于解包目标根下）。 */
export const BACKUP_DIR = "zam-backups";
/** 备份保留次数上限；超过时返回提示（不静默删除）。 */
export const BACKUP_KEEP = 5;

/** 解包模式（序列化契约：小写字面量）。 */
export type ApplyMode = "overwrite" | "incremental";

/** 单文件动作判定（序列化契约：snake_case 字面量）。 */
export type ActionKind = "create" | "skip_same" | "replace" | "keep";

/** dry-run 计划中的单条动作。 */
export interface PlanItem {
  target_rel: string;
  category: string;
  sha256: string;
  size: number;
  action: ActionKind;
  /** 冲突文件当前目标侧哈希（仅冲突时有值，供 UI 展示差异）。 */
  target_sha256: string | null;
}

/** dry-run 变更计划。 */
export interface ApplyPlan {
  /** 参与的包路径（执行时核对）。 */
  package_path: string;
  /** 解包目标根目录（执行与令牌校验均以此为准，防生成计划后目标被篡改）。 */
  target_root: string;
  mode: ApplyMode;
  /** 包内文件的 SHA-256 快照（执行时核对，防包被调包）。 */
  package_digest: string;
  items: PlanItem[];
  /** 计划摘要令牌：execute_apply 必须原样回传且与重算一致。 */
  plan_token: string;
  /** 用户确认的冲突改判清单（增量模式）。执行时据此独立重放核对，
   *  不得从 items 反推（防计划被篡改后自我认证）。 */
  confirmed_overrides: string[];
  /** 执行前的备份清理提示（备份超限时非空）。 */
  backup_cleanup_hint: string | null;
}

/** 执行结果。 */
export interface ApplyReport {
  target_root: string;
  executed: ExecutedItem[];
  backup_dir: string | null;
  verified_files: number;
}

export interface ExecutedItem {
  target_rel: string;
  action: ActionKind;
  /** 执行结果（ok=已写入并复验，skipped=计划内跳过）。 */
  status: "ok" | "skipped";
}

/** 令牌哈希用的动作名（内部一致性口径，与 Rust Debug 格式一致；不跨版本持久化）。 */
const ACTION_DEBUG: Record<ActionKind, string> = {
  create: "Create",
  skip_same: "SkipSame",
  replace: "Replace",
  keep: "Keep",
};

/** 打开并完整校验包（manifest 解析 + 逐文件哈希校验）。
 *  性能约束：归档全程只打开一次——每文件重开归档会各自完整解析一遍中央目录，
 *  文件数 N 时总代价 O(N²)；统一流式哈希，峰值内存不随包内文件增大。 */
export async function openPackage(packagePath: string, progress: ProgressFn): Promise<Manifest> {
  const manifest = await readManifest(packagePath);
  const total = manifest.files.length;
  const opened = await openZip(packagePath, "打开迁移包失败");
  try {
    for (let idx = 0; idx < manifest.files.length; idx += 1) {
      const mf = manifest.files[idx];
      const entry = requireEntry(opened, mf.path, "包内缺少 ");
      const stream = await entryStream(opened.zip, entry);
      const hash = createHash("sha256");
      for await (const chunk of stream) {
        hash.update(chunk as Buffer);
      }
      const sha = hash.digest("hex");
      if (sha !== mf.sha256) {
        throw new AppError("hash_mismatch", `包内文件 ${mf.target_rel} 校验失败（清单 ${mf.sha256}，实际 ${sha}）`);
      }
      progress(idx + 1, total, mf.target_rel);
    }
  } finally {
    opened.close();
  }
  return manifest;
}

/** 计算包整体摘要（全部文件哈希的再哈希，防执行前包被调包）。 */
function packageDigest(manifest: Manifest): string {
  const hash = createHash("sha256");
  for (const f of manifest.files) {
    hash.update(f.target_rel, "utf8");
    hash.update(f.sha256, "utf8");
  }
  return hash.digest("hex");
}

/** 计划摘要令牌：包摘要 + 模式 + 目标根目录 + 全部动作的哈希。任一要素变化令牌即失效。 */
function planToken(packageDigest: string, mode: ApplyMode, targetRoot: string, items: PlanItem[]): string {
  const hash = createHash("sha256");
  hash.update(packageDigest, "utf8");
  hash.update(mode === "overwrite" ? "Overwrite" : "Incremental", "utf8");
  hash.update(targetRoot, "utf8");
  for (const it of items) {
    hash.update(it.target_rel, "utf8");
    hash.update(it.sha256, "utf8");
    hash.update(ACTION_DEBUG[it.action], "utf8");
  }
  return hash.digest("hex");
}

/** 词法路径归一化（不触碰文件系统）：消除 `.` 与 `..` 段与重复分隔符。 */
function lexicalNormalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split(/[\\/]/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** zip-slip 防护（共享校验，makePlan 与 pathfix 统一调用）：
 *  拒绝空路径、含反斜杠、含 `..`、以 `/` 开头、含盘符冒号的相对路径；
 *  并做兜底断言——join 后词法归一化的绝对路径必须仍在 `targetRoot` 前缀下。 */
export function safeJoin(targetRoot: string, rel: string): string {
  if (
    rel === "" ||
    rel.includes("\\") ||
    rel.includes("..") ||
    rel.startsWith("/") ||
    rel.includes(":")
  ) {
    throw new AppError("invalid_package", `清单包含不安全路径：${rel}`);
  }
  const abs = path.join(targetRoot, rel);
  const normalized = lexicalNormalize(abs);
  const normalizedRoot = lexicalNormalize(targetRoot);
  if (!(normalized === normalizedRoot || normalized.startsWith(normalizedRoot + "/"))) {
    throw new AppError("invalid_package", `路径逃逸目标根：${rel}`);
  }
  return abs;
}

/** 备份保留检查：超过 BACKUP_KEEP 次时返回提示（不删除）。 */
async function checkBackupRetention(targetRoot: string): Promise<string | null> {
  const backupRoot = path.join(targetRoot, BACKUP_DIR);
  let stamps: string[] = [];
  try {
    const entries = await fsp.readdir(backupRoot, { withFileTypes: true });
    stamps = entries.filter((e) => e.isDirectory()).map((e) => e.name).filter((n) => n.length > 0);
  } catch {
    return null;
  }
  if (stamps.length >= BACKUP_KEEP) {
    return `备份目录已有 ${stamps.length} 次历史备份（保留上限 ${BACKUP_KEEP} 次），建议清理旧备份后继续；本次将继续创建新备份`;
  }
  return null;
}

/** 生成 dry-run 计划（纯只读：只读包与目标目录，不写任何文件）。
 *  `targetRoot`：解包目标根目录（显式指定；UI 默认按档案推导为本机资产目录）。
 *  `conflictOverrides`：增量模式下把指定 target_rel 的冲突改判为"备份后替换"；
 *  覆盖模式忽略该参数（全部冲突本来就是替换）。 */
export async function makePlan(
  packagePath: string,
  manifest: Manifest,
  targetRoot: string,
  mode: ApplyMode,
  conflictOverrides: string[],
): Promise<ApplyPlan> {
  const digest = packageDigest(manifest);
  const items: PlanItem[] = [];
  for (const mf of manifest.files) {
    const abs = safeJoin(targetRoot, mf.target_rel);
    // 目标哈希只算一次（存在时），判定与展示复用
    const existingSha = (await fsp.stat(abs).then((s) => (s.isFile() ? s : null)).catch(() => null))
      ? await sha256File(abs)
      : null;
    let action: ActionKind;
    if (existingSha === null) {
      action = "create";
    } else if (existingSha === mf.sha256) {
      action = "skip_same";
    } else if (mode === "overwrite") {
      action = "replace";
    } else {
      action = conflictOverrides.includes(mf.target_rel) ? "replace" : "keep";
    }
    items.push({
      target_rel: mf.target_rel,
      category: mf.category,
      sha256: mf.sha256,
      size: mf.size,
      action,
      target_sha256: existingSha,
    });
  }
  const targetRootStr = targetRoot;
  const token = planToken(digest, mode, targetRootStr, items);
  const backupCleanupHint = await checkBackupRetention(targetRoot);
  return {
    package_path: packagePath,
    target_root: targetRootStr,
    mode,
    package_digest: digest,
    items,
    plan_token: token,
    confirmed_overrides: conflictOverrides,
    backup_cleanup_hint: backupCleanupHint,
  };
}

/** dry-run 计划入口：打开校验包 + 生成计划（纯只读）。 */
export async function planApply(
  packagePath: string,
  targetRoot: string,
  mode: ApplyMode,
  conflictOverrides: string[],
  progress: ProgressFn,
): Promise<ApplyPlan> {
  const manifest = await openPackage(packagePath, progress);
  return makePlan(packagePath, manifest, targetRoot, mode, conflictOverrides);
}

/** 执行已确认的计划到指定目标根（executeApply 的可指定目标版本，测试与自定义解包路径共用）。
 *
 * 安全检查（任一不符即拒绝，目标零写入）：
 * 1. `plan.plan_token` 与传入 items 摘要一致（计划未被篡改，含目标根目录）；
 * 2. 独立重放核对：用计划携带的"用户确认改判清单"重建计划比对——包被调包、
 *    目标已变化、改判清单被篡改都会导致不一致；
 * 3. 执行动作只可能是 Create / Replace / SkipSame / Keep——不存在删除。 */
export async function executeApplyTo(
  plan: ApplyPlan,
  targetRoot: string,
  progress: ProgressFn,
): Promise<ApplyReport> {
  if (!fs.existsSync(plan.package_path) || !fs.statSync(plan.package_path).isFile()) {
    throw new AppError("invalid_package", `迁移包不存在：${plan.package_path}`);
  }
  const manifest = await readManifest(plan.package_path);

  // 第一道：传入计划的 items 摘要必须与其令牌一致（防计划对象被篡改后仍持有旧令牌）
  const itemsDigest = planToken(plan.package_digest, plan.mode, plan.target_root, plan.items);
  if (itemsDigest !== plan.plan_token) {
    throw new AppError("plan_not_confirmed", "计划令牌校验失败：计划内容与令牌不符，请重新生成计划");
  }
  // 第二道：独立重放核对
  const replay = await makePlan(plan.package_path, manifest, targetRoot, plan.mode, plan.confirmed_overrides);
  if (replay.plan_token !== plan.plan_token || replay.package_digest !== plan.package_digest) {
    throw new AppError("plan_not_confirmed", "计划令牌校验失败：包或目标已变化，请重新生成计划");
  }

  // 备份目录（仅当存在 Replace 动作时创建）
  const hasReplace = plan.items.some((i) => i.action === "replace");
  const stamp = localStamp();
  const backupDir = hasReplace ? path.join(targetRoot, BACKUP_DIR, stamp) : null;
  if (backupDir) {
    await fsp.mkdir(backupDir, { recursive: true });
  }

  const total = plan.items.length;
  const executed: ExecutedItem[] = [];
  let verified = 0;

  // 打开一次 zip 归档，逐条流式写盘（大文件不整块进内存）
  const opened = await openZip(plan.package_path, "包损坏");
  try {
    for (let idx = 0; idx < plan.items.length; idx += 1) {
      const item = plan.items[idx];
      if (item.action === "create" || item.action === "replace") {
        const abs = safeJoin(targetRoot, item.target_rel);
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        if (item.action === "replace") {
          // 备份原文件（保持相对路径结构）
          const backupPath = path.join(targetRoot, BACKUP_DIR, stamp, item.target_rel);
          await fsp.mkdir(path.dirname(backupPath), { recursive: true });
          await fsp.copyFile(abs, backupPath);
        }
        // 流式写入包内内容
        const entry = requireEntry(opened, `payload/${item.target_rel}`, "包内缺少 ");
        const stream = await entryStream(opened.zip, entry);
        const out = fs.createWriteStream(abs);
        await new Promise<void>((resolve, reject) => {
          stream.pipe(out);
          out.on("finish", () => resolve());
          out.on("error", (e) => reject(new AppError("io", e.message)));
          stream.on("error", (e) => reject(new AppError("io", e.message)));
        });
        // 逐文件复验
        const sha = await sha256File(abs);
        if (sha !== item.sha256) {
          throw new AppError("hash_mismatch", `写入后复验失败：${item.target_rel}（期望 ${item.sha256}，实际 ${sha}），已停止后续写入`);
        }
        verified += 1;
        executed.push({ target_rel: item.target_rel, action: item.action, status: "ok" });
      } else if (item.action === "skip_same") {
        verified += 1;
        executed.push({ target_rel: item.target_rel, action: item.action, status: "skipped" });
      } else {
        executed.push({ target_rel: item.target_rel, action: item.action, status: "skipped" });
      }
      progress(idx + 1, total, item.target_rel);
    }
  } finally {
    opened.close();
  }

  return {
    target_root: targetRoot,
    executed,
    backup_dir: backupDir,
    verified_files: verified,
  };
}

/** 执行已确认的计划（目标根取 plan.target_root）。 */
export function executeApply(plan: ApplyPlan, progress: ProgressFn): Promise<ApplyReport> {
  return executeApplyTo(plan, plan.target_root, progress);
}

/** 本地时间戳（与 Rust chrono Local "%Y%m%d-%H%M%S" 一致）。 */
export function localStamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
