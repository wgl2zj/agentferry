//! Claude Code 内置档案：路径规则来自 2026-08-17 本机实测勘察。
//! 实测结论：核心配置 settings.json 的 env 含 ANTHROPIC_AUTH_TOKEN（用户自配中转
//! token，决策 1-A：照迁 + manifest 具体警告）；无 SQLite 库；家目录 ~/.claude.json
//! 为运行统计（99% 缓存、无凭据键）且位于档案根之外，v1 不迁不收（决策 4）；
//! projects/ 子目录名编码旧机绝对路径，按历史记录原样迁入不重挂。

use super::{AssetCategory, CategoryStrategy, PathRule, PresetTier, Profile};

/// 构造 Claude Code 档案（v1）。
pub fn claude_profile() -> Profile {
    Profile {
        id: "claude".into(),
        display_name: "Claude Code".into(),
        version: 1,
        categories: vec![
            // ---- 推荐档：纯资产 ----
            AssetCategory {
                id: "settings".into(),
                display_name: "核心设置（settings.json）".into(),
                description: "模型映射/代理地址/env，需路径适配".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::CopyTextNeedsPathAdapt,
                rule: PathRule::File {
                    rel: "settings.json".into(),
                },
                pack_warning: Some(
                    "本包含 API 凭据：settings.json 的 ANTHROPIC_AUTH_TOKEN 将随包迁移，请妥善保管迁移包".into(),
                ),
            },
            AssetCategory {
                id: "global_memory".into(),
                display_name: "全局记忆（CLAUDE.md）".into(),
                description: "跨项目生效的全局记忆文件（未创建过则本机不存在）".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::File {
                    rel: "CLAUDE.md".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "skills".into(),
                display_name: "技能（skills/）".into(),
                description: "已安装技能（外链技能按目标实体收集）".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "skills".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "plugins".into(),
                display_name: "插件（plugins/）".into(),
                description: "已安装插件本体与配置".into(),
                tier: PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "plugins".into(),
                },
                pack_warning: None,
            },
            // ---- 完整档：会话历史（历史记录保留旧机路径原样迁入） ----
            AssetCategory {
                id: "projects".into(),
                display_name: "项目会话（projects/）".into(),
                description: "按项目组织的会话 JSONL；子目录名编码旧机绝对路径，历史原样迁入、新机不自动关联".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "projects".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "sessions".into(),
                display_name: "会话数据（sessions/）".into(),
                description: "会话附属数据".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "sessions".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "history".into(),
                display_name: "命令历史（history.jsonl）".into(),
                description: "输入历史，历史记录原样迁入".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::File {
                    rel: "history.jsonl".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "file_history".into(),
                display_name: "文件修改历史（file-history/）".into(),
                description: "会话中文件修改的回滚历史".into(),
                tier: PresetTier::Full,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::Dir {
                    rel: "file-history".into(),
                },
                pack_warning: None,
            },
            // ---- 排除：永不入包 ----
            AssetCategory {
                id: "config".into(),
                display_name: "登录配置（config.json）".into(),
                description: "含 primaryApiKey 字段，新机由登录流程重写，不迁移".into(),
                tier: PresetTier::Recommended, // tier 无意义，策略为排除
                strategy: CategoryStrategy::Excluded,
                rule: PathRule::File {
                    rel: "config.json".into(),
                },
                pack_warning: None,
            },
            AssetCategory {
                id: "caches".into(),
                display_name: "运行缓存（缓存/遥测/快照等）".into(),
                description: "可再生运行态与遥测数据，全部可重建，不迁移".into(),
                tier: PresetTier::Recommended, // tier 无意义，策略为排除
                strategy: CategoryStrategy::Excluded,
                rule: PathRule::Many {
                    rels: vec![
                        "cache".into(),
                        "telemetry".into(),
                        "backups".into(),
                        "ide".into(),
                        "session-env".into(),
                        "shell-snapshots".into(),
                        ".clawhub".into(),
                        ".last-cleanup".into(),
                        ".update.lock".into(),
                        ".last-update-result.json".into(),
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
    fn claude_preset_filters_categories() {
        let p = claude_profile();
        let rec = category_ids_for_preset(&p, &Preset::Recommended);
        assert_eq!(rec, vec!["settings", "global_memory", "skills", "plugins"]);
        let full = category_ids_for_preset(&p, &Preset::Full);
        assert!(full.contains(&"projects".into()));
        assert!(full.contains(&"history".into()));
        assert!(!full.contains(&"config".into()));
        assert!(!full.contains(&"caches".into()));
        let custom = category_ids_for_preset(&p, &Preset::Custom(vec!["skills".into(), "config".into()]));
        assert_eq!(custom, vec!["skills".to_string()]);
    }

    /// 默认根目录映射到家目录下 .claude。
    #[test]
    fn claude_default_root_maps_to_dot_dir() {
        assert_eq!(claude_profile().default_root(), home_dir().join(".claude"));
    }

    /// token 警告沉在档案数据里：settings 携带具体字段名的警告（决策 1-A）。
    #[test]
    fn claude_settings_carries_token_warning() {
        let p = claude_profile();
        let warning = p
            .category("settings")
            .and_then(|c| c.pack_warning.as_deref())
            .expect("settings 必须携带 pack_warning");
        assert!(warning.contains("ANTHROPIC_AUTH_TOKEN"));
        assert!(p.categories.iter().filter(|c| c.id != "settings").all(|c| c.pack_warning.is_none()));
    }

    /// 关键策略定性：settings 需路径适配，凭据与缓存排除，无 SQLite 类别。
    #[test]
    fn claude_key_strategies() {
        let p = claude_profile();
        let get = |id: &str| p.category(id).unwrap();
        assert!(matches!(get("settings").strategy, CategoryStrategy::CopyTextNeedsPathAdapt));
        assert!(matches!(get("config").strategy, CategoryStrategy::Excluded));
        assert!(matches!(get("caches").strategy, CategoryStrategy::Excluded));
        assert!(!p.categories.iter().any(|c| matches!(c.strategy, CategoryStrategy::SqliteDb)));
    }
}
