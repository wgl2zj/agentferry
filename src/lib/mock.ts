// 浏览器演示模式 Mock 层 + 组件统一使用的 mock-aware 调用封装。
// 真实 Tauri 环境（window.__TAURI_INTERNALS__ 存在）：apiCall 直通 ipc.call、
// useProgress 直通后端 progress 事件，行为与生产完全一致；
// 纯浏览器（无 Tauri 后端）：返回内置演示数据，并按 ~2 秒节奏模拟进度事件，
// 供开发预览与截图验收使用。组件不得绕过本模块直接 invoke/listen。
//
// 契约红线：下方三份类别表（MOCK_ZCODE_CATEGORIES / MOCK_CODEX_CATEGORIES /
// MOCK_CLAUDE_CATEGORIES）必须与 src-tauri/src/profile/ 下 zcode.rs、codex.rs、
// claude.rs 逐行一致（id/display_name/tier/strategy/pack_warning），
// 由 src/lib/profileContract.test.ts 静态锁定（含 token 警告文案逐字断言）。
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef } from "react";
import {
  call,
  COMMANDS,
  type ApplyPlan,
  type ApplyReport,
  type CategoryInfo,
  type DetectResult,
  type Manifest,
  type ManifestFile,
  type PackResult,
  type PathFixReport,
  type PlanItem,
  type ProfileSummary,
  type ProgressPayload,
  type ScanReport,
  type ScannedFile,
  type Settings,
} from "./ipc";

/** 是否处于浏览器演示模式（无 Tauri 后端）。模块加载时判定一次，运行期不变。 */
export const isMock = !("__TAURI_INTERNALS__" in window);

/** 测试环境（vitest jsdom）下把演示节奏压缩到毫秒级，避免拖慢组件测试。
 *  浏览器演示可用 ?mocktick=毫秒 调节奏（如截图验收需放慢进度）。 */
const IS_TEST = import.meta.env?.MODE === "test";
const tickParam =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("mocktick")
    : null;
const TICK = IS_TEST ? 5 : tickParam !== null ? Number(tickParam) : 700;

// ---------------------------------------------------------------------------
// 进度事件桥：mock 模式用本地发射器，真实模式用 Tauri listen。
// ---------------------------------------------------------------------------

type ProgressHandler = (payload: ProgressPayload) => void;
const progressHandlers = new Set<ProgressHandler>();

function emitProgress(payload: ProgressPayload): void {
  progressHandlers.forEach((h) => h(payload));
}

/**
 * mock-aware 的进度事件 Hook：组件订阅后端 "progress" 事件的唯一入口。
 * 与 ipc.ts 的 useBackendEvent 同语义，但在无后端环境下自动切换到本地发射器。
 */
export function useProgress(handler: ProgressHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (isMock) {
      const h: ProgressHandler = (p) => ref.current(p);
      progressHandlers.add(h);
      return () => {
        progressHandlers.delete(h);
      };
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen<ProgressPayload>("progress", (e) => ref.current(e.payload))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // 极端兜底（如事件插件未注册）：静默降级，不影响主流程。
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

// ---------------------------------------------------------------------------
// 演示数据构造
// ---------------------------------------------------------------------------

const MOCK_PACKAGE = "D:\\迁移包\\zcode-迁移包-20260817.zam";

// 演示模式模拟"首用已推导 Downloads 默认目录"（与后端 load_settings 首用行为一致）；
// pickDirectory 演示返回 D:\迁移包，使「浏览→出现未保存修改」的演示闭环可复现。
let mockSettings: Settings = { default_output_dir: "C:\\Users\\demo\\Downloads" };

/**
 * ZCode 档案类别表（与 src-tauri/src/profile/zcode.rs 逐行一致；
 * id 行格式固定为 `id: "xxx"`，契约测试按此静态解析，改动需同步后端）。
 */
export const MOCK_ZCODE_CATEGORIES: CategoryInfo[] = [
  // ---- 推荐档：纯资产 ----
  { id: "global_rules", display_name: "全局规则（AGENTS.md）", description: "跨项目生效的 agent 行为规则", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "skills", display_name: "技能（skills/）", description: "已安装的全部技能", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "commands", display_name: "自定义命令（commands/）", description: "斜杠命令定义", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "agent_defs", display_name: "子代理定义（agents/）", description: "自定义子智能体定义", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "memories", display_name: "记忆库（cli/memories/）", description: "各项目的持久记忆", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "main_config", display_name: "主配置（cli/config.json）", description: "含 MCP 命令行等本机绝对路径，需路径适配", tier: "recommended", strategy: "copy_text_path_adapt", pack_warning: null },
  { id: "v2_config", display_name: "v2 配置（v2/config.json）", description: "v2 状态类配置，可能含本机路径", tier: "recommended", strategy: "copy_text_path_adapt", pack_warning: null },
  { id: "plugin_manifests", display_name: "插件清单（installed_plugins.json 等）", description: "照单在新机重装插件", tier: "recommended", strategy: "copy", pack_warning: null },
  // ---- 完整档：会话历史 ----
  { id: "session_db", display_name: "会话历史库（cli/db/db.sqlite）", description: "全部会话与消息（SQLite，源程序须完全退出）", tier: "full", strategy: "sqlite", pack_warning: null },
  { id: "artifacts", display_name: "会话工件（cli/artifacts/）", description: "按会话组织的产物文件", tier: "full", strategy: "copy", pack_warning: null },
  { id: "rollout", display_name: "会话 rollout（cli/rollout/）", description: "会话产物滚动输出", tier: "full", strategy: "copy", pack_warning: null },
  { id: "tasks_index", display_name: "任务索引（v2/tasks-index.sqlite）", description: "任务索引库（SQLite，源程序须完全退出）", tier: "full", strategy: "sqlite", pack_warning: null },
  { id: "v2_sessions", display_name: "导入会话（v2/sessions/）", description: "从 Claude 导入的会话 JSON", tier: "full", strategy: "copy", pack_warning: null },
  // ---- 排除：永不入包 ----
  { id: "credentials", display_name: "登录凭据（v2/credentials.json）", description: "绑定本机加密存储，新机重新登录即可，不迁移", tier: "excluded", strategy: "excluded", pack_warning: null },
  { id: "caches", display_name: "运行缓存（日志/检查点/子代理产物等）", description: "约 3GB 可再生缓存，全部可重建，不迁移", tier: "excluded", strategy: "excluded", pack_warning: null },
];

/**
 * Codex 档案类别表（与 src-tauri/src/profile/codex.rs 逐行一致）。
 * main_config 携带 experimental_bearer_token 随包警告（后端决策 1-A：照迁+具体警告）。
 */
export const MOCK_CODEX_CATEGORIES: CategoryInfo[] = [
  // ---- 推荐档：纯资产 ----
  { id: "global_rules", display_name: "全局规则（AGENTS.md）", description: "跨项目生效的 agent 行为规则", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "main_config", display_name: "主配置（config.toml）", description: "provider/模型/MCP/项目信任路径，需路径适配", tier: "recommended", strategy: "copy_text_path_adapt", pack_warning: "本包含 API 凭据：config.toml 的 experimental_bearer_token 将随包迁移，请妥善保管迁移包" },
  { id: "skills", display_name: "技能（skills/）", description: "已安装技能（含 .system 系统技能与外链技能实体收集）", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "rules", display_name: "规则（rules/）", description: "沙箱与行为规则文件", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "memories_dir", display_name: "记忆库（memories/）", description: "持久记忆文本与版本历史（含 .git 整体迁入）", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "memories_db", display_name: "记忆索引库（memories_1.sqlite）", description: "记忆索引（SQLite，源程序须完全退出）", tier: "recommended", strategy: "sqlite", pack_warning: null },
  // ---- 完整档：会话历史与工作态 ----
  { id: "sessions", display_name: "会话记录（sessions/）", description: "按日期组织的会话 rollout 文件（约 345MB）", tier: "full", strategy: "copy", pack_warning: null },
  { id: "archived_sessions", display_name: "归档会话（archived_sessions/）", description: "已归档会话文件（约 111MB）", tier: "full", strategy: "copy", pack_warning: null },
  { id: "session_index", display_name: "会话索引（session_index.jsonl）", description: "会话索引，含本机绝对路径，需路径适配", tier: "full", strategy: "copy_text_path_adapt", pack_warning: null },
  { id: "goals_db", display_name: "目标库（goals_1.sqlite）", description: "用户目标数据（SQLite，源程序须完全退出）", tier: "full", strategy: "sqlite", pack_warning: null },
  { id: "plugins_sources", display_name: "插件源码（plugins/sources/）", description: "已安装插件本体与元数据（约 137MB），元数据可能含本机路径", tier: "full", strategy: "copy_text_path_adapt", pack_warning: null },
  { id: "automations", display_name: "自动化定义（automations/）", description: "自动化任务定义", tier: "full", strategy: "copy", pack_warning: null },
  { id: "attachments", display_name: "会话附件（attachments/）", description: "会话引用的附件文件，从属于会话历史", tier: "full", strategy: "copy", pack_warning: null },
  // ---- 排除：永不入包 ----
  { id: "credentials", display_name: "登录凭据（auth.json 等）", description: "绑定本机与账号，新机重新登录即可，不迁移", tier: "excluded", strategy: "excluded", pack_warning: null },
  { id: "caches", display_name: "运行缓存（日志库/插件服务器/临时目录等）", description: "约 1.3GB 可再生缓存与本机强绑定运行态，全部可重建，不迁移", tier: "excluded", strategy: "excluded", pack_warning: null },
];

/**
 * Claude Code 档案类别表（与 src-tauri/src/profile/claude.rs 逐行一致）。
 * settings 携带 ANTHROPIC_AUTH_TOKEN 随包警告（后端决策 1-A：照迁+具体警告）。
 */
export const MOCK_CLAUDE_CATEGORIES: CategoryInfo[] = [
  // ---- 推荐档：纯资产 ----
  { id: "settings", display_name: "核心设置（settings.json）", description: "模型映射/代理地址/env，需路径适配", tier: "recommended", strategy: "copy_text_path_adapt", pack_warning: "本包含 API 凭据：settings.json 的 ANTHROPIC_AUTH_TOKEN 将随包迁移，请妥善保管迁移包" },
  { id: "global_memory", display_name: "全局记忆（CLAUDE.md）", description: "跨项目生效的全局记忆文件（未创建过则本机不存在）", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "skills", display_name: "技能（skills/）", description: "已安装技能（外链技能按目标实体收集）", tier: "recommended", strategy: "copy", pack_warning: null },
  { id: "plugins", display_name: "插件（plugins/）", description: "已安装插件本体与配置", tier: "recommended", strategy: "copy", pack_warning: null },
  // ---- 完整档：会话历史 ----
  { id: "projects", display_name: "项目会话（projects/）", description: "按项目组织的会话 JSONL；子目录名编码旧机绝对路径，历史原样迁入、新机不自动关联", tier: "full", strategy: "copy", pack_warning: null },
  { id: "sessions", display_name: "会话数据（sessions/）", description: "会话附属数据", tier: "full", strategy: "copy", pack_warning: null },
  { id: "history", display_name: "命令历史（history.jsonl）", description: "输入历史，历史记录原样迁入", tier: "full", strategy: "copy", pack_warning: null },
  { id: "file_history", display_name: "文件修改历史（file-history/）", description: "会话中文件修改的回滚历史", tier: "full", strategy: "copy", pack_warning: null },
  // ---- 排除：永不入包 ----
  { id: "config", display_name: "登录配置（config.json）", description: "含 primaryApiKey 字段，新机由登录流程重写，不迁移", tier: "excluded", strategy: "excluded", pack_warning: null },
  { id: "caches", display_name: "运行缓存（缓存/遥测/快照等）", description: "可再生运行态与遥测数据，全部可重建，不迁移", tier: "excluded", strategy: "excluded", pack_warning: null },
];

/** 单个档案的演示定义（list_profiles 返回形态的数据源）。 */
interface MockProfileDef {
  id: string;
  display_name: string;
  version: number;
  /** 默认根目录（家目录下 .zcode / .codex / .claude 风格）。 */
  root: string;
  categories: CategoryInfo[];
}

/** 三档案演示注册表：顺序即 list_profiles 返回顺序（zcode 为默认第一个）。 */
const MOCK_PROFILES: MockProfileDef[] = [
  { id: "zcode", display_name: "ZCode", version: 1, root: "C:\\Users\\demo\\.zcode", categories: MOCK_ZCODE_CATEGORIES },
  { id: "codex", display_name: "Codex", version: 1, root: "C:\\Users\\demo\\.codex", categories: MOCK_CODEX_CATEGORIES },
  { id: "claude", display_name: "Claude Code", version: 1, root: "C:\\Users\\demo\\.claude", categories: MOCK_CLAUDE_CATEGORIES },
];

/** 按 id 取档案；未知 id 回退第一个（zcode），与后端未知档案报错不同——演示层保持宽容。 */
function mockProfileById(id: string): MockProfileDef {
  return MOCK_PROFILES.find((p) => p.id === id) ?? MOCK_PROFILES[0];
}

/** ZCode 默认根（演示主档案根目录的快捷别名）。 */
const MOCK_ROOT = MOCK_PROFILES[0].root;

/** 由迁移包文件名推导档案 id：打包产物按 `<档案id>-迁移包-<日期>.zam` 命名，缺省 zcode。 */
function profileIdFromPackagePath(path: string | undefined): string {
  const name = (path ?? "").toLowerCase();
  if (name.includes("codex")) return "codex";
  if (name.includes("claude")) return "claude";
  return "zcode";
}

/** 档案对应的演示包路径（`<档案id>-迁移包-20260817.zam` 命名风格与打包向导建议名一致）。 */
function mockPackagePath(profileId: string): string {
  return `D:\\迁移包\\${profileId}-迁移包-20260817.zam`;
}

function fakeHash(seed: string): string {
  // 演示用伪哈希：仅要求形态像 SHA-256（64 位十六进制）。
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

function makeFiles(
  relPaths: (string | null)[],
  count: number,
  sizeEach: number,
  kind: ScannedFile["kind"] = "text",
  namePrefix?: string,
): ScannedFile[] {
  return Array.from({ length: count }, (_, i) => {
    const rel =
      relPaths[i] ??
      `${namePrefix ?? "assets"}/item-${String(i + 1).padStart(2, "0")}.json`;
    return { rel_path: rel, size: sizeEach, sha256: fakeHash(rel), kind };
  });
}

/** 各档案各类别的演示文件清单（rel_path 对齐档案 PathRule 的真实相对路径）。 */
const DEMO_FILES: Record<string, Record<string, ScannedFile[]>> = {
  zcode: {
    global_rules: makeFiles(["AGENTS.md"], 1, 12_000),
    skills: makeFiles(Array(34).fill(null), 34, 24_000, "text", "skills"),
    commands: makeFiles(Array(8).fill(null), 8, 3_000, "text", "commands"),
    agent_defs: makeFiles(Array(5).fill(null), 5, 12_000, "text", "agents"),
    memories: makeFiles(Array(3).fill(null), 3, 42_000, "text", "cli/memories"),
    main_config: makeFiles(["cli/config.json"], 1, 18_000),
    v2_config: makeFiles(["v2/config.json"], 1, 9_000),
    plugin_manifests: makeFiles(
      ["cli/plugins/installed_plugins.json", "cli/plugins/known_marketplaces.json"],
      2,
      4_000,
    ),
    artifacts: makeFiles(Array(12).fill(null), 12, 80_000, "binary", "cli/artifacts"),
    rollout: makeFiles(Array(6).fill(null), 6, 150_000, "text", "cli/rollout"),
    v2_sessions: makeFiles(Array(4).fill(null), 4, 60_000, "text", "v2/sessions"),
    credentials: makeFiles(["v2/credentials.json"], 1, 2_000),
    caches: makeFiles(
      ["v2/logs/app.log", "v2/checkpoints/cp-01.json", "cli/log/cli.log", "cli/image-cache/img-01.bin"],
      4,
      700_000_000,
      "binary",
    ),
  },
  codex: {
    global_rules: makeFiles(["AGENTS.md"], 1, 9_000),
    main_config: makeFiles(["config.toml"], 1, 6_000),
    skills: makeFiles(Array(21).fill(null), 21, 24_000, "text", "skills"),
    rules: makeFiles(Array(3).fill(null), 3, 2_000, "text", "rules"),
    memories_dir: makeFiles(Array(5).fill(null), 5, 30_000, "text", "memories"),
    memories_db: makeFiles(["memories_1.sqlite"], 1, 28_000_000, "sqlite"),
    sessions: makeFiles(Array(40).fill(null), 40, 8_600_000, "text", "sessions"),
    archived_sessions: makeFiles(Array(12).fill(null), 12, 9_200_000, "text", "archived_sessions"),
    session_index: makeFiles(["session_index.jsonl"], 1, 2_400_000),
    goals_db: makeFiles(["goals_1.sqlite"], 1, 4_100_000, "sqlite"),
    plugins_sources: makeFiles(Array(18).fill(null), 18, 7_600_000, "text", "plugins/sources"),
    automations: makeFiles(Array(3).fill(null), 3, 5_000, "text", "automations"),
    attachments: makeFiles(Array(9).fill(null), 9, 900_000, "binary", "attachments"),
    credentials: makeFiles(["auth.json", ".sandbox-secrets"], 2, 1_500),
    caches: makeFiles(
      ["logs_1.sqlite", "logs_2.sqlite", "plugins/cache/srv-01.bin", "tmp/scratch-01.tmp"],
      4,
      340_000_000,
      "binary",
    ),
  },
  claude: {
    settings: makeFiles(["settings.json"], 1, 3_000),
    skills: makeFiles(Array(12).fill(null), 12, 24_000, "text", "skills"),
    plugins: makeFiles(Array(6).fill(null), 6, 40_000, "text", "plugins"),
    projects: makeFiles(Array(25).fill(null), 25, 120_000, "text", "projects"),
    sessions: makeFiles(Array(4).fill(null), 4, 60_000, "text", "sessions"),
    history: makeFiles(["history.jsonl"], 1, 80_000),
    file_history: makeFiles(Array(8).fill(null), 8, 45_000, "text", "file-history"),
    config: makeFiles(["config.json"], 1, 1_200),
    caches: makeFiles(["cache/history-01.bin", "telemetry/events-01.json"], 2, 25_000_000, "binary"),
  },
};

/** 演示用盘点结果；scanCount ≥ 2 时 zcode 会话历史库变为可迁移（演示"重新检测"闭环）。 */
let scanCount = 0;

/** 测试专用：重置 mock 模块级状态，避免跨用例污染。 */
export function resetMockState(): void {
  scanCount = 0;
}

function mockScan(profileId: string): ScanReport {
  scanCount += 1;
  return buildScan(profileId, scanCount >= 2);
}

/** 纯构造盘点结果（不递增计数器）；sessionReady 控制 zcode 会话历史库是否解除阻断。 */
function buildScan(profileId: string, sessionReady: boolean): ScanReport {
  const profile = mockProfileById(profileId);
  const readyCat = (id: string) => {
    const files = DEMO_FILES[profile.id]?.[id] ?? [];
    return {
      category_id: id,
      status: { status: "ready" } as const,
      files,
      total_bytes: files.reduce((s, f) => s + f.size, 0),
    };
  };
  if (profile.id !== "zcode") {
    // codex / claude：按档案类别序生成；claude 的 global_memory 演示"本机不存在"
    //（对齐其 description「未创建过则本机不存在」的实测形态）。
    return {
      profile_id: profile.id,
      profile_version: profile.version,
      root: profile.root,
      categories: profile.categories.map((c) => {
        if (profile.id === "claude" && c.id === "global_memory") {
          return {
            category_id: c.id,
            status: { status: "missing" } as const,
            files: [],
            total_bytes: 0,
          };
        }
        return readyCat(c.id);
      }),
    };
  }
  return {
    profile_id: "zcode",
    profile_version: 1,
    root: MOCK_ROOT,
    categories: [
      readyCat("global_rules"),
      readyCat("skills"),
      readyCat("commands"),
      readyCat("agent_defs"),
      readyCat("memories"),
      readyCat("main_config"),
      readyCat("v2_config"),
      readyCat("plugin_manifests"),
      sessionReady
        ? {
            category_id: "session_db",
            status: { status: "ready" } as const,
            files: [
              {
                rel_path: "cli/db/db.sqlite",
                size: 436_000_000,
                sha256: fakeHash("cli/db/db.sqlite"),
                kind: "sqlite",
              },
            ],
            total_bytes: 436_000_000,
          }
        : {
            // 与后端真实行为一致：阻断类别也完成收集（有 files/体量），仅状态为阻断
            category_id: "session_db",
            status: {
              status: "blocked",
              detail:
                "检测到 db.sqlite-wal / db.sqlite-shm：ZCode 可能未完全退出，会话历史库仍在写入。",
            } as const,
            files: [
              {
                rel_path: "cli/db/db.sqlite",
                size: 436_000_000,
                sha256: fakeHash("cli/db/db.sqlite"),
                kind: "sqlite",
              },
            ],
            total_bytes: 436_000_000,
          },
      readyCat("artifacts"),
      readyCat("rollout"),
      {
        category_id: "tasks_index",
        status: { status: "missing" } as const,
        files: [],
        total_bytes: 0,
      },
      readyCat("v2_sessions"),
      readyCat("credentials"),
      readyCat("caches"),
    ],
  };
}

/** 各档案演示包的默认警告（openPackage 无调用方警告时的兜底）。
 *  zcode 演示包记录"会话历史库被跳过"；codex/claude 的 token 警告由下方
 *  pack_warning 追加逻辑自动生成（与后端 packer 同源，不在此手写第二份）。 */
const DEFAULT_PACK_WARNINGS: Record<string, string[]> = {
  zcode: ["会话历史库处于阻断状态，已按用户选择跳过（未入包）。"],
  codex: [],
  claude: [],
};

/** 由盘点结果推导演示用清单；只纳入 ready 且非 excluded 的类别。
 *  needs_path_adapt 依据档案 strategy === "copy_text_path_adapt"。
 *  warnings 组装镜像后端 packer：调用方警告在前，选中类别的档案级 pack_warning 按序追加在后。 */
function mockManifest(profileId: string, onlyCategories?: string[], warnings?: string[]): Manifest {
  const profile = mockProfileById(profileId);
  const adaptIds = new Set(
    profile.categories.filter((c) => c.strategy === "copy_text_path_adapt").map((c) => c.id),
  );
  const excludedIds = new Set(
    profile.categories.filter((c) => c.tier === "excluded").map((c) => c.id),
  );
  // 演示包内容：默认推荐档（ready 的推荐类）；显式传入类别时按传入过滤
  const recommended = profile.categories
    .filter((c) => c.tier === "recommended")
    .map((c) => c.id);
  const wanted = onlyCategories ?? recommended;
  const files: ManifestFile[] = [];
  for (const c of buildScan(profile.id, scanCount >= 2).categories) {
    if (c.status.status !== "ready") continue;
    if (excludedIds.has(c.category_id)) continue;
    if (!wanted.includes(c.category_id)) continue;
    for (const f of c.files) {
      files.push({
        path: `${profile.root}/${f.rel_path}`,
        target_rel: f.rel_path,
        category: c.category_id,
        sha256: f.sha256,
        size: f.size,
        kind: f.kind,
        needs_path_adapt: adaptIds.has(c.category_id) && f.kind === "text",
      });
    }
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  const usedCategories = [...new Set(files.map((f) => f.category))];
  // 选中类别携带的档案级警告（pack_warning）追加在调用方警告之后（与 packer.rs 同序）
  const packWarnings = wanted
    .map((id) => profile.categories.find((c) => c.id === id)?.pack_warning ?? null)
    .filter((w): w is string => w !== null);
  return {
    format_version: 1,
    app_version: "0.1.0",
    created_at: "2026-08-15T09:24:36+08:00",
    source: { os: "windows", arch: "x86_64", hostname: "OLD-PC", username: "zhangsan" },
    profile_id: profile.id,
    profile_version: profile.version,
    preset: { kind: "recommended", categories: usedCategories },
    files,
    counts: { files: files.length, categories: usedCategories.length },
    total_bytes: total,
    warnings: [...(warnings ?? DEFAULT_PACK_WARNINGS[profile.id] ?? []), ...packWarnings],
  };
}

function mockPlan(
  profileId: string,
  mode: "overwrite" | "incremental",
  overrides: string[],
  targetRoot?: string,
  packagePath?: string,
): ApplyPlan {
  const profile = mockProfileById(profileId);
  const manifest = mockManifest(profile.id);
  const items: PlanItem[] = manifest.files.map((f, i) => {
    const mod = i % 5;
    if (mod === 0) {
      // 一致跳过：目标已有同哈希文件。
      return {
        target_rel: f.target_rel,
        category: f.category,
        sha256: f.sha256,
        size: f.size,
        action: "skip_same",
        target_sha256: f.sha256,
      };
    }
    if (mod === 3) {
      // 冲突：目标已有不同内容。覆盖模式默认替换；增量模式默认保留，可被 overrides 改判。
      const conflicted = overrides.includes(f.target_rel);
      const action =
        mode === "overwrite" ? "replace" : conflicted ? "replace" : "keep";
      return {
        target_rel: f.target_rel,
        category: f.category,
        sha256: f.sha256,
        size: f.size,
        action,
        target_sha256: fakeHash(`target:${f.target_rel}`),
      };
    }
    return {
      target_rel: f.target_rel,
      category: f.category,
      sha256: f.sha256,
      size: f.size,
      action: "create",
      target_sha256: null,
    };
  });
  return {
    package_path: packagePath ?? mockPackagePath(profile.id),
    target_root: targetRoot?.trim() || profile.root,
    mode,
    package_digest: fakeHash("package"),
    items,
    plan_token: `mock-plan-${Date.now()}`,
    confirmed_overrides: overrides,
    backup_cleanup_hint:
      "备份目录已有 6 次历史备份，超出保留上限（最近 5 次）。建议清理最早的一次：zam-backups/20260803-112012。",
  };
}

/** 各档案演示包内需路径适配的文本文件（rel_path 对齐各档案路径适配类别的主文件）。 */
const DEMO_ADAPT_FILES: Record<string, string> = {
  zcode: "cli/config.json",
  codex: "config.toml",
  claude: "settings.json",
};

function mockDetect(profileId: string): DetectResult {
  const adaptFile = DEMO_ADAPT_FILES[profileId] ?? DEMO_ADAPT_FILES.zcode;
  return {
    seeds: [
      { old: "C:\\Users\\zhangsan", new: "C:\\Users\\demo", total_hits: 12 },
      { old: "D:\\old-zcode", new: "D:\\new-zcode", total_hits: 6 },
    ],
    files:
      profileId === "zcode"
        ? [
            { target_rel: adaptFile, total_hits: 18, skipped_reason: null },
            {
              target_rel: "v2/config.json",
              total_hits: 0,
              skipped_reason: "包含 BOM 或非 UTF-8 编码，已跳过并记入警告。",
            },
          ]
        : [{ target_rel: adaptFile, total_hits: 7, skipped_reason: null }],
  };
}

// ---------------------------------------------------------------------------
// 进度模拟：按步骤序列逐拍发射，phase 字面量与后端 commands.rs 实际发射一致。
// ---------------------------------------------------------------------------

interface ProgressStep {
  phase: string;
  message: string;
}

function runWithProgress<T>(task: string, steps: ProgressStep[], build: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    let i = 0;
    const total = steps.length;
    const tick = () => {
      if (i < total) {
        const s = steps[i];
        emitProgress({ task, phase: s.phase, message: s.message, current: i + 1, total });
        i += 1;
        setTimeout(tick, TICK);
      } else {
        resolve(build());
      }
    };
    setTimeout(tick, TICK);
  });
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), TICK));
}

// ---------------------------------------------------------------------------
// mock 命令路由
// ---------------------------------------------------------------------------

function mockRoute<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case COMMANDS.appInfo:
      return delay({ name: "agentferry", displayName: "资产摆渡", version: "0.1.0" } as T);

    case COMMANDS.listProfiles:
      return delay(
        MOCK_PROFILES.map(
          (p): ProfileSummary => ({
            id: p.id,
            display_name: p.display_name,
            version: p.version,
            category_count: p.categories.length,
            default_root: p.root,
            categories: p.categories,
          }),
        ) as T,
      );

    case COMMANDS.scanAssets:
      return delay(mockScan(String(args.profileId ?? "zcode")) as T);

    case COMMANDS.packAssets: {
      const profileId = String(args.profileId ?? "zcode");
      const outputPath = String(args.outputPath ?? mockPackagePath(profileId));
      const wanted = (args.categories as string[] | undefined) ?? undefined;
      return runWithProgress<PackResult>(
        "pack",
        [
          { phase: "scanning", message: "正在扫描资产" },
          { phase: "packing", message: "压缩写入迁移包（24/58）" },
          { phase: "packing", message: "压缩写入迁移包（51/58）" },
          { phase: "packing", message: "生成 manifest.json 清单" },
          { phase: "done", message: "打包完成" },
        ],
        () => {
          const manifest = mockManifest(
            profileId,
            wanted,
            (args.warnings as string[] | undefined) ?? undefined,
          );
          return {
            output_path: outputPath,
            package_bytes: Math.round(manifest.total_bytes * 0.42),
            manifest,
          };
        },
      ) as Promise<T>;
    }

    case COMMANDS.openPackage: {
      const profileId = profileIdFromPackagePath(args.path as string | undefined);
      return runWithProgress<Manifest>(
        "open",
        [
          { phase: "verifying", message: "解析 manifest.json" },
          { phase: "verifying", message: "逐文件校验 SHA-256（18/58）" },
          { phase: "verifying", message: "逐文件校验 SHA-256（52/58）" },
          { phase: "done", message: "校验通过" },
        ],
        () => mockManifest(profileId),
      ) as Promise<T>;
    }

    case COMMANDS.planApply: {
      const packagePath = args.path as string | undefined;
      const profileId = profileIdFromPackagePath(packagePath);
      return runWithProgress<ApplyPlan>(
        "plan",
        [
          { phase: "planning", message: "对比目标目录文件哈希" },
          { phase: "planning", message: "生成 dry-run 变更计划" },
        ],
        () =>
          mockPlan(
            profileId,
            (args.mode as "overwrite" | "incremental") ?? "incremental",
            (args.conflictOverrides as string[]) ?? [],
            args.targetRoot as string | undefined,
            packagePath,
          ),
      ) as Promise<T>;
    }

    case COMMANDS.executeApply: {
      const plan = args.plan as ApplyPlan | undefined;
      return runWithProgress<ApplyReport>(
        "apply",
        [
          { phase: "applying", message: "备份将被替换的目标文件" },
          { phase: "applying", message: "写入迁移包文件（31/58）" },
          { phase: "verifying", message: "逐文件复验 SHA-256" },
          { phase: "done", message: "解包完成" },
        ],
        () => {
          const items = plan?.items ?? [];
          return {
            target_root: plan?.target_root ?? MOCK_ROOT,
            executed: items.map((it) => ({
              target_rel: it.target_rel,
              action: it.action,
              // 与后端 applier.rs 契约一致：ok=已写入并复验 / skipped=计划内跳过
              status: (it.action === "skip_same" || it.action === "keep"
                ? "skipped"
                : "ok") as "ok" | "skipped",
            })),
            backup_dir: `${plan?.target_root ?? MOCK_ROOT}/zam-backups/20260817-101500`,
            verified_files: items.filter((i) => i.action === "create" || i.action === "replace")
              .length,
          };
        },
      ) as Promise<T>;
    }

    case COMMANDS.detectPathMappings:
      return delay(mockDetect(profileIdFromPackagePath(args.path as string | undefined)) as T);

    case COMMANDS.applyPathMappings: {
      // 契约：后端已移除 backup 参数（替换前必备份是红线，命令层不留关闭口子），
      // 此处入参只取 path + mappings。
      const profileId = profileIdFromPackagePath(args.path as string | undefined);
      const adaptFile = DEMO_ADAPT_FILES[profileId] ?? DEMO_ADAPT_FILES.zcode;
      const root =
        (args.targetRoot as string | undefined)?.trim() || mockProfileById(profileId).root;
      return runWithProgress<PathFixReport>(
        "pathfix",
        [
          { phase: "applying", message: "备份待替换文件" },
          { phase: "applying", message: "执行路径替换（保持 UTF-8 无 BOM）" },
          { phase: "done", message: "路径替换完成" },
        ],
        () => ({
          replaced: [{ target_rel: adaptFile, replacements: 18 }],
          skipped:
            profileId === "zcode"
              ? [{ target_rel: "v2/config.json", reason: "包含 BOM 或非 UTF-8 编码，已跳过。" }]
              : [],
          backup_dir: `${root}/zam-backups/20260817-101132`,
        }),
      ) as Promise<T>;
    }

    case COMMANDS.loadSettings:
      return delay({ ...mockSettings } as T);

    case COMMANDS.saveSettings: {
      const s = (args.settings as Settings | undefined) ?? mockSettings;
      mockSettings = { ...s };
      return delay(undefined as T);
    }

    default:
      return Promise.reject({ code: "internal", message: `未知命令：${cmd}` });
  }
}

/**
 * mock-aware 的类型化命令调用：组件调用后端的唯一入口。
 * 真实环境直通 ipc.call；浏览器演示环境走内置 mock 路由。
 */
export function apiCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isMock) return call<T>(cmd, args ?? {});
  return mockRoute<T>(cmd, args ?? {});
}

/**
 * mock-aware 目录选择：真实环境弹系统目录选择框（用户取消返回 null）；
 * 浏览器演示模式无系统对话框可弹，直接返回演示目录。
 * current 传入当前值用于在系统对话框中定位初始目录。
 */
export async function pickDirectory(current?: string): Promise<string | null> {
  if (!isMock) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      ...(current?.trim() ? { defaultPath: current.trim() } : {}),
    });
    return typeof picked === "string" ? picked : null;
  }
  return delay("D:\\迁移包");
}

/**
 * mock-aware 迁移包文件选择：真实环境弹系统文件选择框（仅 .zam，取消返回 null）；
 * 浏览器演示模式返回演示包路径。current 传入当前值用于定位初始目录。
 */
export async function pickPackage(current?: string): Promise<string | null> {
  if (!isMock) {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "资产摆渡迁移包", extensions: ["zam"] }],
      ...(current?.trim() ? { defaultPath: current.trim() } : {}),
    });
    return typeof picked === "string" ? picked : null;
  }
  return delay(MOCK_PACKAGE);
}
