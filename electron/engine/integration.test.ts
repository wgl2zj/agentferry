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

it("integration_merge_journey：换机时对冲突配置与记忆勾选合并，两边内容都在且 pathfix 照常生效", async () => {
  // ---- 旧机：构造资产并打包（config 与记忆文件内容与包一致）----
  const oldRoot = await tempDir();
  fs.writeFileSync(path.join(oldRoot, "AGENTS.md"), "# 全局规则\n- [规则条目](r.md) — 旧机规则");
  fs.mkdirSync(path.join(oldRoot, "cli"), { recursive: true });
  fs.writeFileSync(
    path.join(oldRoot, "cli/config.json"),
    String.raw`{"mcpCmd":"C:\\Users\\olduser\\py.exe","old":"旧机独有字段"}`,
  );
  fs.mkdirSync(path.join(oldRoot, "cli/memories/projects/p1"), { recursive: true });
  fs.writeFileSync(
    path.join(oldRoot, "cli/memories/projects/p1/MEMORY.md"),
    "# MEMORY.md\n- [旧机记忆](old.md) — 旧机独有的记忆条目",
  );

  const profile = zcodeProfile();
  const ids = categoryIdsForPreset(profile, { kind: "Recommended" });
  const pkg = path.join(oldRoot, "ferry/合并包.zam");
  await pack(profile, oldRoot, ids, "recommended", pkg, [], APP_VERSION, () => {});

  // ---- 新机：同名文件都存在但内容不同（新机自己攒的）----
  const newMachine = await tempDir();
  const pkg2 = path.join(newMachine, "合并包.zam");
  fs.copyFileSync(pkg, pkg2);
  const restored = path.join(newMachine, ".zcode");
  fs.mkdirSync(path.join(restored, "cli/memories/projects/p1"), { recursive: true });
  fs.writeFileSync(path.join(restored, "AGENTS.md"), "# 全局规则\n- [新机规则](n.md) — 新机自己的规则");
  fs.writeFileSync(
    path.join(restored, "cli/config.json"),
    String.raw`{"mcpCmd":"D:\\new\\py.exe","local":"新机独有字段"}`,
  );
  fs.writeFileSync(
    path.join(restored, "cli/memories/projects/p1/MEMORY.md"),
    "# MEMORY.md\n- [新机记忆](new.md) — 新机自己攒的记忆条目",
  );

  // ---- 增量计划：三个冲突文件全部勾选内容合并 ----
  const mergeRelPaths = ["AGENTS.md", "cli/config.json", "cli/memories/projects/p1/MEMORY.md"];
  const plan = await makePlan(pkg2, await openPackage(pkg2, () => {}), restored, "incremental", [], mergeRelPaths);
  for (const rel of mergeRelPaths) {
    expect(plan.items.find((i) => i.target_rel === rel)!.action).toBe("merge");
  }

  // ---- 执行：两边内容都在 ----
  const report = await executeApplyTo(plan, restored, () => {});
  const md = await fsp.readFile(path.join(restored, "cli/memories/projects/p1/MEMORY.md"), "utf8");
  expect(md).toContain("新机自己攒的记忆条目");
  expect(md).toContain("旧机独有的记忆条目");
  const rules = await fsp.readFile(path.join(restored, "AGENTS.md"), "utf8");
  expect(rules).toContain("新机自己的规则");
  expect(rules).toContain("旧机规则");
  // config：包独有字段加入、新机独有字段保留、同字段取旧机包值
  const cfg = JSON.parse(await fsp.readFile(path.join(restored, "cli/config.json"), "utf8")) as Record<string, unknown>;
  expect(cfg.old).toBe("旧机独有字段");
  expect(cfg.local).toBe("新机独有字段");
  expect(cfg.mcpCmd).toBe("C:\\Users\\olduser\\py.exe"); // 同字段取旧机包值（JSON 解析后单反斜杠）
  // 备份存在（新机原内容可找回）
  expect(fs.statSync(path.join(report.backup_dir!, "cli/config.json")).isFile()).toBe(true);

  // ---- pathfix 协同：合并结果中的旧机路径仍被检出并替换 ----
  const manifest2 = structuredClone(await openPackage(pkg2, () => {}));
  manifest2.source.username = "olduser";
  const det = await detect(restored, manifest2);
  expect(det.seeds.reduce((s, x) => s + x.total_hits, 0)).toBeGreaterThanOrEqual(1);
  const mappings: [string, string][] = det.seeds.map((s) => [s.old, s.new]);
  const fixReport = await applyMappings(restored, manifest2, mappings, true);
  const cfgText = await fsp.readFile(path.join(restored, "cli/config.json"), "utf8");
  expect(cfgText.includes("olduser"), `旧用户名应全部替换：${cfgText}`).toBe(false);
  expect(cfgText).toContain("旧机独有字段"); // 替换不破坏合并结果
  expect(fixReport.replaced.length).toBeGreaterThan(0);
});
