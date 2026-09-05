// 打包引擎：把选中类别压缩为 `.zam` 迁移包（实质 ZIP + 包根 manifest.json）。
// 打包全程对源目录只读；哈希在写包时对所写内容流式计算——源文件只读一遍，
// 且哈希即所写内容，不存在"清单哈希与包内容不一致"的窗口。

import { createHash, type Hash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import * as yazl from "yazl";
import { AppError } from "./error";
import type { ProgressFn } from "./progress";
import { categoryOf, type Profile } from "./profile/types";
import { scanSelected, type FileKind, type ScanReport } from "./scanner";
import { entryBuffer, openZip, requireEntry } from "./zipio";

/** 当前包格式版本。 */
export const FORMAT_VERSION = 1;

/** 包内负载目录前缀（与包根 manifest.json 隔离）。 */
const PAYLOAD_PREFIX = "payload/";

/** 来源机信息（路径适配的种子来源）。 */
export interface SourceInfo {
  os: string;
  arch: string;
  hostname: string;
  username: string;
}

/** 档位记录。 */
export interface PresetInfo {
  /** recommended / full / custom。 */
  kind: string;
  /** 实际选中的类别 id。 */
  categories: string[];
}

/** 清单中的单文件条目。 */
export interface ManifestFile {
  /** 包内路径（payload/ 前缀）。 */
  path: string;
  /** 解包目标相对路径（相对档案根，`/` 分隔）。 */
  target_rel: string;
  category: string;
  sha256: string;
  size: number;
  kind: FileKind;
  /** 是否需要路径适配（来自类别策略 CopyTextNeedsPathAdapt）。 */
  needs_path_adapt: boolean;
}

/** 迁移包清单（包根 manifest.json）。 */
export interface Manifest {
  format_version: number;
  app_version: string;
  created_at: string;
  source: SourceInfo;
  profile_id: string;
  profile_version: number;
  preset: PresetInfo;
  files: ManifestFile[];
  counts: { files: number; categories: number };
  total_bytes: number;
  /** 打包期已产生的警告（如"跳过会话历史库"）。 */
  warnings: string[];
}

/** 打包结果摘要。 */
export interface PackResult {
  output_path: string;
  package_bytes: number;
  manifest: Manifest;
}

/** 收集来源机信息（os/arch 命名与 Rust std::env::consts 对齐）。 */
function sourceInfo(): SourceInfo {
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : process.platform;
  const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
  return {
    os,
    arch,
    hostname: process.env.COMPUTERNAME || process.env.HOSTNAME || "unknown",
    username: process.env.USERNAME || process.env.USER || "unknown",
  };
}

/** 压缩策略（决策拍板方案 B，2026-08-18）：SQLite 页式二进制压缩率低却吃掉打包
 *  耗时大头，一律 Stored；其余 Deflated。判定只走 FileKind，不加启发式；
 *  manifest 不感知压缩方法，新旧包互兼容。 */
function compressEntry(kind: FileKind): boolean {
  return kind !== "sqlite";
}

/** 边流过边算 SHA-256 的 Transform（flush 后 digest 可用）。 */
function hashTransform(): Transform & { digest: () => string } {
  const hash: Hash = createHash("sha256");
  const t = new Transform({
    highWaterMark: 64 * 1024,
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
    flush(cb) {
      (t as unknown as { hexDigest: string }).hexDigest = hash.digest("hex");
      cb();
    },
  }) as Transform & { digest: () => string; hexDigest?: string };
  t.digest = () => {
    const d = (t as unknown as { hexDigest?: string }).hexDigest;
    if (d === undefined) throw new AppError("internal", "哈希尚未完成（流未结束）");
    return d;
  };
  return t;
}

/** 打包入口：扫描选中类别 → 校验阻断 → 逐文件入包（边写边算哈希）→ 写清单。
 *
 * 性能契约：只扫描选中类别（未选中类别零触碰）；扫描期不算哈希。
 * `warnings` 由调用方传入（如 UI 上"跳过会话历史库"的说明），原样在前；
 * 选中类别的档案级 pack_warning 按选中顺序追加在后（文案沉在档案数据里）。
 * 选中类别存在 Blocked（WAL/SHM）时返回 source_not_quiet；跳过该库 = 不选它。
 * `appVersion` 写入 manifest.app_version（Rust 版取自 CARGO_PKG_VERSION）。 */
export async function pack(
  profile: Profile,
  root: string,
  categoryIds: string[],
  presetKind: string,
  outputPath: string,
  warnings: string[],
  appVersion: string,
  progress: ProgressFn,
): Promise<PackResult> {
  try {
    if (!(await fsp.stat(root)).isDirectory()) {
      throw new AppError("path_setup", `打包根目录不存在：${root}`);
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("path_setup", `打包根目录不存在：${root}`);
  }
  const report = await scanSelected(profile, root, categoryIds);

  // 阻断校验：选中的 SQLite 类别若检测到 WAL/SHM，拒绝打包
  for (const catId of categoryIds) {
    const cr = report.categories.find((c) => c.category_id === catId);
    if (cr && cr.status.status === "blocked") {
      throw new AppError("source_not_quiet", `类别 ${catId}：${cr.status.detail}`);
    }
  }

  // 汇总清单条目（保持类别顺序，类内文件按扫描序）
  // sourcePaths：rel → 源文件物理绝对路径（链接场景 path.join(root, rel) 要穿越
  // junction，提权进程被 Windows 拒绝 os error 448，会被误判为文件消失）
  const files: ManifestFile[] = [];
  const sourcePaths = new Map<string, string>();
  for (const catId of categoryIds) {
    const cat = categoryOf(profile, catId);
    if (!cat) throw new AppError("invalid_package", `未知类别：${catId}`);
    if (cat.strategy.kind === "Excluded") {
      throw new AppError("invalid_package", `类别 ${catId} 为排除项（缓存/凭据），不得入包`);
    }
    const cr = report.categories.find((c) => c.category_id === catId);
    if (!cr) throw new AppError("internal", `盘点缺少类别 ${catId}`);
    const needsAdapt = cat.strategy.kind === "CopyTextNeedsPathAdapt";
    for (const f of cr.files) {
      if (f.source_abs) sourcePaths.set(f.rel_path, f.source_abs);
      files.push({
        path: `${PAYLOAD_PREFIX}${f.rel_path}`,
        target_rel: f.rel_path,
        category: cat.id,
        sha256: f.sha256,
        size: f.size,
        kind: f.kind,
        needs_path_adapt: needsAdapt,
      });
    }
  }
  const totalFiles = files.length;
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  // 选中类别的档案级警告追加在调用方传入警告之后（打包确认页经 list_profiles
  // 拿到的是同一字符串，同源展示）
  const allWarnings = [...warnings];
  for (const catId of categoryIds) {
    const w = categoryOf(profile, catId)?.pack_warning;
    if (w) allWarnings.push(w);
  }

  const manifest: Manifest = {
    format_version: FORMAT_VERSION,
    app_version: appVersion,
    created_at: new Date().toISOString(),
    source: sourceInfo(),
    profile_id: profile.id,
    profile_version: profile.version,
    preset: { kind: presetKind, categories: categoryIds },
    files,
    counts: { files: totalFiles, categories: categoryIds.length },
    total_bytes: totalBytes,
    warnings: allWarnings,
  };

  // 写包（条目写入顺序 = 清单顺序，manifest.json 最后）
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const out = fs.createWriteStream(outputPath);
  const zip = new yazl.ZipFile();
  zip.outputStream.pipe(out);
  const writeFailure = new Promise<never>((_, reject) => {
    out.on("error", (e) => reject(new AppError("io", e.message)));
    zip.outputStream.on("error", (e) => reject(new AppError("io", e.message)));
  });

  try {
    for (let idx = 0; idx < manifest.files.length; idx += 1) {
      const mf = manifest.files[idx];
      // 优先物理源路径（链接内文件）；无映射时回退 path.join（兼容反序列化的报告）
      const abs = sourcePaths.get(mf.target_rel) ?? path.join(root, mf.target_rel);
      const st = await fsp.stat(abs).catch(() => null);
      if (!st || !st.isFile()) {
        throw new AppError("invalid_package", `打包时源文件消失：${mf.target_rel}`);
      }
      const hashing = hashTransform();
      fs.createReadStream(abs, { highWaterMark: 64 * 1024 }).pipe(hashing);
      zip.addReadStream(hashing, mf.path, { compress: compressEntry(mf.kind) });
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          hashing.on("end", resolve);
          hashing.on("error", (e) => reject(new AppError("io", e.message)));
        }),
        writeFailure,
      ]);
      mf.sha256 = hashing.digest();
      progress(idx + 1, totalFiles, mf.target_rel);
    }

    // 清单最后写入包根（JSON 文本，保持 Deflated）
    const manifestStr = JSON.stringify(manifest, null, 2);
    zip.addBuffer(Buffer.from(manifestStr, "utf8"), "manifest.json", { compress: true });
    zip.end();
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        out.on("finish", () => resolve());
        out.on("error", (e) => reject(new AppError("io", e.message)));
      }),
      writeFailure,
    ]);
  } finally {
    out.destroy();
  }

  const packageBytes = (await fsp.stat(outputPath)).size;
  return { output_path: outputPath, package_bytes: packageBytes, manifest };
}

/** 读取 `.zam` 包内的 manifest.json（不做哈希校验，校验见 applier.openPackage）。 */
export async function readManifest(packagePath: string): Promise<Manifest> {
  const opened = await openZip(packagePath, "打开迁移包失败");
  try {
    const entry = requireEntry(opened, "manifest.json", "包内缺少 ");
    const text = (await entryBuffer(opened.zip, entry)).toString("utf8");
    let manifest: Manifest;
    try {
      manifest = JSON.parse(text) as Manifest;
    } catch (e) {
      throw new AppError("invalid_package", `manifest.json 解析失败：${e instanceof Error ? e.message : String(e)}`);
    }
    if (manifest.format_version !== FORMAT_VERSION) {
      throw new AppError("invalid_package", `包格式版本 ${manifest.format_version} 不受支持（当前支持 ${FORMAT_VERSION}）`);
    }
    return manifest;
  } finally {
    opened.close();
  }
}

/** 从盘点报告提取选中类别的文件总数（供 UI 预估）。 */
export function estimateFiles(report: ScanReport, categoryIds: string[]): number {
  return report.categories
    .filter((c) => categoryIds.includes(c.category_id))
    .reduce((sum, c) => sum + c.files.length, 0);
}

/** 把路径转为跨平台稳定字符串（工具函数，applier/pathfix 共用）。 */
export function toRelString(p: string): string {
  return p.replace(/\\/g, "/");
}
