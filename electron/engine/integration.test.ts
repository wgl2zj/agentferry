// @vitest-environment node
// 全链路集成测试：假资产树 → 打包 → 模拟换机（目标已有部分文件）→
// 增量/覆盖解包 → 路径适配 → 断言每一步的安全铁律。全程临时目录，不触碰真实家目录。
// Rust tests/integration.rs 的逐条翻译，测试名保持一致。

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { executeApplyTo, makePlan, openPackage } from "./applier";
import { pack } from "./packer";
import { applyMappings, detect } from "./pathfix";
import { categoryIdsForPreset } from "./profile/types";
import { zcodeProfile } from "./profile/zcode";

const APP_VERSION = "0.1.6";

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "af-int-"));
  tempDirs.push(dir);
  return dir;
}

it("integration_pack_move_incremental_pathfix_journey：打包→换机→增量解包→路径适配 的完整旅程", async () => {
  // ---- 旧机：构造资产并打包（跳过带 WAL 的会话库，模拟用户选择）----
  const oldRoot = await tempDir();
  fs.writeFileSync(path.join(oldRoot, "AGENTS.md"), "# 全局规则\n");
  fs.mkdirSync(path.join(oldRoot, "skills/demo"), { recursive: true });
  fs.writeFileSync(path.join(oldRoot, "skills/demo/SKILL.md"), "技能");
  fs.mkdirSync(path.join(oldRoot, "cli"), { recursive: true });
  fs.writeFileSync(
    path.join(oldRoot, "cli/config.json"),
    String.raw`{"mcpCmd":"C:\\Users\\olduser\\AppData\\Python\\py.exe","home":"/Users/olduser/work"}`,
  );
  fs.mkdirSync(path.join(oldRoot, "cli/db"), { recursive: true });
  fs.writeFileSync(path.join(oldRoot, "cli/db/db.sqlite"), "会话库");
  fs.writeFileSync(path.join(oldRoot, "cli/db/db.sqlite-wal"), "wal");

  const profile = zcodeProfile();
  const fullIds = categoryIdsForPreset(profile, { kind: "Full" });
  const selected = fullIds.filter((id) => id !== "session_db");
  const pkg = path.join(oldRoot, "ferry/换机包.zam");
  const warnings = ["会话历史库检测到 WAL，用户选择跳过"];
  const packResult = await pack(profile, oldRoot, selected, "full", pkg, warnings, APP_VERSION, () => {});
  expect(packResult.manifest.warnings).toHaveLength(1);

  // ---- 新机：目标已有部分旧文件（含一个内容不同的冲突文件）----
  const newMachine = await tempDir();
  const pkg2 = path.join(newMachine, "换机包.zam");
  fs.copyFileSync(pkg, pkg2);
  const restored = path.join(newMachine, ".zcode");
  fs.mkdirSync(path.join(restored, "cli"), { recursive: true });
  fs.writeFileSync(path.join(restored, "AGENTS.md"), "# 新机自己攒的规则"); // 冲突
  fs.writeFileSync(path.join(restored, "cli/config.json"), String.raw`{"mcpCmd":"D:\\new\\py.exe"}`); // 冲突
  fs.writeFileSync(path.join(restored, "cli/新机独有.md"), "保留");

  // ---- 打开校验 → 增量计划 → 执行 ----
  const manifest = await openPackage(pkg2, () => {});
  const overrides = ["cli/config.json"]; // 用户改判：config 用包里的
  const plan = await makePlan(pkg2, manifest, restored, "incremental", overrides);
  // 冲突分组正确
  const get = (rel: string) => {
    const item = plan.items.find((i) => i.target_rel === rel);
    expect(item, `计划缺 ${rel}`).toBeDefined();
    return item!;
  };
  expect(get("AGENTS.md").action).toBe("keep"); // 未改判 → 保留新机
  expect(get("cli/config.json").action).toBe("replace"); // 改判 → 替换
  expect(get("skills/demo/SKILL.md").action).toBe("create");

  // 执行（confirmed_overrides 已由 make_plan 存入计划）
  const report = await executeApplyTo(plan, restored, () => {});
  // 新机独有文件仍在；未改判冲突保留新机内容
  expect(await fsp.readFile(path.join(restored, "AGENTS.md"), "utf8")).toBe("# 新机自己攒的规则");
  expect(fs.statSync(path.join(restored, "cli/新机独有.md")).isFile()).toBe(true);
  // 改判冲突已被包内容替换，且原内容已备份
  expect(await fsp.readFile(path.join(restored, "cli/config.json"), "utf8")).toContain("olduser");
  expect(report.backup_dir).toBeTruthy();
  expect(fs.statSync(path.join(report.backup_dir!, "cli/config.json")).isFile()).toBe(true);
  // 已核对文件数 = 非保留项（Keep 是明确保留目标，无写入与复验动作）
  const nonKeep = plan.items.filter((i) => i.action !== "keep").length;
  expect(report.verified_files).toBe(nonKeep);

  // ---- 路径适配：检出旧机路径并替换 ----
  const manifest2 = structuredClone(manifest);
  manifest2.source.username = "olduser";
  const det = await detect(restored, manifest2);
  expect(det.seeds.reduce((s, x) => s + x.total_hits, 0)).toBeGreaterThanOrEqual(2);
  const mappings: [string, string][] = det.seeds.map((s) => [s.old, s.new]);
  const fixReport = await applyMappings(restored, manifest2, mappings, true);
  expect(fixReport.replaced).toHaveLength(1);
  const now = await fsp.readFile(path.join(restored, "cli/config.json"));
  expect(now[0] !== 0xef || now[1] !== 0xbb || now[2] !== 0xbf, "不得引入 BOM").toBe(true);
  const text = now.toString("utf8");
  expect(text.includes("olduser"), `旧用户名应全部替换：${text}`).toBe(false);
});

it("integration_pack_move_overwrite_journey：覆盖模式旅程，全部冲突备份后替换，目标独有文件依旧保留", async () => {
  const oldRoot = await tempDir();
  fs.writeFileSync(path.join(oldRoot, "AGENTS.md"), "规则A");
  const profile = zcodeProfile();
  const ids = categoryIdsForPreset(profile, { kind: "Recommended" });
  const pkg = path.join(oldRoot, "包.zam");
  await pack(profile, oldRoot, ids, "recommended", pkg, [], APP_VERSION, () => {});

  const newMachine = await tempDir();
  const pkg2 = path.join(newMachine, "包.zam");
  fs.copyFileSync(pkg, pkg2);
  const restored = path.join(newMachine, ".zcode");
  fs.mkdirSync(restored, { recursive: true });
  fs.writeFileSync(path.join(restored, "AGENTS.md"), "新机旧规则");
  fs.writeFileSync(path.join(restored, "独有.txt"), "独有内容");

  const manifest = await openPackage(pkg2, () => {});
  const plan = await makePlan(pkg2, manifest, restored, "overwrite", []);
  const report = await executeApplyTo(plan, restored, () => {});

  expect(await fsp.readFile(path.join(restored, "AGENTS.md"), "utf8")).toBe("规则A");
  expect(fs.statSync(path.join(restored, "独有.txt")).isFile(), "覆盖模式同样不得删除目标独有文件").toBe(true);
  const backupDir = report.backup_dir!;
  expect(await fsp.readFile(path.join(backupDir, "AGENTS.md"), "utf8")).toBe("新机旧规则");
});
