// .zam（ZIP）读写封装：yauzl 读（单次打开 + 流式条目读取）与统一错误映射。
// 性能契约：一次 open 建立条目索引后复用——每文件重开归档会各自解析中央目录，
// 文件数 N 时总代价 O(N²)（真实性能事故 2026-08-18）。

import fs from "node:fs";
import type { Readable } from "node:stream";
import yauzl from "yauzl";
import { AppError } from "./error";

export interface OpenedZip {
  zip: yauzl.ZipFile;
  /** 包内全部条目索引（文件名 → 条目，含目录占位条目）。 */
  entries: Map<string, yauzl.Entry>;
  close(): void;
}

/** 打开 ZIP 并建立条目索引（校验中央目录；损坏时报 invalid_package）。 */
export function openZip(packagePath: string, openFailMessage: string): Promise<OpenedZip> {
  return new Promise<OpenedZip>((resolve, reject) => {
    if (!fs.existsSync(packagePath)) {
      reject(new AppError("invalid_package", `${openFailMessage}：文件不存在（${packagePath}）`));
      return;
    }
    yauzl.open(packagePath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) {
        reject(new AppError("invalid_package", `${openFailMessage}：不是有效的 .zam/ZIP 包${err ? `（${err.message}）` : ""}`));
        return;
      }
      const entries = new Map<string, yauzl.Entry>();
      const fail = (e: Error): void => {
        reject(new AppError("invalid_package", `包损坏：${e.message}`));
      };
      zip.on("error", fail);
      zip.on("entry", (entry: yauzl.Entry) => {
        entries.set(entry.fileName, entry);
        zip.readEntry();
      });
      zip.on("end", () => {
        resolve({ zip, entries, close: () => zip.close() });
      });
      zip.readEntry();
    });
  });
}

/** 打开单个条目的流式读取（yauzl 自动做 CRC32 校验）。 */
export function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(new AppError("invalid_package", `读取条目失败：${entry.fileName}${err ? `（${err.message}）` : ""}`));
        return;
      }
      resolve(stream);
    });
  });
}

/** 读取单个条目的全部字节（仅测试与 manifest 等小条目使用）。 */
export async function entryBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  const stream = await entryStream(zip, entry);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** 按文件名取条目；缺失时报 invalid_package（missingMessage 指明用途）。 */
export function requireEntry(opened: OpenedZip, name: string, missingMessage: string): yauzl.Entry {
  const entry = opened.entries.get(name);
  if (!entry) {
    throw new AppError("invalid_package", `${missingMessage}${name}`);
  }
  return entry;
}
