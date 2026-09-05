// ZCode 内置档案：路径规则来自《ZCode迁移可行性研究.md》的实测结论（2026-08-17）。
// 仅收录实测过的软件目录；新软件需先勘察再新增档案。
// 纯数据模块（渲染进程可安全引用）。

import type { Profile } from "./types";

/** 构造 ZCode 档案（v1）。 */
export function zcodeProfile(): Profile {
  return {
    id: "zcode",
    display_name: "ZCode",
    version: 1,
    categories: [
      // ---- 推荐档：纯资产（可 100% 无损迁移）----
      { id: "global_rules", display_name: "全局规则（AGENTS.md）", description: "跨项目生效的 agent 行为规则", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "File", rel: "AGENTS.md" }, pack_warning: null },
      { id: "skills", display_name: "技能（skills/）", description: "已安装的全部技能", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "skills" }, pack_warning: null },
      { id: "commands", display_name: "自定义命令（commands/）", description: "斜杠命令定义", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "commands" }, pack_warning: null },
      { id: "agent_defs", display_name: "子代理定义（agents/）", description: "自定义子智能体定义", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "agents" }, pack_warning: null },
      { id: "memories", display_name: "记忆库（cli/memories/）", description: "各项目的持久记忆", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "cli/memories" }, pack_warning: null },
      { id: "main_config", display_name: "主配置（cli/config.json）", description: "含 MCP 命令行等本机绝对路径，需路径适配", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "cli/config.json" }, pack_warning: null },
      { id: "v2_config", display_name: "v2 配置（v2/config.json）", description: "v2 状态类配置，可能含本机路径", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "v2/config.json" }, pack_warning: null },
      { id: "plugin_manifests", display_name: "插件清单（installed_plugins.json 等）", description: "照单在新机重装插件", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Many", rels: ["cli/plugins/installed_plugins.json", "cli/plugins/known_marketplaces.json"] }, pack_warning: null },
      // ---- 完整档：会话历史（可迁，SQLite 需退出检测）----
      { id: "session_db", display_name: "会话历史库（cli/db/db.sqlite）", description: "全部会话与消息（SQLite，源程序须完全退出）", tier: "Full", strategy: { kind: "SqliteDb" }, rule: { type: "File", rel: "cli/db/db.sqlite" }, pack_warning: null },
      { id: "artifacts", display_name: "会话工件（cli/artifacts/）", description: "按会话组织的产物文件", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "cli/artifacts" }, pack_warning: null },
      { id: "rollout", display_name: "会话 rollout（cli/rollout/）", description: "会话产物滚动输出", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "cli/rollout" }, pack_warning: null },
      { id: "tasks_index", display_name: "任务索引（v2/tasks-index.sqlite）", description: "任务索引库（SQLite，源程序须完全退出）", tier: "Full", strategy: { kind: "SqliteDb" }, rule: { type: "File", rel: "v2/tasks-index.sqlite" }, pack_warning: null },
      { id: "v2_sessions", display_name: "导入会话（v2/sessions/）", description: "从 Claude 导入的会话 JSON", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "v2/sessions" }, pack_warning: null },
      // ---- 排除：永不入包（tier 无意义，策略为排除）----
      { id: "credentials", display_name: "登录凭据（v2/credentials.json）", description: "绑定本机加密存储，新机重新登录即可，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "File", rel: "v2/credentials.json" }, pack_warning: null },
      { id: "caches", display_name: "运行缓存（日志/检查点/子代理产物等）", description: "约 3GB 可再生缓存，全部可重建，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "Many", rels: ["cli/agents", "v2/checkpoints", "cli/log", "v2/logs", "v2/crash", "cli/image-cache", "cli/plugins/cache"] }, pack_warning: null },
    ],
  };
}
