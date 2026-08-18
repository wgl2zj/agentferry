//! Codex 内置档案：路径规则来自 2026-08-17 本机实测勘察（OpenAI Codex 桌面版）。
//! 实测结论：主配置 config.toml 顶层含 experimental_bearer_token（用户自配中转
//! token，决策 1-A：照迁 + manifest 具体警告）；750MB 级日志库与运行态目录全部排除；
//! skills/ 大量外链 → ~/.skills-manager，由扫描引擎跟随链接整体收集。

use super::{AssetCategory, CategoryStrategy, PathRule, PresetTier, Profile};

/// 构造 Codex 档案（v1）。
pub fn codex_profile() -> Profile {
    Profile {
        id: "codex".into(),
        display_name: "Codex".into(),
        version: 1,
        categories: vec![
            // ---- 推荐档：纯资产 ----
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
                id: "main_config".into(),
                display_name: "主配置（config.toml）".into(),
                description: "provider/模型/MCP/项目信任路径，需路径适配".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::CopyTextNeedsPathAdapt,
                rule: PathRule::File {
                    rel: "config.toml".into(),
                },
                pack_warning: Some(
                    "本包含 API 凭据：config.toml 的 experimental_bearer_token 将随包迁移，请妥善保管迁移包".into(),
                ),
            },
            AssetCategory {
                id: "skills".into(),
                display_name: "技能（skills/）".into(),
                description: "已安装技能（含 .system 系统技能与外链技能实体收集）".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "skills".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "rules".into(),
                display_name: "规则（rules/）".into(),
                description: "沙箱与行为规则文件".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "rules".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "memories_dir".into(),
                display_name: "记忆库（memories/）".into(),
                description: "持久记忆文本与版本历史（含 .git 整体迁入）".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "memories".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "memories_db".into(),
                display_name: "记忆索引库（memories_1.sqlite）".into(),
                description: "记忆索引（SQLite，源程序须完全退出）".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::SqliteDb,
                rule: PathRule::File {
                    rel: "memories_1.sqlite".into(),
                },
                pack_warning: None,
            },
            // ---- 完整档：会话历史与工作态（日志类 jsonl 保留旧机路径原样迁入） ----
            AssetCategory {
                id: "sessions".into(),
                display_name: "会话记录（sessions/）".into(),
                description: "按日期组织的会话 rollout 文件（约 345MB）".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "sessions".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "archived_sessions".into(),
                display_name: "归档会话（archived_sessions/）".into(),
                description: "已归档会话文件（约 111MB）".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "archived_sessions".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "session_index".into(),
                display_name: "会话索引（session_index.jsonl）".into(),
                description: "会话索引，含本机绝对路径，需路径适配".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::CopyTextNeedsPathAdapt,
                rule: PathRule::File {
                    rel: "session_index.jsonl".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "goals_db".into(),
                display_name: "目标库（goals_1.sqlite）".into(),
                description: "用户目标数据（SQLite，源程序须完全退出）".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::SqliteDb,
                rule: PathRule::File {
                    rel: "goals_1.sqlite".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "plugins_sources".into(),
                display_name: "插件源码（plugins/sources/）".into(),
                description: "已安装插件本体与元数据（约 137MB），元数据可能含本机路径".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::CopyTextNeedsPathAdapt,
                rule: PathRule::Dir {
                    rel: "plugins/sources".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "automations".into(),
                display_name: "自动化定义（automations/）".into(),
                description: "自动化任务定义".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "automations".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "attachments".into(),
                display_name: "会话附件（attachments/）".into(),
                description: "会话引用的附件文件，从属于会话历史".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "attachments".into(),
                },
                pack_warning: None,
            },
            // ---- 排除：永不入包 ----
            AssetCategory {
                id: "credentials".into(),
                display_name: "登录凭据（auth.json 等）".into(),
                description: "绑定本机与账号，新机重新登录即可，不迁移".into(),
                tier: PresetTier::Recommended, // tier 无意义，策略为排除
                strategy: CategoryStrategy::Excluded,
                rule: PathRule::Many {
                    rels: vec![
                        "auth.json".into(),
                        ".sandbox-secrets".into(),
                        "cap_sid".into(),
                    ],
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "caches".into(),
                display_name: "运行缓存（日志库/插件服务器/临时目录等）".into(),
                description: "约 1.3GB 可再生缓存与本机强绑定运行态，全部可重建，不迁移".into(),
                tier: PresetTier::Recommended, // tier 无意义，策略为排除
                strategy: CategoryStrategy::Excluded,
                rule: PathRule::Many {
                    rels: vec![
                        "logs_1.sqlite".into(),
                        "logs_1.sqlite-wal".into(),
                        "logs_1.sqlite-shm".into(),
                        "logs_2.sqlite".into(),
                        "logs_2.sqlite-wal".into(),
                        "logs_2.sqlite-shm".into(),
                        "state_5.sqlite".into(),
                        "plugins/.plugin-appserver".into(),
                        "plugins/cache".into(),
                        "plugins/.remote-plugin-install-staging".into(),
                        "cache".into(),
                        "tmp".into(),
                        ".tmp".into(),
                        "backups".into(),
                        "backups_state".into(),
                        "worktrees".into(),
                        "sqlite".into(),
                        "vendor_imports".into(),
                        "node_repl".into(),
                        "browser".into(),
                        "computer-use".into(),
                        ".sandbox".into(),
                        ".sandbox-bin".into(),
                        "models_cache.json".into(),
                        ".codex-global-state.json".into(),
                        ".codex-global-state.json.bak".into(),
                        "chrome-native-hosts.json".into(),
                        "chrome-native-hosts-v2.json".into(),
                        "cc-switch-model-catalog.json".into(),
                        "installation_id".into(),
                        ".personality_migration".into(),
                        ".sandbox_migration".into(),
                        ".app-server-state-reconciled-v1".into(),
                        ".codex.zip".into(),
                        "ambient-suggestions".into(),
                        "visualizations".into(),
                        "pets".into(),
                        "process_manager".into(),
                        "local-marketplaces".into(),
                    ],
                },
                pack_warning: None,
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::{category_ids_for_preset, home_dir, Preset};

    /// 档位解析：推荐档只含纯资产，完整档含会话历史，排除项任何档位不可选。
    #[test]
    fn codex_preset_filters_categories() {
        let p = codex_profile();
        let rec = category_ids_for_preset(&p, &Preset::Recommended);
        assert_eq!(
            rec,
            vec![
                "global_rules", "main_config", "skills", "rules", "memories_dir", "memories_db"
            ]
        );
        let full = category_ids_for_preset(&p, &Preset::Full);
        assert!(full.contains(&"sessions".into()));
        assert!(full.contains(&"session_index".into()));
        assert!(full.contains(&"plugins_sources".into()));
        assert!(!full.contains(&"credentials".into()));
        assert!(!full.contains(&"caches".into()));
        // 自定义档请求排除类别时被过滤
        let custom = category_ids_for_preset(&p, &Preset::Custom(vec!["skills".into(), "credentials".into()]));
        assert_eq!(custom, vec!["skills".to_string()]);
    }

    /// 默认根目录映射到家目录下 .codex（home_dir_name 映射，非裸 id）。
    #[test]
    fn codex_default_root_maps_to_dot_dir() {
        assert_eq!(codex_profile().default_root(), home_dir().join(".codex"));
    }

    /// token 警告沉在档案数据里：main_config 携带具体字段名的警告（决策 1-A）。
    #[test]
    fn codex_main_config_carries_token_warning() {
        let p = codex_profile();
        let warning = p
            .category("main_config")
            .and_then(|c| c.pack_warning.as_deref())
            .expect("main_config 必须携带 pack_warning");
        assert!(warning.contains("experimental_bearer_token"));
        // 其余类别无警告
        assert!(p.categories.iter().filter(|c| c.id != "main_config").all(|c| c.pack_warning.is_none()));
    }

    /// 关键策略定性：主配置与会话索引需路径适配，两个 SQLite 库走 wal 阻断。
    #[test]
    fn codex_key_strategies() {
        let p = codex_profile();
        let get = |id: &str| p.category(id).unwrap();
        assert!(matches!(get("main_config").strategy, CategoryStrategy::CopyTextNeedsPathAdapt));
        assert!(matches!(get("session_index").strategy, CategoryStrategy::CopyTextNeedsPathAdapt));
        assert!(matches!(get("plugins_sources").strategy, CategoryStrategy::CopyTextNeedsPathAdapt));
        assert!(matches!(get("memories_db").strategy, CategoryStrategy::SqliteDb));
        assert!(matches!(get("goals_db").strategy, CategoryStrategy::SqliteDb));
        assert!(matches!(get("credentials").strategy, CategoryStrategy::Excluded));
        assert!(matches!(get("caches").strategy, CategoryStrategy::Excluded));
    }
}
