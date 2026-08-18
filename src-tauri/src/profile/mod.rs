//! 资产档案（profile）：数据驱动地描述一个 agent 软件的资产布局。
//! 档案 = 软件 → 资产类别 → 路径规则 → 处理策略；新增软件只需新增档案文件，
//! 引擎（scanner/packer/applier/pathfix）一律面向本模块的类型编程。

pub mod claude;
pub mod codex;
pub mod zcode;

use serde::{Deserialize, Serialize};

/// 类别处理策略：决定扫描与打包行为。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "detail")]
pub enum CategoryStrategy {
    /// 纯复制，无适配（skills、记忆等）。
    Copy,
    /// 文本配置：复制 + 解包时进入路径适配流程（如 cli/config.json）。
    CopyTextNeedsPathAdapt,
    /// SQLite 库：打包前检测同目录 `-wal`/`-shm`，存在则阻断该类别。
    SqliteDb,
    /// 排除：永不入包，扫描只做存在性与体量统计（缓存、凭据等）。
    Excluded,
}

/// 路径规则：档案根下的定位方式。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum PathRule {
    /// 单个文件。
    File { rel: String },
    /// 目录（递归收集）。
    Dir { rel: String },
    /// 多个路径（文件或目录混合）。
    Many { rels: Vec<String> },
}

/// 预置档位归属：推荐（纯资产）/ 完整（含会话历史）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresetTier {
    /// 推荐档：纯资产，约 1MB 量级。
    Recommended,
    /// 完整档：纯资产 + 会话历史库 + 工件。
    Full,
}

/// 一类资产（归集与勾选的单位）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetCategory {
    /// 稳定标识（如 "skills"），manifest 与 UI 依赖。
    pub id: String,
    /// 中文展示名。
    pub display_name: String,
    /// 一句话说明（UI 展示）。
    pub description: String,
    /// 档位归属。
    pub tier: PresetTier,
    /// 处理策略。
    pub strategy: CategoryStrategy,
    /// 路径规则（相对档案根）。
    pub rule: PathRule,
    /// 该类别入包时必须写入 manifest.warnings 的具体警告（如"含 API token"）；
    /// 打包确认页与 manifest 同源展示同一字符串。None = 无警告（经决策者授权的
    /// packer 增量例外：文案沉在档案数据里，不硬编码进引擎或前端）。
    #[serde(default)]
    pub pack_warning: Option<String>,
}

/// 一个 agent 软件的资产档案。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    /// 稳定标识（如 "zcode"）。
    pub id: String,
    pub display_name: String,
    /// 档案版本（写入 manifest，用于兼容判断）。
    pub version: u32,
    pub categories: Vec<AssetCategory>,
}

impl Profile {
    /// 按类别 id 查找。
    pub fn category(&self, id: &str) -> Option<&AssetCategory> {
        self.categories.iter().find(|c| c.id == id)
    }

    /// 该档案根目录在本机的默认位置（home 下的软件目录）。
    pub fn default_root(&self) -> std::path::PathBuf {
        home_dir().join(self.home_dir_name())
    }

    /// 档案对应的家目录子目录名（各档案自带）。
    fn home_dir_name(&self) -> &str {
        match self.id.as_str() {
            "zcode" => ".zcode",
            "codex" => ".codex",
            "claude" => ".claude",
            other => other,
        }
    }
}

/// 用户家目录：Windows 优先 `USERPROFILE`，其余平台 `HOME`；取不到为空路径。
/// 家目录取值口径的唯一实现（档案默认根、设置默认输出目录共用）。
pub fn home_dir() -> std::path::PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
        .unwrap_or_default()
}

/// 打包档位选择。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Preset {
    /// 推荐（纯资产）。
    Recommended,
    /// 完整（含会话历史）。
    Full,
    /// 自定义（类别 id 列表）。
    Custom(Vec<String>),
}

/// 解析档位为类别 id 集合（保持档案内顺序）。
pub fn category_ids_for_preset(profile: &Profile, preset: &Preset) -> Vec<String> {
    match preset {
        Preset::Recommended => profile
            .categories
            .iter()
            .filter(|c| c.tier == PresetTier::Recommended && c.strategy != CategoryStrategy::Excluded)
            .map(|c| c.id.clone())
            .collect(),
        Preset::Full => profile
            .categories
            .iter()
            .filter(|c| c.strategy != CategoryStrategy::Excluded)
            .map(|c| c.id.clone())
            .collect(),
        Preset::Custom(ids) => profile
            .categories
            .iter()
            .filter(|c| ids.contains(&c.id) && c.strategy != CategoryStrategy::Excluded)
            .map(|c| c.id.clone())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 档位解析：推荐档只含纯资产，完整档排除 Excluded 类别。
    #[test]
    fn profile_preset_filters_categories() {
        let profile = zcode::zcode_profile();
        let rec = category_ids_for_preset(&profile, &Preset::Recommended);
        assert!(rec.contains(&"skills".into()));
        assert!(!rec.contains(&"session_db".into()));
        // 排除项（凭据/缓存）不得混入任何档位
        assert!(!rec.contains(&"credentials".into()));
        assert!(!rec.contains(&"caches".into()));

        let full = category_ids_for_preset(&profile, &Preset::Full);
        assert!(full.contains(&"session_db".into()));
        assert!(!full.contains(&"credentials".into()));
        assert!(!full.contains(&"caches".into()));

        // 自定义档请求排除类别时被过滤掉
        let custom = category_ids_for_preset(
            &profile,
            &Preset::Custom(vec!["skills".into(), "credentials".into()]),
        );
        assert_eq!(custom, vec!["skills".to_string()]);
    }
}
