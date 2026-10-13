// ZCode 内置档案 v2：类别定性以 ZCode 官方开源仓库存储目录清单
//（packages/services/src/storage/domain/storageCatalog.ts）为权威依据，
// 叠加本机实测（2026-10-13 复勘，详见 .scratch/zcode-v2/spec.md 实施决策第 3 条）。
// 仅收录实测过的软件目录；新软件需先勘察再新增档案。
// 纯数据模块（渲染进程可安全引用）。

import type { Profile } from "./types";

/** 构造 ZCode 档案（v2，26 类别：推荐档 17 + 完整档 7 + 排除 2 类承载）。 */
export function zcodeProfile(): Profile {
  return {
    id: "zcode",
    display_name: "ZCode",
    version: 2,
    categories: [
      // ---- 推荐档：全部复刻必需配置（解包后功能与老机器一致）----
      { id: "global_rules", display_name: "全局规则（AGENTS.md）", description: "跨项目生效的 agent 行为规则", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "File", rel: "AGENTS.md" }, pack_warning: null },
      { id: "skills", display_name: "技能（skills/）", description: "已安装的全部技能", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "skills" }, pack_warning: null },
      { id: "commands", display_name: "自定义命令（commands/）", description: "斜杠命令定义", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "commands" }, pack_warning: null },
      { id: "agent_defs", display_name: "子代理定义（agents/）", description: "自定义子智能体定义", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "agents" }, pack_warning: null },
      { id: "memories", display_name: "记忆库（cli/memories/）", description: "各项目的持久记忆", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "cli/memories" }, pack_warning: null },
      { id: "main_config", display_name: "主配置（cli/config.json）", description: "含 MCP 命令行等本机绝对路径，需路径适配", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "cli/config.json" }, pack_warning: null },
      { id: "v2_config", display_name: "v2 配置（v2/config.json）", description: "v2 状态类配置，可能含本机路径", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "v2/config.json" }, pack_warning: null },
      { id: "plugin_manifests", display_name: "插件清单（installed_plugins.json 等）", description: "照单在新机重装插件（含图标来源）", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Many", rels: ["cli/plugins/installed_plugins.json", "cli/plugins/known_marketplaces.json", "cli/plugins/icon-sources.json"] }, pack_warning: null },
      { id: "hooks_config", display_name: "记忆钩子配置（hooks.json）", description: "钩子命令含本机绝对路径，需路径适配；新机可能需一次信任确认", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "hooks.json" }, pack_warning: null },
      { id: "mcp_config", display_name: "用户级 MCP（mcp.json）", description: "用户级 MCP 服务器清单", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "File", rel: "mcp.json" }, pack_warning: null },
      { id: "app_settings", display_name: "应用设置（v2/setting.json）", description: "语言、快捷键、最近项目等，可能含本机路径", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "v2/setting.json" }, pack_warning: null },
      { id: "provider_config", display_name: "模型服务商（v2/provider_config.json）", description: "自定义模型服务商配置，内嵌明文密钥且含本机路径", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "v2/provider_config.json" }, pack_warning: "本包含 API 凭据：v2/provider_config.json 的 access.apiKey（嵌套字段）将随包迁移，请妥善保管迁移包" },
      { id: "bot_config", display_name: "机器人配置（v2/bot-config*.json）", description: "机器人渠道与行为配置", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Many", rels: ["v2/bot-config.v3.json", "v2/bot-config.json"] }, pack_warning: null },
      { id: "agents_state", display_name: "代理启用状态（v2/agents-state.json）", description: "代理启用/禁用与模型覆盖", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "File", rel: "v2/agents-state.json" }, pack_warning: null },
      { id: "openviking_state", display_name: "OpenViking 接入（openviking/）", description: "记忆库钩子接入配置与脚本；新机需自行安装 OpenViking 本体", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "openviking" }, pack_warning: "本包含 API 凭据：openviking/ 配置的 userKey 将随包迁移，请妥善保管迁移包" },
      { id: "user_scripts", display_name: "自建自启脚本（vibe-autostart 等）", description: "用户自建的开机自启与注册脚本", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Many", rels: ["vibe-autostart.cmd", "register-vibe-autostart.ps1"] }, pack_warning: null },
      { id: "plugin_state", display_name: "插件状态（data/ 与 marketplaces/）", description: "插件数据与市场克隆，保证完美复刻", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Many", rels: ["cli/plugins/data", "cli/plugins/marketplaces"] }, pack_warning: null },
      // ---- 完整档：会话历史（对话可选项；SQLite 需退出检测）----
      { id: "session_db", display_name: "会话历史库（cli/db/db.sqlite）", description: "全部会话与消息（SQLite，源程序须完全退出）", tier: "Full", strategy: { kind: "SqliteDb" }, rule: { type: "File", rel: "cli/db/db.sqlite" }, pack_warning: null },
      { id: "artifacts", display_name: "会话工件（cli/artifacts/）", description: "按会话组织的产物文件", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "cli/artifacts" }, pack_warning: null },
      { id: "rollout", display_name: "会话 rollout（cli/rollout/）", description: "会话产物滚动输出", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "cli/rollout" }, pack_warning: null },
      { id: "tasks_index", display_name: "任务索引（v2/tasks-index.sqlite）", description: "任务索引库（SQLite，源程序须完全退出）", tier: "Full", strategy: { kind: "SqliteDb" }, rule: { type: "File", rel: "v2/tasks-index.sqlite" }, pack_warning: null },
      { id: "v2_sessions", display_name: "导入会话（v2/sessions/）", description: "从 Claude 导入的会话 JSON", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "v2/sessions" }, pack_warning: null },
      { id: "checkpoints", display_name: "会话检查点（v2/checkpoints/）", description: "会话检查点现场（官方归类会话存储，体量可达约 1GB）", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "v2/checkpoints" }, pack_warning: null },
      { id: "visualizations", display_name: "会话可视化（v2/visualizations/）", description: "会话可视化产物", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "v2/visualizations" }, pack_warning: null },
      // ---- 排除：永不入包（tier 无意义，策略为排除）----
      { id: "credentials", display_name: "登录凭据（v2/credentials.json）", description: "绑定本机加密存储，新机重新登录即可，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "File", rel: "v2/credentials.json" }, pack_warning: null },
      { id: "caches", display_name: "运行痕迹（子代理现场/工作区/缓存/CA 私钥等）", description: "可再生运行痕迹与安全材料（约 4GB+），全部不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "Many", rels: ["cli/agents", "cli/log", "v2/logs", "v2/crash", "cli/image-cache", "cli/plugins/cache", "cli/exec", "cli/sessions", "cli/pdf-cache", "workspace", "tmp", "v2/agent-config", "v2/repo-wiki", "v2/runtime", "v2/certs", "v2/bots-runtime-locks", "v2/coding-plan-cache.json", "v2/bots-model-cache.v2.json", "v2/telemetry-state.json", "v2/onboarding-record.json", "v2/bot-state.v2.json", "v2/bot-state.v3.json", "feedback", "export-log-stage", "plugin-workspace"] }, pack_warning: null },
    ],
  };
}
