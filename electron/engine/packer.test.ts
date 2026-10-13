// @vitest-environment node
// 打包（packer）测试：Rust packer.rs 内联测试的逐条翻译，测试名保持一致。

import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { AppError } from "./error";
import { pack, readManifest, type Manifest } from "./packer";
import { builtinProfiles, legacyProfileById } from "./profile";
import { categoryIdsForPreset } from "./profile/types";
import { zcodeProfile } from "./profile/zcode";
import { entryBuffer, openZip } from "./zipio";

const APP_VERSION = "0.1.6";

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "af-pack-"));
  tempDirs.push(dir);
  return dir;
}

/** 测试复用：读出包内指定条目的全部字节。 */
async function readEntry(packagePath: string, entryPath: string): Promise<Buffer> {
  const opened = await openZip(packagePath, "包损坏");
  try {
    const entry = opened.entries.get(entryPath);
    if (!entry) throw new AppError("invalid_package", `包内缺少 ${entryPath}`);
    return await entryBuffer(opened.zip, entry);
  } finally {
    opened.close();
  }
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeFakeTree(): Promise<string> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# 规则\n");
  fs.mkdirSync(path.join(root, "skills/animate"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills/animate/SKILL.md"), "技能内容".repeat(10));
  fs.mkdirSync(path.join(root, "cli"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/config.json"), String.raw`{"mcp":"C:\\Users\\old\\py.exe"}`);
  fs.mkdirSync(path.join(root, "cli/plugins/data/imgutil"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/plugins/installed_plugins.json"), "[]");
  fs.writeFileSync(path.join(root, "cli/plugins/icon-sources.json"), "{}");
  fs.writeFileSync(path.join(root, "cli/plugins/data/imgutil/state.json"), "{}");
  fs.mkdirSync(path.join(root, "cli/db"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/db/db.sqlite"), "sqlite-bytes-0123456789");
  fs.writeFileSync(path.join(root, "cli/db/db.sqlite-wal"), "wal");
  fs.mkdirSync(path.join(root, "v2"), { recursive: true });
  // v2 新推荐类别（占位凭据串，不进任何真实密钥）
  fs.writeFileSync(path.join(root, "hooks.json"), String.raw`{"hooks":[{"run":"node C:\\Users\\old\\hook.mjs"}]}`);
  fs.writeFileSync(path.join(root, "mcp.json"), '{"servers":{}}');
  fs.writeFileSync(path.join(root, "v2/setting.json"), String.raw`{"recent":["C:\\Users\\old\\proj"]}`);
  fs.writeFileSync(path.join(root, "v2/provider_config.json"), String.raw`{"providers":[{"access":{"apiKey":"PLACEHOLDER-KEY"}}]}`);
  fs.writeFileSync(path.join(root, "v2/bot-config.v3.json"), "{}");
  fs.writeFileSync(path.join(root, "v2/agents-state.json"), "{}");
  fs.mkdirSync(path.join(root, "openviking"), { recursive: true });
  fs.writeFileSync(path.join(root, "openviking/config.json"), '{"userKey":"PLACEHOLDER-USERKEY"}');
  fs.writeFileSync(path.join(root, "vibe-autostart.cmd"), "@echo off\n");
  fs.writeFileSync(path.join(root, "register-vibe-autostart.ps1"), "# 注册自启\n");
  // 完整档新成员
  fs.mkdirSync(path.join(root, "v2/checkpoints/sess-1"), { recursive: true });
  fs.writeFileSync(path.join(root, "v2/checkpoints/sess-1/cp-0001.json"), '{"checkpoint":1}');
  fs.mkdirSync(path.join(root, "v2/visualizations/sess-1"), { recursive: true });
  fs.writeFileSync(path.join(root, "v2/visualizations/sess-1/graph.svg"), "<svg/>");
  // 排除项：凭据 + v1 缓存 + caches 增补路径
  fs.writeFileSync(path.join(root, "v2/credentials.json"), "enc:v1:secret");
  fs.mkdirSync(path.join(root, "cli/log"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/log/run.log"), "日志".repeat(100));
  fs.mkdirSync(path.join(root, "cli/exec"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/exec/task-001.json"), "{}");
  fs.writeFileSync(path.join(root, "v2/bot-state.v2.json"), "{}");
  fs.writeFileSync(path.join(root, "v2/bot-state.v3.json"), "{}");
  fs.mkdirSync(path.join(root, "v2/certs"), { recursive: true });
  fs.writeFileSync(path.join(root, "v2/certs/ca-key.pem"), "PLACEHOLDER-PRIVATE-KEY");
  fs.mkdirSync(path.join(root, "workspace/default"), { recursive: true });
  fs.writeFileSync(path.join(root, "workspace/default/draft.md"), "草稿");
  fs.writeFileSync(path.join(root, "v2/onboarding-record.json"), "{}");
  return root;
}

function recommendedIds(): string[] {
  return categoryIdsForPreset(zcodeProfile(), { kind: "Recommended" });
}

it("packer_packs_linked_sources_via_physical_path：链接内源文件经物理路径入包（真实事故 2026-08-17 回归锁）", async () => {
  const external = await tempDir();
  const skill = path.join(external, "linked-skill");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "外链技能内容");

  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "规则");
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  fs.symlinkSync(skill, path.join(root, "skills", "linked-skill"), process.platform === "win32" ? "junction" : "dir");

  const out = path.join(root, "pkg/包.zam");
  await pack(zcodeProfile(), root, ["skills"], "custom", out, [], APP_VERSION, () => {});

  const manifest = await readManifest(out);
  const entry = manifest.files.find((f) => f.target_rel === "skills/linked-skill/SKILL.md");
  expect(entry, "链接技能未入包").toBeDefined();
  const bytes = await readEntry(out, entry!.path);
  expect(bytes.toString("utf8")).toBe("外链技能内容");
});

it("packer_roundtrip_manifest_and_hashes：打包 → 清单字段齐全 → 包内容与源一致且哈希吻合", async () => {
  const root = await makeFakeTree();
  const out = path.join(root, "out/迁移包.zam");
  let calls = 0;
  const result = await pack(zcodeProfile(), root, recommendedIds(), "recommended", out, [], APP_VERSION, (done, total) => {
    calls += 1;
    expect(done).toBeLessThanOrEqual(total);
  });

  expect(fs.statSync(out).isFile()).toBe(true);
  const m = result.manifest;
  expect(m.format_version).toBe(1);
  expect(m.profile_id).toBe("zcode");
  expect(m.preset.kind).toBe("recommended");
  expect(m.counts.files).toBe(m.files.length);
  expect(m.source.username).not.toBe("");
  // 进度回调按文件计数推进
  expect(calls).toBe(m.files.length);

  // 读回清单与文件内容：哈希吻合、needs_path_adapt 正确
  const readback = await readManifest(out);
  expect(readback.files).toHaveLength(m.files.length);
  for (const mf of readback.files) {
    const bytes = await readEntry(out, mf.path);
    expect(sha256Hex(bytes)).toBe(mf.sha256);
    if (mf.category === "main_config") {
      expect(mf.needs_path_adapt).toBe(true);
      expect(mf.kind).toBe("text");
    }
    if (mf.category === "skills") {
      expect(mf.needs_path_adapt).toBe(false);
    }
  }
  // config.json 内容原样入包
  const cfg = await readEntry(out, "payload/cli/config.json");
  expect(cfg.toString("utf8")).toContain(String.raw`C:\\Users\\old\\py.exe`);
});

it("packer_source_stays_untouched：反向测试，打包前后源目录零变化（内容与 mtime）", async () => {
  const root = await makeFakeTree();
  const before = snapshot(root);
  const out = path.join(root, "包.zam");
  await pack(zcodeProfile(), root, recommendedIds(), "recommended", out, [], APP_VERSION, () => {});
  const after = snapshot(root);
  // 排除打包产物自身后比对
  const filter = (v: { rel: string }[]) => v.filter((x) => x.rel !== "包.zam");
  expect(filter(after)).toEqual(filter(before));
});

it("packer_excluded_never_enters_package：反向测试，排除项（凭据/缓存）绝不出现在包与清单中", async () => {
  const root = await makeFakeTree();
  const out = path.join(root, "包.zam");
  const result = await pack(zcodeProfile(), root, recommendedIds(), "recommended", out, [], APP_VERSION, () => {});
  const allPaths = result.manifest.files.map((f) => f.target_rel);
  expect(allPaths.some((p) => p.includes("credentials"))).toBe(false);
  expect(allPaths.some((p) => p.includes("log/") || p.includes("image-cache"))).toBe(false);
  // E6：caches 增补路径（运行痕迹/状态 json/CA 私钥）不入清单
  expect(allPaths.some((p) => p.includes("bot-state") || p.includes("onboarding-record"))).toBe(false);
  // 物理读取包内全部条目名再核验一次
  const opened = await openZip(out, "包损坏");
  try {
    for (const name of opened.entries.keys()) {
      expect(name.includes("credentials"), `凭据泄漏进包：${name}`).toBe(false);
      expect(name.includes("cli/log/"), `缓存泄漏进包：${name}`).toBe(false);
      // E6 双重核验：增补排除路径物理不入包
      expect(name.includes("cli/exec/"), `运行痕迹泄漏进包：${name}`).toBe(false);
      expect(name.includes("v2/certs/"), `CA 私钥泄漏进包：${name}`).toBe(false);
      expect(name.includes("workspace/"), `默认工作区泄漏进包：${name}`).toBe(false);
      expect(name.includes("bot-state"), `状态缓存泄漏进包：${name}`).toBe(false);
    }
  } finally {
    opened.close();
  }
});

it("packer_v2_new_categories_enter_package_with_hashes：v2 新推荐类别入包并逐文件哈希复验（E2）", async () => {
  const root = await makeFakeTree();
  const newIds = [
    "hooks_config", "mcp_config", "app_settings", "provider_config", "bot_config",
    "agents_state", "openviking_state", "user_scripts", "plugin_state",
  ];
  // 完整档新成员一并验证：Custom 勾选可携带（E5 打包面）
  const ids = [...newIds, "checkpoints", "visualizations"];
  const out = path.join(root, "v2-新类.zam");
  await pack(zcodeProfile(), root, ids, "custom", out, [], APP_VERSION, () => {});

  const manifest = await readManifest(out);
  const covered = new Set(manifest.files.map((f) => f.category));
  for (const id of ids) {
    expect(covered.has(id), `类别 ${id} 未入包`).toBe(true);
  }
  // 逐文件哈希复验：包内读回内容重算哈希 == manifest 记录；路径适配标记按类别策略落位
  const opened = await openZip(out, "包损坏");
  try {
    for (const mf of manifest.files) {
      const entry = opened.entries.get(mf.path);
      expect(entry, `包内缺少 ${mf.path}`).toBeDefined();
      const bytes = await entryBuffer(opened.zip, entry!);
      expect(sha256Hex(bytes), `${mf.target_rel} 哈希不符`).toBe(mf.sha256);
      const adaptIds = new Set(["hooks_config", "app_settings", "provider_config"]);
      expect(mf.needs_path_adapt).toBe(adaptIds.has(mf.category));
    }
  } finally {
    opened.close();
  }
  // 具体文件抽验：凭据占位字段原样入包（照迁）、检查点/可视化条目存在
  const rels = manifest.files.map((f) => f.target_rel);
  expect(rels).toContain("v2/provider_config.json");
  expect(rels).toContain("openviking/config.json");
  expect(rels.some((r) => r.startsWith("v2/checkpoints/"))).toBe(true);
  expect(rels.some((r) => r.startsWith("v2/visualizations/"))).toBe(true);
  const providerBytes = await readEntry(out, "payload/v2/provider_config.json");
  expect(providerBytes.toString("utf8")).toContain("PLACEHOLDER-KEY");
});

it("packer_blocked_sqlite_rejected_and_skippable：WAL 库被选中 → 拒绝；跳过后可打包且警告入清单", async () => {
  const root = await makeFakeTree();
  const fullIds = categoryIdsForPreset(zcodeProfile(), { kind: "Full" });
  await expect(
    pack(zcodeProfile(), root, fullIds, "full", path.join(root, "包.zam"), [], APP_VERSION, () => {}),
  ).rejects.toMatchObject({ code: "source_not_quiet" });

  // 跳过会话历史（去掉 session_db）
  const skipIds = fullIds.filter((id) => id !== "session_db");
  const out = path.join(root, "跳过.zam");
  const result = await pack(
    zcodeProfile(),
    root,
    skipIds,
    "full",
    out,
    ["会话历史库检测到 WAL，按用户选择跳过"],
    APP_VERSION,
    () => {},
  );
  expect(result.manifest.warnings).toHaveLength(3);
  expect(result.manifest.warnings[0]).toContain("跳过");
  // v2：Full 档含 provider_config/openviking_state → 凭据警告按选中顺序追加（spec 决策 4）
  expect(result.manifest.warnings[1]).toContain("access.apiKey");
  expect(result.manifest.warnings[2]).toContain("userKey");
  const readback = await readManifest(out);
  expect(readback.files.some((f) => f.category === "session_db")).toBe(false);
});

it("packer_rejects_excluded_category_selection：直接要求打包排除类别 → 拒绝（防御 UI 层误传）", async () => {
  const root = await makeFakeTree();
  await expect(
    pack(zcodeProfile(), root, ["credentials"], "custom", path.join(root, "x.zam"), [], APP_VERSION, () => {}),
  ).rejects.toMatchObject({ code: "invalid_package" });
});

// ---- 构造 Codex / Claude 最小假树 ----

async function makeFakeCodexTree(): Promise<string> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# codex 规则\n");
  fs.writeFileSync(path.join(root, "config.toml"), 'experimental_bearer_token = "sk-x"\n');
  fs.mkdirSync(path.join(root, "skills/.system/imagegen"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills/.system/imagegen/SKILL.md"), "系统技能");
  fs.writeFileSync(path.join(root, "memories_1.sqlite"), "mem-db-bytes");
  fs.writeFileSync(path.join(root, "session_index.jsonl"), String.raw`{"p":"C:\\Users\\old\\x"}` + "\n");
  // 排除项：凭据与巨型日志
  fs.writeFileSync(path.join(root, "auth.json"), '{"token":"secret"}');
  fs.writeFileSync(path.join(root, "logs_2.sqlite"), "750MB-logs");
  fs.writeFileSync(path.join(root, "logs_2.sqlite-wal"), "wal");
  return root;
}

async function makeFakeClaudeTree(): Promise<string> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "settings.json"), '{"env":{"ANTHROPIC_AUTH_TOKEN":"k"}}');
  fs.mkdirSync(path.join(root, "skills/docx"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills/docx/SKILL.md"), "技能");
  fs.writeFileSync(path.join(root, "history.jsonl"), '{"q":"hi"}\n');
  fs.writeFileSync(path.join(root, "config.json"), '{"primaryApiKey":"any"}');
  fs.writeFileSync(path.join(root, ".last-cleanup"), "cache-marker");
  return root;
}

it("packer_pack_warnings_enter_manifest：选中携带 pack_warning 的类别时其确切字符串入清单（调用方警告在前）", async () => {
  const cases: [string, Promise<string>, string[]][] = [
    ["zcode", makeFakeTree(), ["skills", "provider_config", "openviking_state"]],
    ["codex", makeFakeCodexTree(), ["global_rules", "main_config"]],
    ["claude", makeFakeClaudeTree(), ["settings", "skills"]],
  ];
  for (const [profileId, dirPromise, ids] of cases) {
    const root = await dirPromise;
    // 产品收窄后 codex/claude 无打包入口；此处经已知档案全集取数据，
    // 模拟"旧版打出的包"以继续锁定 packer 对多档案矩阵的引擎行为（警告入清单/排除不入包）。
    const profile = legacyProfileById(profileId)!;
    const out = path.join(root, `${profileId}-包.zam`);
    await pack(profile, root, ids, "recommended", out, ["调用方警告"], APP_VERSION, () => {});
    const readback = await readManifest(out);
    // 调用方警告在前，档案警告按选中顺序追加
    expect(readback.warnings[0]).toBe("调用方警告");
    const expected = profile.categories
      .filter((c) => ids.includes(c.id))
      .map((c) => c.pack_warning)
      .filter((w) => w !== null);
    expect(readback.warnings.slice(1)).toEqual(expected);
    expect(readback.warnings.some((w) => w.includes("API 凭据"))).toBe(true);
  }
});

it("packer_zcode_warnings_unchanged_by_pack_warning：zcode 不选凭据类别时 warnings 与传入逐字节一致（回归锁，E3）", async () => {
  const root = await makeFakeTree();
  const out = path.join(root, "回归.zam");
  const passedIn = ["用户跳过说明"];
  // v2 起 provider_config/openviking_state 携带凭据警告；不选它们 → 警告行为与 v1 零变化
  const ids = recommendedIds().filter((id) => id !== "provider_config" && id !== "openviking_state");
  const result = await pack(zcodeProfile(), root, ids, "custom", out, passedIn, APP_VERSION, () => {});
  expect(result.manifest.warnings).toEqual(passedIn);
});

it("packer_none_pack_warning_adds_nothing：pack_warning=null 的类别不产生任何新增警告", async () => {
  const root = await makeFakeCodexTree();
  const out = path.join(root, "仅技能.zam");
  const result = await pack(legacyProfileById("codex")!, root, ["skills"], "custom", out, [], APP_VERSION, () => {});
  expect(result.manifest.warnings).toEqual([]);
});

it("packer_new_profiles_excluded_never_enters_package：新档案排除项不入包（manifest 与 zip 物理条目双重核验）", async () => {
  const cases: [string, Promise<string>, string[]][] = [
    ["codex", makeFakeCodexTree(), ["main_config", "skills", "memories_db", "session_index"]],
    ["claude", makeFakeClaudeTree(), ["settings", "skills", "history"]],
  ];
  for (const [profileId, dirPromise, ids] of cases) {
    const root = await dirPromise;
    // 同上：经已知档案全集取 codex/claude 数据（旧包形态），锁定排除项不入包的引擎行为。
    const profile = legacyProfileById(profileId)!;
    const out = path.join(root, `${profileId}-排除验.zam`);
    const result = await pack(profile, root, ids, "full", out, [], APP_VERSION, () => {});
    for (const forbidden of ["auth.json", "logs_2", "config.json", ".last-cleanup", "primaryApiKey"]) {
      expect(
        result.manifest.files.some((f) => f.target_rel.includes(forbidden)),
        `${profileId}：排除项 ${forbidden} 泄漏进 manifest`,
      ).toBe(false);
    }
    const opened = await openZip(out, "包损坏");
    try {
      for (const name of opened.entries.keys()) {
        for (const forbidden of ["auth.json", "logs_2", "config.json", ".last-cleanup"]) {
          expect(name.includes(forbidden), `${profileId}：排除项 ${forbidden} 泄漏进 zip：${name}`).toBe(false);
        }
      }
    } finally {
      opened.close();
    }
  }
});

it("packer_sqlite_stored_others_deflated：压缩策略行为锁（Sqlite 条目 Stored、其余 Deflated，Stored 内容与源一致）", async () => {
  const root = await makeFakeTree();
  // 无 WAL 的 sqlite 库（tasks_index 为 Full 档 File 规则；session_db 有 WAL 会被阻断）
  fs.writeFileSync(path.join(root, "v2/tasks-index.sqlite"), "idx-bytes-0123456789");
  const fullIds = categoryIdsForPreset(zcodeProfile(), { kind: "Full" });
  const ids = fullIds.filter((id) => id !== "session_db");
  const out = path.join(root, "压缩.zam");
  await pack(zcodeProfile(), root, ids, "full", out, [], APP_VERSION, () => {});

  const manifest = await readManifest(out);
  const opened = await openZip(out, "包损坏");
  try {
    let seenSqlite = false;
    for (const mf of manifest.files) {
      const entry = opened.entries.get(mf.path);
      expect(entry, `包内缺少 ${mf.path}`).toBeDefined();
      const method = entry!.compressionMethod; // 0=Stored 8=Deflated
      if (mf.kind === "sqlite") {
        seenSqlite = true;
        expect(method, `${mf.target_rel} 应 Stored`).toBe(0);
      } else {
        expect(method, `${mf.target_rel} 应 Deflated`).toBe(8);
      }
    }
    expect(seenSqlite, "测试树必须含 sqlite 条目").toBe(true);
    const mf = manifest.files.find((f) => f.kind === "sqlite")!;
    const bytes = await readEntry(out, mf.path);
    const source = await fsp.readFile(path.join(root, mf.target_rel));
    expect(bytes.equals(source), "Stored 条目内容与源不一致").toBe(true);
  } finally {
    opened.close();
  }
});

it("packer_pack_time_ignores_unselected_categories：打包耗时与未选中类别的文件数无关（scan_selected 性能面锁）", async () => {
  const [small, outSmall] = await makeTreeWithRollout(200);
  const [large, outLarge] = await makeTreeWithRollout(2000);
  const ids = ["skills"];

  const t0 = Date.now();
  await pack(zcodeProfile(), small, ids, "custom", outSmall, [], APP_VERSION, () => {});
  const dSmall = Date.now() - t0;

  const t1 = Date.now();
  await pack(zcodeProfile(), large, ids, "custom", outLarge, [], APP_VERSION, () => {});
  const dLarge = Date.now() - t1;

  expect(dLarge).toBeLessThanOrEqual(Math.max(dSmall, 1) * 2.5);
}, 60_000);

async function makeTreeWithRollout(n: number): Promise<[string, string]> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# 规则\n");
  fs.mkdirSync(path.join(root, "skills/animate"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills/animate/SKILL.md"), "技能内容".repeat(20));
  const rollout = path.join(root, "cli/rollout");
  fs.mkdirSync(rollout, { recursive: true });
  for (let i = 0; i < n; i += 1) {
    fs.writeFileSync(path.join(rollout, `r${String(i).padStart(4, "0")}.jsonl`), `{"i":${i}}`.repeat(50));
  }
  return [root, path.join(root, "pkg/包.zam")];
}

function snapshot(root: string): { rel: string; size: number; mtime: number }[] {
  const out: { rel: string; size: number; mtime: number }[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) {
        const st = fs.statSync(full);
        out.push({ rel: path.relative(root, full), size: st.size, mtime: st.mtimeMs });
      }
    }
  };
  walk(root);
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return out;
}

/** Manifest 类型引用守卫（该类型为跨 IPC 契约的引擎侧定义）。 */
void (null as unknown as Manifest | null);
void builtinProfiles;
