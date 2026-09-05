// Claude Code 内置档案：路径规则来自 2026-08-17 本机实测勘察。
// 实测结论：核心配置 settings.json 的 env 含 ANTHROPIC_AUTH_TOKEN（用户自配中转
// token，决策 1-A：照迁 + manifest 具体警告）；无 SQLite 库；家目录 ~/.claude.json
// 为运行统计（99% 缓存、无凭据键）且位于档案根之外，v1 不迁不收（决策 4）；
// projects/ 子目录名编码旧机绝对路径，按历史记录原样迁入不重挂。
// 纯数据模块（渲染进程可安全引用）。

import type { Profile } from "./types";

/** 构造 Claude Code 档案（v1）。 */
export function claudeProfile(): Profile {
  return {
    id: "claude",
    display_name: "Claude Code",
    version: 1,
    categories: [
      // ---- 推荐档：纯资产 ----
      { id: "settings", display_name: "核心设置（settings.json）", description: "模型映射/代理地址/env，需路径适配", tier: "Recommended", strategy: { kind: "CopyTextNeedsPathAdapt" }, rule: { type: "File", rel: "settings.json" }, pack_warning: "本包含 API 凭据：settings.json 的 ANTHROPIC_AUTH_TOKEN 将随包迁移，请妥善保管迁移包" },
      { id: "global_memory", display_name: "全局记忆（CLAUDE.md）", description: "跨项目生效的全局记忆文件（未创建过则本机不存在）", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "File", rel: "CLAUDE.md" }, pack_warning: null },
      { id: "skills", display_name: "技能（skills/）", description: "已安装技能（外链技能按目标实体收集）", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "skills" }, pack_warning: null },
      { id: "plugins", display_name: "插件（plugins/）", description: "已安装插件本体与配置", tier: "Recommended", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "plugins" }, pack_warning: null },
      // ---- 完整档：会话历史（历史记录保留旧机路径原样迁入）----
      { id: "projects", display_name: "项目会话（projects/）", description: "按项目组织的会话 JSONL；子目录名编码旧机绝对路径，历史原样迁入、新机不自动关联", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "projects" }, pack_warning: null },
      { id: "sessions", display_name: "会话数据（sessions/）", description: "会话附属数据", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "sessions" }, pack_warning: null },
      { id: "history", display_name: "命令历史（history.jsonl）", description: "输入历史，历史记录原样迁入", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "File", rel: "history.jsonl" }, pack_warning: null },
      { id: "file_history", display_name: "文件修改历史（file-history/）", description: "会话中文件修改的回滚历史", tier: "Full", strategy: { kind: "Copy" }, rule: { type: "Dir", rel: "file-history" }, pack_warning: null },
      // ---- 排除：永不入包（tier 无意义，策略为排除）----
      { id: "config", display_name: "登录配置（config.json）", description: "含 primaryApiKey 字段，新机由登录流程重写，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "File", rel: "config.json" }, pack_warning: null },
      { id: "caches", display_name: "运行缓存（缓存/遥测/快照等）", description: "可再生运行态与遥测数据，全部可重建，不迁移", tier: "Recommended", strategy: { kind: "Excluded" }, rule: { type: "Many", rels: ["cache", "telemetry", "backups", "ide", "session-env", "shell-snapshots", ".clawhub", ".last-cleanup", ".update.lock", ".last-update-result.json"] }, pack_warning: null },
    ],
  };
}
