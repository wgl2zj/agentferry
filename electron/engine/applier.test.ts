// @vitest-environment node
// 解包（applier）测试：Rust applier.rs 内联测试的逐条翻译，测试名保持一致。

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as yazl from "yazl";
import { executeApply, makePlan, openPackage, planApply, safeJoin, type ActionKind, type ApplyMode, type PlanItem } from "./applier";
import { pack, readManifest } from "./packer";
import { categoryIdsForPreset } from "./profile/types";
import { zcodeProfile } from "./profile/zcode";
import { AppError } from "./error";
import type { JsonMergePreview } from "./merge";
import { entryBuffer, openZip } from "./zipio";

const APP_VERSION = "0.1.6";

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "af-apply-"));
  tempDirs.push(dir);
  return dir;
}

/** 前端契约锁定：跨 IPC 枚举为小写字面量。前端镜像（src/lib/ipc.ts）已改为从本模块
 *  re-export（单一来源，无手写漂移面），故本测试直接锁定引擎枚举集合本身；
 *  新增动作（如 merge）必须在此显式登记，防止枚举面无守护扩张。 */
describe("applier_enum_serialization_matches_frontend_contract", () => {
  it("ApplyMode/ActionKind 序列化字面量与前端镜像（re-export 自引擎）一致", () => {
    const modes: ApplyMode[] = ["overwrite", "incremental"];
    const actions: ActionKind[] = ["create", "skip_same", "replace", "keep", "merge"];
    expect(modes).toEqual(["overwrite", "incremental"]);
    expect(actions).toEqual(["create", "skip_same", "replace", "keep", "merge"]);
    expect(JSON.parse(JSON.stringify({ action: "merge" satisfies PlanItem["action"] }))).toEqual({ action: "merge" });
  });
});

/** 造包：返回 (临时目录, 包路径)。树内含规则、技能、config、无 WAL 的库。 */
async function makePackage(): Promise<[string, string]> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "规则 v1");
  fs.mkdirSync(path.join(root, "skills/a"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills/a/SKILL.md"), "技能A");
  fs.mkdirSync(path.join(root, "cli"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/config.json"), String.raw`{"py":"C:\\Users\\old\\py.exe"}`);
  fs.mkdirSync(path.join(root, "cli/db"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/db/db.sqlite"), "库数据");
  const ids = categoryIdsForPreset(zcodeProfile(), { kind: "Full" });
  const out = path.join(root, "pkg/资产包.zam");
  await pack(zcodeProfile(), root, ids, "full", out, [], APP_VERSION, () => {});
  return [root, out];
}

/** 用 zip 重写包内容（默认全部 Deflated；可对指定条目做内容篡改）。 */
async function rewriteZip(pkg: string, mutate?: (name: string, data: Buffer) => Buffer): Promise<void> {
  const opened = await openZip(pkg, "包损坏");
  const entries: [string, Buffer][] = [];
  for (const [name, entry] of opened.entries) {
    entries.push([name, await entryBuffer(opened.zip, entry)]);
  }
  opened.close();
  const out = fs.createWriteStream(pkg);
  const zip = new yazl.ZipFile();
  zip.outputStream.pipe(out);
  for (const [name, data] of entries) {
    zip.addBuffer(mutate ? mutate(name, data) : data, name, { compress: true });
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    out.on("finish", () => resolve());
    out.on("error", (e) => reject(e));
  });
}

it("applier_open_detects_tampered_entry：包篡改场景，改掉包内一个文件后 openPackage 必须报哈希差异", async () => {
  const [, pkg] = await makePackage();
  await rewriteZip(pkg, (name, data) => (name === "payload/AGENTS.md" ? Buffer.from("篡改内容", "utf8") : data));

  const err = await openPackage(pkg, () => {}).catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  expect(err.code).toBe("hash_mismatch");
  expect(err.message).toContain("AGENTS.md");
});

it("applier_plan_groups_four_actions：dry-run 四组归类，新增/一致/冲突/保留", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  // 目标：AGENTS.md 相同（一致）、cli/config.json 不同（冲突）、无 skills（新增）、多一个本地新文件（不参与计划）
  fs.mkdirSync(path.join(target, "cli"), { recursive: true });
  fs.writeFileSync(path.join(target, "AGENTS.md"), "规则 v1");
  fs.writeFileSync(path.join(target, "cli/config.json"), String.raw`{"py":"D:\\new\\py.exe"}`);
  fs.writeFileSync(path.join(target, "cli/本地新增.md"), "目标独有");

  // 增量模式
  const plan = await planApply(pkg, target, "incremental", [], () => {});
  const get = (rel: string): PlanItem => {
    const item = plan.items.find((i) => i.target_rel === rel);
    expect(item, `计划缺 ${rel}`).toBeDefined();
    return item!;
  };
  expect(get("AGENTS.md").action).toBe("skip_same");
  expect(get("cli/config.json").action).toBe("keep"); // 冲突默认保留
  expect(get("skills/a/SKILL.md").action).toBe("create");
  expect(get("cli/config.json").target_sha256).toBeTruthy();

  // 增量 + 改判
  const plan2 = await planApply(pkg, target, "incremental", ["cli/config.json"], () => {});
  expect(plan2.items.find((i) => i.target_rel === "cli/config.json")!.action).toBe("replace");

  // 覆盖模式：冲突全部 Replace
  const plan3 = await planApply(pkg, target, "overwrite", [], () => {});
  expect(plan3.items.find((i) => i.target_rel === "cli/config.json")!.action).toBe("replace");
});

it("applier_plan_only_writes_nothing：反向测试，dry-run 未确认执行时，目标目录零变化", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  fs.mkdirSync(target, { recursive: true });
  const plan = await planApply(pkg, target, "overwrite", [], () => {});
  expect(fs.readdirSync(target), `dry-run 不得在目标创建任何内容（token=${plan.plan_token}）`).toHaveLength(0);
});

it("applier_execute_overwrite_with_backup：覆盖模式执行，冲突备份后替换、复验通过、目标原有文件不减", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  fs.mkdirSync(path.join(target, "cli"), { recursive: true });
  fs.writeFileSync(path.join(target, "cli/config.json"), "旧配置");
  fs.writeFileSync(path.join(target, "cli/目标独有.txt"), "保留我");

  const plan = await planApply(pkg, target, "overwrite", [], () => {});
  const report = await executeApply(plan, () => {});

  // 备份存在且内容与替换前一致
  expect(report.backup_dir).toBeTruthy();
  const backed = await fsp.readFile(path.join(report.backup_dir!, "cli/config.json"), "utf8");
  expect(backed).toBe("旧配置");
  // 替换后的内容 = 包内内容
  const now = await fsp.readFile(path.join(target, "cli/config.json"), "utf8");
  expect(now).toContain("old");
  // 目标独有文件仍在（不删除）
  expect(fs.statSync(path.join(target, "cli/目标独有.txt")).isFile()).toBe(true);
  expect(report.verified_files).toBe(plan.items.length);
});

it("applier_execute_incremental_keeps_conflict：增量模式执行，冲突默认保留目标原文件", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  fs.mkdirSync(path.join(target, "cli"), { recursive: true });
  fs.writeFileSync(path.join(target, "cli/config.json"), "目标新配置");

  const plan = await planApply(pkg, target, "incremental", [], () => {});
  await executeApply(plan, () => {});
  expect(await fsp.readFile(path.join(target, "cli/config.json"), "utf8")).toBe("目标新配置");
  // 新增文件正常写入
  expect(fs.statSync(path.join(target, "AGENTS.md")).isFile()).toBe(true);
});

it("applier_execute_never_deletes_target_files：反向测试，执行前后目标侧原有文件集合不减（无删除语义）", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  fs.mkdirSync(path.join(target, "cli"), { recursive: true });
  fs.writeFileSync(path.join(target, "cli/独占文件.md"), "独占");
  const before = listFiles(target);
  const plan = await planApply(pkg, target, "overwrite", [], () => {});
  await executeApply(plan, () => {});
  const after = listFiles(target);
  for (const f of before) {
    expect(after.includes(f), `执行后目标文件 ${f} 消失（不得删除）`).toBe(true);
  }
});

it("applier_executes_to_explicit_target_not_package_dir：真实事故回归锁（2026-08-17），必须落显式目标根目录", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "真正的目标");
  const plan = await planApply(pkg, target, "overwrite", [], () => {});
  await executeApply(plan, () => {});

  expect(fs.statSync(path.join(target, "AGENTS.md")).isFile()).toBe(true);
  expect(plan.target_root).toBe(target);
  // 旧约定的包旁 -restored 目录不得出现（事故根位）
  const legacy = pkg.replace(/\.zam$/, "-restored");
  expect(fs.existsSync(legacy), `不得再写包旁 -restored 目录：${legacy}`).toBe(false);
  // 包文件本身保持完好（未被当作目标写入）
  expect(fs.statSync(pkg).isFile()).toBe(true);
});

it("applier_rejects_tampered_target_root：令牌防篡改（目标根目录），生成计划后改写 target_root → 执行拒绝", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标A");
  const plan = await planApply(pkg, target, "overwrite", [], () => {});
  plan.target_root = path.join(path.dirname(pkg), "目标B");
  await expect(executeApply(plan, () => {})).rejects.toMatchObject({ code: "plan_not_confirmed" });
});

it("applier_rejects_tampered_plan_token：令牌防篡改，手工改动计划里的动作后执行被拒绝", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  const plan = await planApply(pkg, target, "incremental", [], () => {});
  // 篡改：把 Keep 改成 Replace（越权改判）
  for (const item of plan.items) {
    if (item.target_rel === "AGENTS.md") {
      item.action = "replace";
    }
  }
  await expect(executeApply(plan, () => {})).rejects.toMatchObject({ code: "plan_not_confirmed" });
});

it("applier_rejects_zip_slip_paths：清单含路径穿越（../）→ 拒绝", async () => {
  const [, pkg] = await makePackage();
  const manifest = await readManifest(pkg);
  manifest.files[0].target_rel = "../escape.txt";
  const target = path.join("Z:/no");
  await expect(makePlan(pkg, manifest, target, "overwrite", [])).rejects.toMatchObject({
    code: "invalid_package",
  });
});

it("applier_safe_join_rejects_backslash_and_unc：反向测试，反斜杠绝对路径 / UNC / 盘符变体全部被拒绝", () => {
  const root = "D:/restored";
  for (const evil of [
    "\\evil\\x.txt", // 反斜杠绝对路径
    "\\\\server\\share\\f", // UNC
    "C:/evil", // 盘符
    "../up", // 上跳
    "/abs", // 正斜杠绝对
    "", // 空
    "a\\b", // 混入反斜杠
  ]) {
    expect(() => safeJoin(root, evil), `应拒绝不安全路径：${evil}`).toThrow();
  }
  // 合法相对路径通过
  expect(safeJoin(root, "cli/config.json")).toBeTruthy();
});

it("applier_reads_legacy_deflated_sqlite_package：旧格式兼容锁，sqlite 条目为 Deflated 的存量包仍可校验与解包", async () => {
  const [, pkg] = await makePackage();
  // 重写为"旧格式"：全部条目 Deflated（内容不动，只改压缩方法）
  await rewriteZip(pkg);

  let calls = 0;
  const manifest = await openPackage(pkg, () => {
    calls += 1;
  });
  expect(calls).toBe(manifest.files.length);
  const target = path.join(path.dirname(pkg), "旧包目标");
  const plan = await planApply(pkg, target, "overwrite", [], () => {});
  await executeApply(plan, () => {});
  expect(fs.statSync(path.join(target, "cli/db/db.sqlite")).isFile()).toBe(true);
});

it("applier_open_package_scales_linearly：校验规模锁，耗时随条目数线性（防 O(N²) 回归）", async () => {
  const [, pkgSmall] = await makeWidePackage(100);
  const [, pkgLarge] = await makeWidePackage(1000);

  const t0 = Date.now();
  await openPackage(pkgSmall, () => {});
  const dSmall = Date.now() - t0;
  const t1 = Date.now();
  await openPackage(pkgLarge, () => {});
  const dLarge = Date.now() - t1;

  const ratioFiles = 1000 / 100;
  const ratioTime = dLarge / Math.max(dSmall, 1);
  expect(ratioTime).toBeLessThanOrEqual(ratioFiles * 3);
}, 120_000);

// ---- 工具函数 ----

async function makeWidePackage(n: number): Promise<[string, string]> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "规则");
  const skills = path.join(root, "skills");
  fs.mkdirSync(skills, { recursive: true });
  for (let i = 0; i < n; i += 1) {
    const sub = path.join(skills, `s${String(i).padStart(4, "0")}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "SKILL.md"), `技能 ${i} `.repeat(10));
  }
  const out = path.join(root, "pkg/wide.zam");
  await pack(zcodeProfile(), root, ["skills"], "custom", out, [], APP_VERSION, () => {});
  return [root, out];
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(full);
    }
  };
  walk(root);
  return out;
}

// ---- 内容级合并（merge 动作，2026-09-05 预期清单 #1/#4/#5）----

/** 构造带 md/json 冲突的目标机：AGENTS.md 与 cli/config.json 两边内容都不同。 */
async function makeMergeScenario(): Promise<{ pkg: string; target: string }> {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  fs.mkdirSync(path.join(target, "cli"), { recursive: true });
  fs.writeFileSync(path.join(target, "AGENTS.md"), "规则 v1-新机版");
  fs.writeFileSync(path.join(target, "cli/config.json"), String.raw`{"py":"D:\\new\\py.exe","local":"新机独有"}`);
  return { pkg, target };
}

it("applier_plan_merge_action_and_token：勾选合并 → 冲突动作变 merge 且预览入计划；overwrite 模式同样生效", async () => {
  const { pkg, target } = await makeMergeScenario();

  const plan = await planApply(pkg, target, "incremental", [], () => {}, ["AGENTS.md", "cli/config.json"]);
  const md = plan.items.find((i) => i.target_rel === "AGENTS.md")!;
  const json = plan.items.find((i) => i.target_rel === "cli/config.json")!;
  expect(md.action).toBe("merge");
  expect(md.merge?.preview.strategy).toBe("markdown");
  expect(json.action).toBe("merge");
  expect(json.merge?.preview.strategy).toBe("json");
  // 包里只有 py 字段 → 相对目标没有新增 key；目标独有 local 由深合并保留
  expect((json.merge!.preview as JsonMergePreview).added_keys).toEqual([]);
  expect(plan.merge_rel_paths).toEqual(["AGENTS.md", "cli/config.json"]);
  // 非冲突文件不受影响
  expect(plan.items.some((i) => i.action === "create")).toBe(true);

  // overwrite 模式：replace 同样被勾选的合并覆盖
  const plan3 = await planApply(pkg, target, "overwrite", [], () => {}, ["AGENTS.md"]);
  expect(plan3.items.find((i) => i.target_rel === "AGENTS.md")!.action).toBe("merge");
  // 未勾选的冲突仍是 replace
  expect(plan3.items.find((i) => i.target_rel === "cli/config.json")!.action).toBe("replace");
});

it("applier_execute_merge_preserves_both_sides：执行合并 → 两边内容都在、备份为原目标内容、复验通过", async () => {
  const { pkg, target } = await makeMergeScenario();
  const plan = await planApply(pkg, target, "incremental", [], () => {}, ["AGENTS.md", "cli/config.json"]);
  const report = await executeApply(plan, () => {});

  // json：旧机字段（JSON 反转义后为单反斜杠路径）与新机独有字段并存（深合并取包值 + 目标独有保留）
  const cfg = JSON.parse(await fsp.readFile(path.join(target, "cli/config.json"), "utf8")) as Record<string, unknown>;
  expect(cfg.py).toBe("C:\\Users\\old\\py.exe");
  expect(cfg.local).toBe("新机独有");
  // md：行并集，两边内容都在（按整行断言）
  const mdLines = (await fsp.readFile(path.join(target, "AGENTS.md"), "utf8")).split("\n");
  expect(mdLines).toContain("规则 v1-新机版");
  expect(mdLines).toContain("规则 v1");
  // 备份 = 原目标内容（新机值不丢）
  const backupCfg = JSON.parse(await fsp.readFile(path.join(report.backup_dir!, "cli/config.json"), "utf8")) as Record<string, unknown>;
  expect(backupCfg.local).toBe("新机独有");
  // verified 计数包含 merge 项
  expect(report.verified_files).toBe(plan.items.filter((i) => i.action !== "keep").length);
  // 报告中 merge 项 ok
  expect(report.executed.find((e) => e.action === "merge")?.status).toBe("ok");
});

it("applier_rejects_tampered_merge：篡改合并预览哈希 → 令牌校验拒绝执行", async () => {
  const { pkg, target } = await makeMergeScenario();
  const plan = await planApply(pkg, target, "incremental", [], () => {}, ["AGENTS.md"]);
  const item = plan.items.find((i) => i.action === "merge")!;
  item.merge!.merged_sha256 = "0".repeat(64);
  await expect(executeApply(plan, () => {})).rejects.toMatchObject({ code: "plan_not_confirmed" });
});

it("applier_merge_replay_detects_target_change：计划后目标文件变化 → 独立重放拒绝执行", async () => {
  const { pkg, target } = await makeMergeScenario();
  const plan = await planApply(pkg, target, "incremental", [], () => {}, ["cli/config.json"]);
  // 计划生成后目标文件又被改（如用户手动编辑）
  fs.writeFileSync(path.join(target, "cli/config.json"), '{"py":"被改过的内容","local":"新机独有","extra":1}');
  await expect(executeApply(plan, () => {})).rejects.toMatchObject({ code: "plan_not_confirmed" });
});

it("applier_no_merge_requests_unchanged_behavior：零合并请求时计划与无合并概念版本完全一致（回归锁）", async () => {
  const { pkg, target } = await makeMergeScenario();
  const planOld = await planApply(pkg, target, "incremental", [], () => {});
  const planEmpty = await planApply(pkg, target, "incremental", [], () => {}, []);
  expect(planEmpty.plan_token).toBe(planOld.plan_token);
  expect(planOld.items.every((i) => i.action !== "merge" && !i.merge)).toBe(true);
});

it("applier_merge_unsupported_type_falls_back：勾选不支持合并的类型 → 落回普通冲突动作", async () => {
  const [, pkg] = await makePackage();
  const target = path.join(path.dirname(pkg), "目标机");
  fs.mkdirSync(path.join(target, "cli/db"), { recursive: true });
  fs.writeFileSync(path.join(target, "cli/db/db.sqlite"), "新机库数据"); // sqlite 冲突，不在 .md/.json 支持范围
  const plan = await planApply(pkg, target, "incremental", [], () => {}, ["cli/db/db.sqlite"]);
  const item = plan.items.find((i) => i.target_rel === "cli/db/db.sqlite")!;
  expect(item.action).toBe("keep"); // 增量模式落回保留，不出现 merge
});
