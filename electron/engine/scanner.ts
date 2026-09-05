// 资产扫描引擎：按档案盘点任意根目录，产出分类别报告。
// 只读操作：不写入、不修改任何源文件；Excluded 类别只统计体量不读内容。
// 链接（junction/符号链接）按"读 reparse 数据 + 物理路径访问"跟随——提升权限进程
// 穿越链接会被 Windows 重定向信任缓解拒绝（os error 448，真实事故 2026-08-17）。

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { AppError } from "./error";
import type { AssetCategory, PathRule, Profile } from "./profile/types";

/** 文件种类（决定解包与压缩处理方式；序列化契约：小写字面量）。 */
export type FileKind = "text" | "binary" | "sqlite";

export interface ScannedFile {
  /** 相对档案根的路径（统一使用 `/` 分隔，跨平台稳定）。 */
  rel_path: string;
  size: number;
  /** Excluded 类别为空串（刻意不读内容）。 */
  sha256: string;
  kind: FileKind;
  /** 源文件物理绝对路径（链接场景与 path.join(root, rel_path) 不同；仅当次会话内使用；
   *  渲染层演示数据不携带）。 */
  source_abs?: string;
}

/** 类别状态（序列化契约：小写 ready/blocked/missing，前端按字面量判定——
 *  曾因大写 "Ready" 导致前端全部误判为本机不存在）。 */
export type CategoryStatus =
  | { status: "ready" }
  | { status: "blocked"; detail: string }
  | { status: "missing" };

export interface CategoryReport {
  category_id: string;
  status: CategoryStatus;
  files: ScannedFile[];
  total_bytes: number;
}

export interface ScanReport {
  profile_id: string;
  profile_version: number;
  root: string;
  categories: CategoryReport[];
}

/** 把未知异常归一为 IO 错误（对应 Rust `?` 的 From<io::Error>）。 */
function ioErr(e: unknown): AppError {
  if (e instanceof AppError) return e;
  return new AppError("io", e instanceof Error ? e.message : String(e));
}

/** 按扩展名判定文件种类（无扩展名 → 整名参与判定 → binary，与 Rust rsplit 语义一致）。 */
export function kindOf(relPath: string): FileKind {
  const lower = relPath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf(".") + 1);
  switch (ext) {
    case "md":
    case "markdown":
    case "json":
    case "toml":
    case "yaml":
    case "yml":
    case "txt":
    case "csv":
    case "jsonl":
      return "text";
    case "sqlite":
    case "sqlite3":
    case "db":
    case "db3":
      return "sqlite";
    default:
      return "binary";
  }
}

/** 流式计算文件 SHA-256（十六进制小写，64KB 缓冲）。 */
export async function sha256File(p: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const rs = fs.createReadStream(p, { highWaterMark: 64 * 1024 });
    rs.on("data", (chunk) => hash.update(chunk));
    rs.on("end", () => resolve(hash.digest("hex")));
    rs.on("error", (e) => reject(ioErr(e)));
  });
}

/** 把路径规则展开为绝对路径列表（保持档案声明顺序）。 */
function expandRule(root: string, rule: PathRule): string[] {
  if (rule.type === "Many") return rule.rels.map((rel) => path.join(root, rel));
  return [path.join(root, rule.rel)];
}

/** 收集过程中的单个文件：abs 为物理绝对路径（读内容用），rel 为相对档案根的路径
 *  （链接场景下两者不同：rel 记链接位置，abs 指向链接目标实体）。 */
interface Collected {
  abs: string;
  rel: string;
}

/** 解析链接目标并规范化为物理绝对路径（读 reparse 数据，不穿越链接）。
 *  规范化失败时回退原始目标（与 Rust canonicalize().unwrap_or(target) 一致）。 */
async function resolveLinkPhysically(link: string): Promise<string> {
  const target = await fsp.readlink(link).catch((e) => {
    throw ioErr(e);
  });
  const absTarget = path.isAbsolute(target) ? target : path.join(path.dirname(link), target);
  try {
    return await fsp.realpath(absTarget);
  } catch {
    return absTarget;
  }
}

/** 递归收集目录下的真实文件。`dir` 与 abs 全程物理路径；链接在枚举时被解析为
 *  目标物理路径后单独进入。`relPrefix` 为当前层相对档案根的前缀（null 表示
 *  dir 本身位于档案根下）。`ancestors` 记录递归链上展开过的链接物理目标：
 *  目标再次出现即真环，跳过；兄弟位置指向同一目标的链接各自完整收集。 */
async function walkPhysical(
  dir: string,
  relPrefix: string | null,
  ancestors: string[],
  out: Collected[],
): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (e) {
    throw new AppError("io", `遍历失败：${e instanceof Error ? e.message : String(e)}`);
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const rel = relPrefix === null ? full : path.join(relPrefix, ent.name);
    if (ent.isSymbolicLink()) {
      const physical = await resolveLinkPhysically(full);
      if (ancestors.includes(physical)) {
        continue; // 链接环：链上已展开过同一物理目标
      }
      ancestors.push(physical);
      const md = await fsp.stat(physical).catch((e) => {
        throw ioErr(e);
      });
      if (md.isDirectory()) {
        await walkPhysical(physical, rel, ancestors, out);
      } else if (md.isFile()) {
        out.push({ abs: physical, rel });
      }
      ancestors.pop();
    } else if (ent.isDirectory()) {
      await walkPhysical(full, rel, ancestors, out);
    } else if (ent.isFile()) {
      out.push({ abs: full, rel });
    }
  }
}

/** 相对路径统一为 `/` 分隔的字符串（越界即内部不变量被破坏）。 */
function relString(relPath: string, root: string): string {
  const normRel = path.normalize(relPath);
  const normRoot = path.normalize(root);
  if (!(normRel === normRoot || normRel.startsWith(normRoot + path.sep))) {
    throw new AppError("internal", `路径越界：${relPath} 不在 ${root} 下`);
  }
  return normRel.slice(normRoot.length).replace(/^[/\\]/, "").split(path.sep).join("/");
}

/** 收集一个路径（文件或目录，含符号链接/junction）下的全部文件。
 *  迁移语义：链接按目标真实内容入包，新机得到自包含副本；全程物理路径访问。
 *  `withHash=false` 用于 Excluded 类别（只统计，不读内容）。规则路径不存在是
 *  合法状态（Missing 类别），返回空。 */
async function collectFiles(abs: string, root: string, withHash: boolean): Promise<ScannedFile[]> {
  const collected: Collected[] = [];
  const st = await fsp.lstat(abs).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw ioErr(e);
  });
  if (st === null) return [];
  if (st.isSymbolicLink()) {
    const physical = await resolveLinkPhysically(abs);
    const md = await fsp.stat(physical).catch((e) => {
      throw ioErr(e);
    });
    if (md.isFile()) {
      collected.push({ abs: physical, rel: abs });
    } else if (md.isDirectory()) {
      const ancestors = [physical];
      await walkPhysical(physical, abs, ancestors, collected);
    }
  } else if (st.isFile()) {
    collected.push({ abs, rel: abs });
  } else if (st.isDirectory()) {
    await walkPhysical(abs, null, [], collected);
  }
  // 排序保证清单稳定（同目录内容不变时两次扫描结果一致）
  collected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const out: ScannedFile[] = [];
  for (const c of collected) {
    const rel = relString(c.rel, root);
    const size = (await fsp.stat(c.abs).catch((e) => {
      throw ioErr(e);
    })).size;
    const kind = kindOf(rel);
    const sha = withHash ? await sha256File(c.abs) : "";
    out.push({ rel_path: rel, size, sha256: sha, kind, source_abs: c.abs });
  }
  return out;
}

/** 扫描单个类别。`withHash=false` 时只收集路径/大小/种类不算哈希（打包路径专用——
 *  哈希由写包时流式计算）；WAL/SHM 阻断检测不依赖哈希，行为不受开关影响。 */
async function scanCategory(
  root: string,
  cat: AssetCategory,
  withHash: boolean,
): Promise<CategoryReport> {
  const targets = expandRule(root, cat.rule);
  const report = (status: CategoryStatus, files: ScannedFile[], total: number): CategoryReport => ({
    category_id: cat.id,
    status,
    files,
    total_bytes: total,
  });

  if (cat.strategy.kind === "Excluded") {
    // 只统计体量与存在性，绝不读内容（快且不碰敏感数据）
    const files: ScannedFile[] = [];
    let total = 0;
    for (const t of targets) {
      if (!fs.existsSync(t)) continue;
      for (const f of await collectFiles(t, root, false)) {
        total += f.size;
        files.push(f);
      }
    }
    return report(files.length === 0 ? { status: "missing" } : { status: "ready" }, files, total);
  }

  if (cat.strategy.kind === "SqliteDb") {
    const files: ScannedFile[] = [];
    let blocked: string | null = null;
    let total = 0;
    for (const t of targets) {
      if (!fs.existsSync(t)) continue;
      // WAL/SHM 检测：存在说明源程序可能未完全退出，库可能不一致
      const base = path.basename(t);
      const sidecars = ["-wal", "-shm"]
        .map((sfx) => base + sfx)
        .filter((name) => fs.existsSync(path.join(path.dirname(t), name)));
      if (sidecars.length > 0) {
        blocked = `检测到 ${sidecars.join(" 与 ")}，源程序可能未完全退出；请退出后重新检测，或跳过该类别`;
      }
      for (const f of await collectFiles(t, root, withHash)) {
        total += f.size;
        files.push(f);
      }
    }
    const status: CategoryStatus = blocked !== null
      ? { status: "blocked", detail: blocked }
      : files.length === 0
        ? { status: "missing" }
        : { status: "ready" };
    return report(status, files, total);
  }

  const files: ScannedFile[] = [];
  let total = 0;
  for (const t of targets) {
    for (const f of await collectFiles(t, root, withHash)) {
      total += f.size;
      files.push(f);
    }
  }
  return report(files.length === 0 ? { status: "missing" } : { status: "ready" }, files, total);
}

async function assertRootIsDir(root: string): Promise<void> {
  try {
    if ((await fsp.stat(root)).isDirectory()) return;
  } catch {
    // fallthrough
  }
  throw new AppError("path_setup", `扫描根目录不存在：${root}`);
}

/** 按档案扫描根目录，产出完整盘点报告（UI 盘点页数据源：全部类别、含哈希）。 */
export async function scan(profile: Profile, root: string): Promise<ScanReport> {
  await assertRootIsDir(root);
  const categories: CategoryReport[] = [];
  for (const cat of profile.categories) {
    categories.push(await scanCategory(root, cat, true));
  }
  return { profile_id: profile.id, profile_version: profile.version, root, categories };
}

/** 按档案扫描根目录的指定类别（打包路径专用）：未选中类别完全不触碰（枚举、
 *  元数据、内容读取都不发生）；哈希一律不算，由写包时流式计算。
 *  类别顺序按 categoryIds，未知 id 报 invalid_package。 */
export async function scanSelected(
  profile: Profile,
  root: string,
  categoryIds: string[],
): Promise<ScanReport> {
  await assertRootIsDir(root);
  const categories: CategoryReport[] = [];
  for (const id of categoryIds) {
    const cat = profile.categories.find((c) => c.id === id);
    if (!cat) throw new AppError("invalid_package", `未知类别：${id}`);
    categories.push(await scanCategory(root, cat, false));
  }
  return { profile_id: profile.id, profile_version: profile.version, root, categories };
}
