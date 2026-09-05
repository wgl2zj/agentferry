// @vitest-environment node
// 路径适配（pathfix）测试：Rust pathfix.rs 内联测试的逐条翻译，测试名保持一致。

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { executeApplyTo, makePlan } from "./applier";
import { pack, readManifest, type Manifest } from "./packer";
import { categoryIdsForPreset } from "./profile/types";
import { zcodeProfile } from "./profile/zcode";
import { applyMappings, defaultSeeds, detect } from "./pathfix";

const APP_VERSION = "0.1.6";

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "af-fix-"));
  tempDirs.push(dir);
  return dir;
}

/** 造一个含旧机路径的包并解包到目标根。 */
async function setupTargetWithPaths(): Promise<{ pkg: string; target: string; manifest: Manifest }> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "规则");
  fs.mkdirSync(path.join(root, "cli"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "cli/config.json"),
    String.raw`{"mcp":[{"cmd":"C:\\Users\\olduser\\AppData\\Local\\Programs\\Python\\py.exe"}],"log":"C:/Users/olduser/log"}`,
  );
  const ids = categoryIdsForPreset(zcodeProfile(), { kind: "Recommended" });
  const pkg = path.join(root, "pf/pkg.zam");
  await pack(zcodeProfile(), root, ids, "recommended", pkg, [], APP_VERSION, () => {});
  const manifest = await readManifest(pkg);
  // 测试脱离打包机环境：把来源用户名改写为内容中实际出现的旧机用户名
  manifest.source.username = "olduser";

  // 直接解包到目标根（复用 applier）
  const target = path.join(path.dirname(pkg), "target");
  const plan = await makePlan(pkg, manifest, target, "overwrite", []);
  await executeApplyTo(plan, target, () => {});
  return { pkg, target, manifest };
}

it("pathfix_detects_old_machine_paths：检出，四种书写形式的旧路径全部命中", async () => {
  const { target, manifest } = await setupTargetWithPaths();
  const result = await detect(target, manifest);
  expect(result.seeds.length).toBeGreaterThan(0);
  const total = result.seeds.reduce((s, x) => s + x.total_hits, 0);
  expect(total).toBeGreaterThanOrEqual(2);
  const cfg = result.files.find((f) => f.target_rel === "cli/config.json")!;
  expect(cfg.skipped_reason).toBeNull();
  expect(cfg.total_hits).toBeGreaterThanOrEqual(2);
});

it("pathfix_replaces_and_preserves_utf8_no_bom：替换，内容正确、无 BOM 引入（字节级）、有备份", async () => {
  const { target, manifest } = await setupTargetWithPaths();
  const det = await detect(target, manifest);
  const mappings: [string, string][] = det.seeds.map((s) => [s.old, s.new]);
  const report = await applyMappings(target, manifest, mappings, true);

  expect(report.replaced).toHaveLength(1);
  const cfgPath = path.join(target, "cli/config.json");
  const bytes = await fsp.readFile(cfgPath);
  expect(bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf, "替换不得引入 BOM").toBe(true);
  const text = bytes.toString("utf8");
  expect(text.includes("olduser"), `旧用户名应被替换：${text}`).toBe(false);
  // 备份存在且为旧内容
  expect(report.backup_dir).toBeTruthy();
  const backupCfg = walkFind(report.backup_dir!, "config.json");
  const old = await fsp.readFile(backupCfg, "utf8");
  expect(old).toContain("olduser");
});

it("pathfix_skips_bom_files：含 BOM 的文件被跳过并警告，内容不动", async () => {
  const target = await tempDir();
  fs.mkdirSync(path.join(target, "cli"), { recursive: true });
  const withBom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(String.raw`{"cmd":"C:\Users\olduser\x"}`, "utf8"),
  ]);
  fs.writeFileSync(path.join(target, "cli/config.json"), withBom);

  const manifest: Manifest = {
    format_version: 1,
    app_version: "t",
    created_at: "",
    source: { os: "windows", arch: "x86_64", hostname: "", username: "olduser" },
    profile_id: "zcode",
    profile_version: 1,
    preset: { kind: "recommended", categories: [] },
    files: [
      {
        path: "payload/cli/config.json",
        target_rel: "cli/config.json",
        category: "main_config",
        sha256: "",
        size: 0,
        kind: "text",
        needs_path_adapt: true,
      },
    ],
    counts: { files: 1, categories: 1 },
    total_bytes: 0,
    warnings: [],
  };
  const det = await detect(target, manifest);
  expect(det.files[0].skipped_reason).toContain("BOM");

  const report = await applyMappings(
    target,
    manifest,
    [["C:\\Users\\olduser\\", "C:\\Users\\newuser\\"]],
    false,
  );
  expect(report.skipped).toHaveLength(1);
  expect(report.replaced).toHaveLength(0);
  // 文件原样
  const now = await fsp.readFile(path.join(target, "cli/config.json"));
  expect(now.equals(withBom)).toBe(true);
});

describe("pathfix_no_seeds_when_same_username", () => {
  it("新旧用户名相同时无种子（无需替换）", () => {
    const current = process.env.USERNAME ?? "";
    if (current === "") {
      return; // 环境无用户名时跳过该断言
    }
    const seeds = defaultSeeds(current);
    expect(seeds, "同用户名不应产生替换种子").toEqual([]);
  });
});

function walkFind(root: string, name: string): string {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name === name) return full;
    }
  }
  throw new Error(`备份中找不到 ${name}`);
}
