//! ZCode 内置档案：路径规则来自《ZCode迁移可行性研究.md》的实测结论（2026-08-17）。
//! 仅收录实测过的软件目录；新软件需先勘察再新增档案。

use super::{AssetCategory, CategoryStrategy, PathRule, PresetTier, Profile};

/// 构造 ZCode 档案（v1）。
pub fn zcode_profile() -> Profile {
    Profile {
        id: "zcode".into(),
        display_name: "ZCode".into(),
        version: 1,
        categories: vec![
            // ---- 推荐档：纯资产（可 100% 无损迁移）----
            AssetCategory {
                id: "global_rules".into(),
                display_name: "全局规则（AGENTS.md）".into(),
                description: "跨项目生效的 agent 行为规则".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::File {
                    rel: "AGENTS.md".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "skills".into(),
                display_name: "技能（skills/）".into(),
                description: "已安装的全部技能".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "skills".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "commands".into(),
                display_name: "自定义命令（commands/）".into(),
                description: "斜杠命令定义".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "commands".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "agent_defs".into(),
                display_name: "子代理定义（agents/）".into(),
                description: "自定义子智能体定义".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "agents".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "memories".into(),
                display_name: "记忆库（cli/memories/）".into(),
                description: "各项目的持久记忆".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "cli/memories".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "main_config".into(),
                display_name: "主配置（cli/config.json）".into(),
                description: "含 MCP 命令行等本机绝对路径，需路径适配".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::CopyTextNeedsPathAdapt,
                rule: PathRule::File {
                    rel: "cli/config.json".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "v2_config".into(),
                display_name: "v2 配置（v2/config.json）".into(),
                description: "v2 状态类配置，可能含本机路径".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::CopyTextNeedsPathAdapt,
                rule: PathRule::File {
                    rel: "v2/config.json".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "plugin_manifests".into(),
                display_name: "插件清单（installed_plugins.json 等）".into(),
                description: "照单在新机重装插件".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Many {
                    rels: vec![
                        "cli/plugins/installed_plugins.json".into(),
                        "cli/plugins/known_marketplaces.json".into(),
                    ],
                },
                pack_warning: None,
            },
            // ---- 完整档：会话历史（可迁，SQLite 需退出检测）----
            AssetCategory {
                id: "session_db".into(),
                display_name: "会话历史库（cli/db/db.sqlite）".into(),
                description: "全部会话与消息（SQLite，源程序须完全退出）".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::SqliteDb,
                rule: PathRule::File {
                    rel: "cli/db/db.sqlite".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "artifacts".into(),
                display_name: "会话工件（cli/artifacts/）".into(),
                description: "按会话组织的产物文件".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "cli/artifacts".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "rollout".into(),
                display_name: "会话 rollout（cli/rollout/）".into(),
                description: "会话产物滚动输出".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "cli/rollout".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "tasks_index".into(),
                display_name: "任务索引（v2/tasks-index.sqlite）".into(),
                description: "任务索引库（SQLite，源程序须完全退出）".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::SqliteDb,
                rule: PathRule::File {
                    rel: "v2/tasks-index.sqlite".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "v2_sessions".into(),
                display_name: "导入会话（v2/sessions/）".into(),
                description: "从 Claude 导入的会话 JSON".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "v2/sessions".into(),
                },
                pack_warning: None,
            },
            // ---- 排除：永不入包 ----
            AssetCategory {
                id: "credentials".into(),
                display_name: "登录凭据（v2/credentials.json）".into(),
                description: "绑定本机加密存储，新机重新登录即可，不迁移".into(),
                tier: PresetTier::Recommended, // tier 无意义，策略为排除
                strategy: CategoryStrategy::Excluded,
                rule: PathRule::File {
                    rel: "v2/credentials.json".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "caches".into(),
                display_name: "运行缓存（日志/检查点/子代理产物等）".into(),
                description: "约 3GB 可再生缓存，全部可重建，不迁移".into(),
                tier: PresetTier::Recommended, // tier 无意义，策略为排除
                strategy: CategoryStrategy::Excluded,
                rule: PathRule::Many {
                    rels: vec![
                        "cli/agents".into(),
                        "v2/checkpoints".into(),
                        "cli/log".into(),
                        "v2/logs".into(),
                        "v2/crash".into(),
                        "cli/image-cache".into(),
                        "cli/plugins/cache".into(),
                    ],
                },
                pack_warning: None,
            },
        ],
    }
}
