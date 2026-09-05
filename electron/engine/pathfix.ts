// 路径适配引擎：检出文本资产中的旧机绝对路径，按用户确认的映射执行替换。
// 编码铁律：只处理 UTF-8 无 BOM 文本；含 BOM 或非 UTF-8 的文件跳过并警告，绝不强行改写；
// 替换后的写回不引入 BOM（字节级保持 UTF-8 无 BOM）。

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BACKUP_DIR, localStamp, safeJoin } from "./applier";
import type { Manifest } from "./packer";

/** UTF-8 BOM 字节头。 */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
/** fatal 模式解码：非 UTF-8 字节序列抛 TypeError（对应 String::from_utf8 校验）。 */
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

/** 建议映射（旧串 → 新串）与全包命中统计。 */
export interface PathSeed {
  old: string;
  new: string;
  total_hits: number;
}

/** 单文件检出结果。 */
export interface DetectFile {
  target_rel: string;
  total_hits: number;
  /** 非 null 表示被跳过（含 BOM / 非 UTF-8），值为原因。 */
  skipped_reason: string | null;
}

/** 检出结果：建议映射 + 逐文件命中。 */
export interface DetectResult {
  seeds: PathSeed[];
  files: DetectFile[];
}

/** 替换执行结果。 */
export interface PathFixReport {
  /** 已替换的文件与替换次数。 */
  replaced: ReplacedFile[];
  /** 被跳过的文件与原因。 */
  skipped: SkippedFile[];
  /** 备份目录（备份开启且有替换时）。 */
  backup_dir: string | null;
}

export interface ReplacedFile {
  target_rel: string;
  replacements: number;
}

export interface SkippedFile {
  target_rel: string;
  reason: string;
}

/** 生成默认映射种子：旧机用户名 → 当前机用户名，覆盖五种书写形式
 *  （Windows 反斜杠、正斜杠、JSON 转义的双反斜杠、macOS /Users、Linux /home）。
 *  同名（新旧机用户名一致）时无需替换。 */
export function defaultSeeds(oldUsername: string): [string, string][] {
  const newUsername = process.env.USERNAME || process.env.USER || "unknown";
  const forms: [string, string][] = [
    [`C:\\Users\\${oldUsername}\\`, `C:\\Users\\${newUsername}\\`],
    [`C:/Users/${oldUsername}/`, `C:/Users/${newUsername}/`],
    [`C:\\\\Users\\\\${oldUsername}\\\\`, `C:\\\\Users\\\\${newUsername}\\\\`],
    [`/Users/${oldUsername}/`, `/Users/${newUsername}/`],
    [`/home/${oldUsername}/`, `/home/${newUsername}/`],
  ];
  return forms.filter(([o, n]) => o !== n);
}

/** 读取文本文件为字符串；BOM/非 UTF-8 返回原因。 */
function readText(p: string): { ok: true; text: string } | { ok: false; reason: string } {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(p);
  } catch (e) {
    return { ok: false, reason: `读取失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (bytes.subarray(0, 3).equals(BOM)) {
    return { ok: false, reason: "文件含 UTF-8 BOM，跳过改写以保安全" };
  }
  try {
    return { ok: true, text: utf8Strict.decode(bytes) };
  } catch {
    return { ok: false, reason: "文件不是有效 UTF-8，跳过改写" };
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 非重叠命中计数（等价 Rust str::matches().count()）。 */
function countOccurrences(text: string, needle: string): number {
  return needle === "" ? 0 : text.split(needle).length - 1;
}

/** 检出：在目标根下扫描清单中 needs_path_adapt 且 kind=text 的文件，
 *  统计各映射种子的命中次数（纯只读）。 */
export async function detect(targetRoot: string, manifest: Manifest): Promise<DetectResult> {
  const seedsSrc = defaultSeeds(manifest.source.username);
  const seeds: PathSeed[] = seedsSrc.map(([o, n]) => ({ old: o, new: n, total_hits: 0 }));
  const files: DetectFile[] = [];

  for (const mf of manifest.files) {
    if (!mf.needs_path_adapt || mf.kind !== "text") {
      continue;
    }
    const abs = safeJoin(targetRoot, mf.target_rel);
    if (!isFile(abs)) {
      files.push({ target_rel: mf.target_rel, total_hits: 0, skipped_reason: "文件尚未解包到目标" });
      continue;
    }
    let total = 0;
    let skipped: string | null = null;
    const r = readText(abs);
    if (r.ok) {
      seedsSrc.forEach(([o], i) => {
        const hits = countOccurrences(r.text, o);
        seeds[i].total_hits += hits;
        total += hits;
      });
    } else {
      skipped = r.reason;
    }
    files.push({ target_rel: mf.target_rel, total_hits: total, skipped_reason: skipped });
  }
  return { seeds, files };
}

/** 执行替换：对目标根下 needs_path_adapt 文本文件应用 `mappings`（用户已确认的旧→新列表）。
 *  `backup=true` 时替换前把原文件备份到 `<target_root>/zam-backups/<时间戳>/pathfix/<rel>`。
 *  无匹配内容的文件不写回（保持 mtime 不动）。 */
export async function applyMappings(
  targetRoot: string,
  manifest: Manifest,
  mappings: [string, string][],
  backup: boolean,
): Promise<PathFixReport> {
  const replaced: ReplacedFile[] = [];
  const skipped: SkippedFile[] = [];
  let anyReplaced = false;
  const stamp = localStamp();

  for (const mf of manifest.files) {
    if (!mf.needs_path_adapt || mf.kind !== "text") {
      continue;
    }
    const abs = safeJoin(targetRoot, mf.target_rel);
    if (!isFile(abs)) {
      skipped.push({ target_rel: mf.target_rel, reason: "文件尚未解包到目标" });
      continue;
    }
    const r = readText(abs);
    if (!r.ok) {
      skipped.push({ target_rel: mf.target_rel, reason: r.reason });
      continue;
    }
    let count = 0;
    let next = r.text;
    for (const [old, new_] of mappings) {
      if (old === new_ || old === "") continue;
      const hits = countOccurrences(next, old);
      if (hits > 0) {
        next = next.split(old).join(new_);
        count += hits;
      }
    }
    if (count === 0) continue; // 无变化不写回
    // 备份原文件
    if (backup) {
      const backupPath = path.join(targetRoot, BACKUP_DIR, stamp, "pathfix", mf.target_rel);
      await fsp.mkdir(path.dirname(backupPath), { recursive: true });
      await fsp.copyFile(abs, backupPath);
      anyReplaced = true;
    }
    // 写回：UTF-8 无 BOM（Buffer.from(text,"utf8") 不产生 BOM）
    await fsp.writeFile(abs, Buffer.from(next, "utf8"));
    replaced.push({ target_rel: mf.target_rel, replacements: count });
  }

  const backupDir = backup && anyReplaced ? path.join(targetRoot, BACKUP_DIR, stamp) : null;
  return { replaced, skipped, backup_dir: backupDir };
}
