// Codex 内置档案：路径规则来自 2026-08-17 本机实测勘察（OpenAI Codex 桌面版）。
// 实测结论：主配置 config.toml 顶层含 experimental_bearer_token（用户自配中转
// token，决策 1-A：照迁 + manifest 具体警告）；750MB 级日志库与运行态目录全部排除；
// skills/ 大量外链 → ~/.skills-manager，由扫描引擎跟随链接整体收集。
// 纯数据模块（渲染进程可安全引用）。

import type { Profile } from "./types";

/** 构造 Codex 档案（v1）。 */
export function codexProfile(): Profile {
  return {
    id: "codex",
    display_name: "Codex",
    version: 1,
    categories: [
      // ---- 推荐档：纯资产 ----
      { id: "global_rules", display_name: "全局规则（AGENTS.md）", description: "跨项目生效的 agent 行为规则", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "File", rel: "AGENTS.md" }, pack_warning: null },
      { id: "main_config", display_name: "主配置（config.toml）", description: "provider/模型/MCP/项目信任路径，需路径适配", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "config.toml" }, pack_warning: "本包含 API 凭据：config.toml 的 experimental_bearer_token 将随包迁移，请妥善保管迁移包" },
      { id: "skills", display_name: "技能（skills/）", description: "已安装技能（含 .system 系统技能与外链技能实体收集）", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "skills" }, pack_warning: null },
      { id: "rules", display_name: "规则（rules/）", description: "沙箱与行为规则文件", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "rules" }, pack_warning: null },
      { id: "memories_dir", display_name: "记忆库（memories/）", description: "持久记忆文本与版本历史（含 .git 整体迁入）", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "memories" }, pack_warning: null },
      { id: "memories_db", display_name: "记忆索引库（memories_1.sqlite）", description: "记忆索引（SQLite，源程序须完全退出）", tier: "Recommended", strategy: { kind: "SqliteDb" }, rule: { type: "File", rel: "memories_1.sqlite" }, pack_warning: null },
      // ---- 完整档：会话历史与工作态（日志类 jsonl 保留旧机路径原样迁入）----
      { id: "sessions", display_name: "会话记录（sessions/）", description: "按日期组织的会话 rollout 文件（约 345MB）", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "sessions" }, pack_warning: null },
      { id: "archived_sessions", display_name: "归档会话（archived_sessions/）", description: "已归档会话文件（约 111MB）", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "archived_sessions" }, pack_warning: null },
      { id: "session_index", display_name: "会话索引（session_index.jsonl）", description: "会话索引，含本机绝对路径，需路径适配", tier: "Full", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "session_index.jsonl" }, pack_warning: null },
      { id: "goals_db", display_name: "目标库（goals_1.sqlite）", description: "用户目标数据（SQLite，源程序须完全退出）", tier: "Full", strategy: { kind: "SqliteDb" }, rule: { type: "File", rel: "goals_1.sqlite" }, pack_warning: null },
      { id: "plugins_sources", display_name: "插件源码（plugins/sources/）", description: "已安装插件本体与元数据（约 137MB），元数据可能含本机路径", tier: "Full", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "Dir", rel: "plugins/sources" }, pack_warning: null },
      { id: "automations", display_name: "自动化定义（automations/）", description: "自动化任务定义", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "automations" }, pack_warning: null },
      { id: "attachments", display_name: "会话附件（attachments/）", description: "会话引用的附件文件，从属于会话历史", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "attachments" }, pack_warning: null },
      // ---- 排除：永不入包（tier 无意义，策略为排除）----
      { id: "credentials", display_name: "登录凭据（auth.json 等）", description: "绑定本机与账号，新机重新登录即可，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "Many", rels: ["auth.json", ".sandbox-secrets", "cap_sid"] }, pack_warning: null },
      { id: "caches", display_name: "运行缓存（日志库/插件服务器/临时目录等）", description: "约 1.3GB 可再生缓存与本机强绑定运行态，全部可重建，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "Many", rels: ["logs_1.sqlite", "logs_1.sqlite-wal", "logs_1.sqlite-shm", "logs_2.sqlite", "logs_2.sqlite-wal", "logs_2.sqlite-shm", "state_5.sqlite", "plugins/.plugin-appserver", "plugins/cache", "plugins/.remote-plugin-install-staging", "cache", "tmp", ".tmp", "backups", "backups_state", "worktrees", "sqlite", "vendor_imports", "node_repl", "browser", "computer-use", ".sandbox", ".sandbox-bin", "models_cache.json", ".codex-global-state.json", ".codex-global-state.json.bak", "chrome-native-hosts.json", "chrome-native-hosts-v2.json", "cc-switch-model-catalog.json", "installation_id", ".personality_migration", ".sandbox_migration", ".app-server-state-reconciled-v1", ".codex.zip", "ambient-suggestions", "visualizations", "pets", "process_manager", "local-marketplaces"] }, pack_warning: null },
    ],
  };
}
