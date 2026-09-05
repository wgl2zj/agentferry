// @vitest-environment node
// 资产扫描（scanner）测试：Rust scanner.rs 内联测试的逐条翻译，测试名保持一致
//（FEATURE_MAP 的"测试锁定"标注继续有效）。

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { AppError } from "./error";
import {
  kindOf,
  scan,
  scanSelected,
  type CategoryReport,
  type CategoryStatus,
  type FileKind,
} from "./scanner";
import type { AssetCategory, Profile } from "./profile/types";
import { claudeProfile } from "./profile/claude";
import { codexProfile } from "./profile/codex";
import { zcodeProfile } from "./profile/zcode";

// ---- 临时目录管理（对应 Rust tempfile::TempDir）----

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "af-scan-"));
  tempDirs.push(dir);
  return dir;
}

/** 无特权创建目录链接：Windows 用 junction，其余平台用目录符号链接。 */
function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

// ---- 构造假 ZCode 资产树：各类别齐备 + WAL 场景 + 排除项 ----

async function makeFakeTree(): Promise<string> {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# 规则\n");
  fs.mkdirSync(path.join(root, "skills/animate"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills/animate/SKILL.md"), "技能A".repeat(50));
  fs.mkdirSync(path.join(root, "commands"), { recursive: true });
  fs.writeFileSync(path.join(root, "commands/bsfb.md"), "命令1");
  fs.mkdirSync(path.join(root, "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, "agents/kimi-k3.md"), "子代理定义");
  fs.mkdirSync(path.join(root, "cli/memories/projects/p1"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/memories/projects/p1/MEMORY.md"), "记忆");
  fs.writeFileSync(path.join(root, "cli/config.json"), String.raw`{"mcp":[{"cmd":"C:\\Users\\old\\py.exe"}]}`);
  fs.mkdirSync(path.join(root, "v2"), { recursive: true });
  fs.writeFileSync(path.join(root, "v2/config.json"), "{}");
  fs.mkdirSync(path.join(root, "cli/plugins"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/plugins/installed_plugins.json"), "[]");
  fs.writeFileSync(path.join(root, "cli/plugins/known_marketplaces.json"), "[]");
  // 会话库 + WAL（触发阻断）
  fs.mkdirSync(path.join(root, "cli/db"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/db/db.sqlite"), "sqlite-bytes-0123456789");
  fs.writeFileSync(path.join(root, "cli/db/db.sqlite-wal"), "wal");
  // 任务索引（无 WAL，Ready）
  fs.writeFileSync(path.join(root, "v2/tasks-index.sqlite"), "idx-bytes");
  // 排除项
  fs.writeFileSync(path.join(root, "v2/credentials.json"), "enc:v1:xxx");
  fs.mkdirSync(path.join(root, "cli/log"), { recursive: true });
  fs.writeFileSync(path.join(root, "cli/log/run.log"), "日志".repeat(1000));
  return root;
}

function getCategory(categories: CategoryReport[], id: string): CategoryReport {
  const c = categories.find((x) => x.category_id === id);
  if (!c) throw new Error(`缺少类别 ${id}`);
  return c;
}

// ---- 契约锁定 ----

describe("序列化契约", () => {
  it("scanner_status_serialization_matches_frontend_contract：跨 IPC 枚举为前端类型镜像的小写字面量", () => {
    // 曾因大写 "Ready" 输出，真实模式前端全部误判为本机不存在（mock 手写小写掩盖漂移）
    const ready: CategoryStatus = { status: "ready" };
    const blocked: CategoryStatus = { status: "blocked", detail: "原因" };
    const missing: CategoryStatus = { status: "missing" };
    expect(JSON.parse(JSON.stringify(ready))).toEqual({ status: "ready" });
    expect(JSON.parse(JSON.stringify(blocked))).toEqual({ status: "blocked", detail: "原因" });
    expect(JSON.parse(JSON.stringify(missing))).toEqual({ status: "missing" });
    const kinds: FileKind[] = ["text", "binary", "sqlite"];
    expect(kinds).toEqual(["text", "binary", "sqlite"]);
  });

  it("scanner_kind_of_treats_jsonl_as_text：jsonl 判定为文本（引擎例外 #2，否则路径适配静默失效）", () => {
    expect(kindOf("a/b/session_index.jsonl")).toBe("text");
    expect(kindOf("history.jsonl")).toBe("text");
    // 既有判定不变
    expect(kindOf("x.sqlite")).toBe("sqlite");
    expect(kindOf("x.exe")).toBe("binary");
  });

  it("scanner_path_adapt_file_categories_are_text_kind：路径适配单文件类别的扩展名必须判为 Text", () => {
    // 一致性锁：pathfix 触发是"策略 + kind=text"双重门，名义标适配但 kind 不匹配会静默失效
    for (const p of [zcodeProfile(), codexProfile(), claudeProfile()]) {
      for (const c of p.categories) {
        if (c.strategy.kind === "CopyTextNeedsPathAdapt" && c.rule.type === "File") {
          expect(kindOf(c.rule.rel)).toBe("text");
        }
      }
    }
  });
});

// ---- 核心行为 ----

describe("scanner_categorizes_fake_tree（盘点归类）", () => {
  it("文件数、类别、kind、阻断与排除行为全部正确", async () => {
    const root = await makeFakeTree();
    const report = await scan(zcodeProfile(), root);
    const get = (id: string) => getCategory(report.categories, id);

    expect(get("skills").files).toHaveLength(1);
    expect(get("skills").files[0].rel_path).toBe("skills/animate/SKILL.md");
    expect(get("skills").files[0].kind).toBe("text");
    expect(get("skills").files[0].sha256).not.toBe("");

    // 插件清单 Many 规则收集 2 个文件
    expect(get("plugin_manifests").files).toHaveLength(2);

    // config 归类为 Text
    expect(get("main_config").files[0].kind).toBe("text");

    // WAL 存在 → 会话库阻断
    expect(get("session_db").status).toEqual({ status: "blocked", detail: expect.stringContaining("db.sqlite-wal") });
    // 任务索引无 WAL → Ready 且 kind=Sqlite
    expect(get("tasks_index").status).toEqual({ status: "ready" });
    expect(get("tasks_index").files[0].kind).toBe("sqlite");

    // 排除类别：不读内容（sha 为空）、不产生阻断
    const cred = get("credentials");
    expect(cred.files[0].sha256).toBe("");
    expect(cred.status).toEqual({ status: "ready" });
    expect(get("caches").total_bytes).toBeGreaterThan(0);
  });
});

it("scanner_missing_dir_is_not_error：未使用的功能目录缺失是合法状态（Missing），不报错", async () => {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "仅规则");
  const report = await scan(zcodeProfile(), root);
  const skills = getCategory(report.categories, "skills");
  expect(skills.status).toEqual({ status: "missing" });
});

it("scanner_follows_symlinked_skill_dirs：外链技能必须跟随并收集真实内容（真实事故 2026-08-17）", async () => {
  const external = await tempDir();
  const skill = path.join(external, "linked-skill");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "外链技能内容");

  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "规则");
  fs.mkdirSync(path.join(root, "skills"), { recursive: true });
  linkDir(skill, path.join(root, "skills", "linked-skill"));

  const report = await scan(zcodeProfile(), root);
  const skills = getCategory(report.categories, "skills");
  const rels = skills.files.map((f) => f.rel_path);
  expect(rels).toContain("skills/linked-skill/SKILL.md");
  const f = skills.files.find((x) => x.rel_path === "skills/linked-skill/SKILL.md");
  expect(f?.sha256).not.toBe("");
});

it("scanner_survives_link_cycles_and_sibling_links：真环不死循环；兄弟链接各自完整收集", async () => {
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "规则");
  const skills = path.join(root, "skills");
  fs.mkdirSync(skills, { recursive: true });
  const real = path.join(root, "real-skill");
  fs.mkdirSync(real, { recursive: true });
  fs.writeFileSync(path.join(real, "SKILL.md"), "真实内容");

  // 兄弟链接：a 与 a2 指向同一物理目标 → 两个入口各收一份
  linkDir(real, path.join(skills, "a"));
  linkDir(real, path.join(skills, "a2"));
  // 真环：real 内再放一个链接指回 real 自身
  linkDir(real, path.join(real, "loop"));

  const report = await scan(zcodeProfile(), root);
  const rels = getCategory(report.categories, "skills").files.map((f) => f.rel_path);
  expect(rels).toContain("skills/a/SKILL.md");
  expect(rels).toContain("skills/a2/SKILL.md");
  // 环内的 loop 入口被链上拦截，不产生 a/loop/SKILL.md
  expect(rels.some((r) => r.startsWith("skills/a/loop/"))).toBe(false);
});

it("scanner_scan_selected_only_returns_selected_categories：打包路径专用扫描行为锁", async () => {
  const root = await makeFakeTree();

  const report = await scanSelected(zcodeProfile(), root, ["skills"]);
  expect(report.categories).toHaveLength(1);
  expect(report.categories[0].category_id).toBe("skills");
  expect(report.categories[0].files).toHaveLength(1);
  expect(report.categories[0].files.every((f) => f.sha256 === "")).toBe(true);

  const report2 = await scanSelected(zcodeProfile(), root, ["session_db"]);
  expect(report2.categories[0].status.status).toBe("blocked");

  await expect(scanSelected(zcodeProfile(), root, ["no_such"])).rejects.toMatchObject({ code: "invalid_package" });
});

it("scanner_rejects_missing_root：根目录不存在时报路径错误", async () => {
  const missing = path.join(os.tmpdir(), "af-不存在-目录-404");
  await expect(scan(zcodeProfile(), missing)).rejects.toMatchObject({ code: "path_setup" });
});

it("scanner_never_mutates_source：扫描是只读的（前后目录内容与 mtime 不变）", async () => {
  const root = await makeFakeTree();
  const before = snapshotTree(root);
  await scan(zcodeProfile(), root);
  const after = snapshotTree(root);
  expect(after).toEqual(before);
});

it("scanner_scales_linearly_with_file_count：文件数 ×10 耗时增长 ≤ ×15（拦截超线性）", async () => {
  const small = await makeScaleTree(200);
  const [durSmall, filesSmall] = await timedScan(small);
  const large = await makeScaleTree(2000);
  const [durLarge, filesLarge] = await timedScan(large);

  expect(filesSmall).toBe(200);
  expect(filesLarge).toBe(2000);
  const ratioFiles = filesLarge / filesSmall; // 10x
  const ratioTime = durLarge / Math.max(durSmall, 1);
  expect(ratioTime).toBeLessThanOrEqual(ratioFiles * 1.5);
});

it("scanner_supports_second_profile：档案数据驱动，注册第二个假档案即可扫描（架构扩展性）", async () => {
  const fake: Profile = {
    id: "fakeagent",
    display_name: "假软件",
    version: 1,
    categories: [
      {
        id: "rules",
        display_name: "规则",
        description: "",
        tier: "Recommended",
        strategy: { kind: "Copy" },
        rule: { type: "File", rel: "RULES.md" },
        pack_warning: null,
      } satisfies AssetCategory,
    ],
  };
  const root = await tempDir();
  fs.writeFileSync(path.join(root, "RULES.md"), "规则内容");
  const report = await scan(fake, root);
  expect(report.profile_id).toBe("fakeagent");
  expect(report.categories[0].files).toHaveLength(1);
});

it("scanner_real_dir_smoke_codex_and_claude：真实目录只读 smoke（目录不存在则跳过；只读不改）", async () => {
  const { homeDir } = await import("./profile/runtime");
  for (const [profile, dotDir] of [
    [codexProfile(), ".codex"],
    [claudeProfile(), ".claude"],
  ] as const) {
    const root = path.join(homeDir(), dotDir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) continue;
    const report = await scan(profile, root);
    const get = (id: string) => getCategory(report.categories, id);
    // 排除类别：凭据与缓存绝不读内容（sha256 全空）
    for (const excluded of ["credentials", "caches", "config"]) {
      if (profile.categories.some((c) => c.id === excluded)) {
        for (const f of get(excluded).files) {
          expect(f.sha256).toBe("");
        }
      }
    }
    if (profile.id === "codex") {
      expect(get("main_config").status.status).toBe("ready");
      expect(["ready", "blocked"]).toContain(get("memories_db").status.status);
      expect(get("skills").files.length).toBeGreaterThan(0);
      expect(
        get("skills").files.some((f) => f.rel_path.startsWith("skills/.system/") || f.rel_path.includes("/SKILL.md")),
      ).toBe(true);
    }
    if (profile.id === "claude") {
      expect(get("settings").status.status).toBe("ready");
      expect(get("skills").files.length).toBeGreaterThan(0);
    }
  }
}, 180_000); // 真实资产含数百 MB 会话库，全量哈希明显超过默认 5s（与 Rust 版成本一致）

// ---- 工具函数 ----

interface SnapshotEntry {
  rel: string;
  size: number;
  mtime: number;
}

/** 递归快照（路径、大小、mtime）。 */
function snapshotTree(root: string): SnapshotEntry[] {
  const out: SnapshotEntry[] = [];
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

async function makeScaleTree(n: number): Promise<string> {
  const root = await tempDir();
  const skills = path.join(root, "skills");
  fs.mkdirSync(skills, { recursive: true });
  for (let i = 0; i < n; i += 1) {
    const sub = path.join(skills, `s${String(i).padStart(4, "0")}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "SKILL.md"), `技能内容 ${i} `.repeat(20));
  }
  return root;
}

async function timedScan(dir: string): Promise<[number, number]> {
  const start = Date.now();
  const report = await scan(zcodeProfile(), dir);
  const files = getCategory(report.categories, "skills").files.length;
  return [Date.now() - start, files];
}

/** AppError 引用守卫（确保 rejects.toMatchObject 命中的是统一错误协议）。 */
void AppError;
