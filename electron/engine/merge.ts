// 内容级合并引擎（v1，确定性纯函数）：Markdown 行级并集 + JSON 递归深合并。
// 合并结果必须确定——同一对输入永远得到同一输出（执行侧按预览哈希复验依赖此性质）。
// 无损原则：两边独有内容全部保留；唯一取边的情形（JSON 同字段值不同 → 旧机包为准，
// 2026-09-05 用户拍板）逐条记录进预览，被取边的值保留在解包备份中。

/** 合并策略（按扩展名判定）。 */
export type MergeStrategy = "markdown" | "json";

/** Markdown 行级并集预览。 */
export interface MarkdownMergePreview {
  strategy: "markdown";
  target_lines: number;
  package_lines: number;
  merged_lines: number;
  /** 包里独有的、被追加进结果的行数。 */
  appended: number;
}

/** JSON 标量冲突：同字段两边值不同，按决策取旧机包值（新机值保留在备份）。 */
export interface JsonScalarConflict {
  /** 字段路径（点分，如 mcpServers.foo.url；顶层非对象时为 "(root)"）。 */
  path: string;
  /** 新机现值（JSON 序列化形态）。 */
  target: string;
  /** 旧机包值（JSON 序列化形态）。 */
  package: string;
}

/** JSON 递归深合并预览。 */
export interface JsonMergePreview {
  strategy: "json";
  /** 包里独有、被加入的字段路径。 */
  added_keys: string[];
  /** 取旧机包值的同字段冲突明细。 */
  scalar_conflicts: JsonScalarConflict[];
}

export type MergePreview = MarkdownMergePreview | JsonMergePreview;

export interface MergeResult {
  /** 合并后的完整文本（统一 LF 换行、UTF-8 无 BOM 语义）。 */
  text: string;
  preview: MergePreview;
}

/** 按相对路径的扩展名判定合并策略；不支持的类型返回 null（UI 不出现合并选项）。 */
export function mergeStrategyFor(relPath: string): MergeStrategy | null {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  return null;
}

/** 严格 UTF-8 无 BOM 文本判定（与 pathfix 同语义；BOM/非 UTF-8 不支持合并）。 */
export function readStrictUtf8(bytes: Buffer): { ok: true; text: string } | { ok: false; reason: string } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { ok: false, reason: "文件含 UTF-8 BOM，不支持内容合并" };
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "文件不是有效 UTF-8，不支持内容合并" };
  }
}

/** 拆行为行数组（统一 CRLF/CR 为 LF）。 */
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

/** Markdown 行级并集：以目标（新机）为基底保序，包（旧机）独有行按原顺序追加到
 *  末尾（追加块前空一行提升可读性）；两边都有的行只留一份。行比较用原文精确匹配
 *  （不做 trim 宽容——无损优先）。 */
export function mergeMarkdown(targetText: string, packageText: string): MergeResult {
  const targetLines = splitLines(targetText);
  const packageLines = splitLines(packageText);
  const seen = new Set(targetLines);
  const appended: string[] = [];
  for (const line of packageLines) {
    if (seen.has(line)) continue;
    seen.add(line);
    appended.push(line);
  }
  const mergedLines = [...targetLines];
  if (appended.length > 0 && mergedLines.length > 0 && mergedLines[mergedLines.length - 1].trim() !== "") {
    mergedLines.push(""); // 追加块与目标末尾分隔空行
  }
  mergedLines.push(...appended);
  return {
    text: mergedLines.join("\n"),
    preview: {
      strategy: "markdown",
      target_lines: targetLines.length,
      package_lines: packageLines.length,
      merged_lines: mergedLines.length,
      appended: appended.length,
    },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 递归深合并：目标为基底键序；包独有 key 加入；同 key 且双方均为 object → 递归；
 *  同 key 值相同 → 保留；否则（标量/数组/类型不齐）→ 旧机包为准并记录冲突。 */
function deepMerge(
  target: unknown,
  pkg: unknown,
  prefix: string,
  added: string[],
  conflicts: JsonScalarConflict[],
): unknown {
  if (!isPlainObject(target) || !isPlainObject(pkg)) {
    if (JSON.stringify(target) !== JSON.stringify(pkg)) {
      conflicts.push({
        path: prefix || "(root)",
        target: JSON.stringify(target) ?? "undefined",
        package: JSON.stringify(pkg) ?? "undefined",
      });
    }
    return pkg;
  }
  const out: Record<string, unknown> = { ...target };
  for (const [key, pkgVal] of Object.entries(pkg)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!(key in target)) {
      out[key] = pkgVal;
      added.push(path);
      continue;
    }
    const tVal = target[key];
    if (JSON.stringify(tVal) === JSON.stringify(pkgVal)) continue;
    if (isPlainObject(tVal) && isPlainObject(pkgVal)) {
      out[key] = deepMerge(tVal, pkgVal, path, added, conflicts);
      continue;
    }
    out[key] = pkgVal; // 旧机包为准（用户决策 2026-09-05）
    conflicts.push({
      path,
      target: JSON.stringify(tVal) ?? "undefined",
      package: JSON.stringify(pkgVal) ?? "undefined",
    });
  }
  return out;
}

/** JSON 递归深合并。任一侧不是有效 JSON 时抛错（调用方降级为普通冲突动作）。 */
export function mergeJson(targetText: string, packageText: string): MergeResult {
  const target = JSON.parse(targetText) as unknown;
  const pkg = JSON.parse(packageText) as unknown;
  const added: string[] = [];
  const conflicts: JsonScalarConflict[] = [];
  const merged = deepMerge(target, pkg, "", added, conflicts);
  return {
    text: `${JSON.stringify(merged, null, 2)}\n`,
    preview: { strategy: "json", added_keys: added, scalar_conflicts: conflicts },
  };
}

/** 按策略执行合并（mergeStrategyFor 已判定过的便捷入口；解析失败向上抛）。 */
export function mergeText(strategy: MergeStrategy, targetText: string, packageText: string): MergeResult {
  return strategy === "json" ? mergeJson(targetText, packageText) : mergeMarkdown(targetText, packageText);
}
