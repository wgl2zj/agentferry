//! 资产扫描引擎：按档案盘点任意根目录，产出分类别报告。
//! 只读操作：不写入、不修改任何源文件；Excluded 类别只统计体量不读内容。

use crate::error::{AppError, AppResult};
use crate::profile::{CategoryStrategy, PathRule, Profile};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 文件种类（决定解包时的处理方式）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Text,
    Binary,
    Sqlite,
}

/// 单个扫描到的文件。Excluded 类别的 sha256 为空串（刻意不读内容）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedFile {
    /// 相对档案根的路径（统一使用 `/` 分隔，跨平台稳定）。
    pub rel_path: String,
    pub size: u64,
    pub sha256: String,
    pub kind: FileKind,
    /// 源文件物理绝对路径（链接场景与 root.join(rel_path) 不同，提权进程穿越
    /// junction 会被 Windows 拒绝 os error 448；仅当次会话内使用，不序列化）。
    #[serde(skip)]
    pub source_abs: PathBuf,
}

/// 类别状态。
/// serde 契约：tag 序列化为小写 ready/blocked/missing，前端按小写字面量判定
/// （曾因缺 rename_all 输出 "Ready" 大写，前端全部误判为本机不存在）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", content = "detail", rename_all = "snake_case")]
pub enum CategoryStatus {
    /// 可打包。
    Ready,
    /// 阻断（如 SQLite 检测到 WAL/SHM，源程序可能未退出）。
    /// 元组变体：detail 序列化为纯字符串，与前端 `{ status: "blocked"; detail: string }` 契约一致。
    Blocked(String),
    /// 档案声明了路径但目标不存在（合法：未用过该功能）。
    Missing,
}

/// 类别级盘点结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryReport {
    pub category_id: String,
    pub status: CategoryStatus,
    pub files: Vec<ScannedFile>,
    pub total_bytes: u64,
}

/// 档案级盘点结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanReport {
    pub profile_id: String,
    pub profile_version: u32,
    pub root: String,
    pub categories: Vec<CategoryReport>,
}

/// 按扩展名判定文件种类。
fn kind_of(rel_path: &str) -> FileKind {
    let lower = rel_path.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    match ext {
        "md" | "markdown" | "json" | "toml" | "yaml" | "yml" | "txt" | "csv" | "jsonl" => {
            FileKind::Text
        }
        "sqlite" | "sqlite3" | "db" | "db3" => FileKind::Sqlite,
        _ => FileKind::Binary,
    }
}

/// 流式计算文件 SHA-256（十六进制小写）。
fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// 把路径规则展开为绝对路径列表（保持档案声明顺序）。
fn expand_rule(root: &Path, rule: &PathRule) -> Vec<PathBuf> {
    match rule {
        PathRule::File { rel } => vec![root.join(rel)],
        PathRule::Dir { rel } => vec![root.join(rel)],
        PathRule::Many { rels } => rels.iter().map(|rel| root.join(rel)).collect(),
    }
}

/// 收集过程中的单个文件：abs 为物理绝对路径（读内容用），rel 为相对档案根的路径
/// （链接场景下两者不同：rel 记链接位置，abs 指向链接目标实体）。
struct Collected {
    abs: PathBuf,
    rel: PathBuf,
}

/// 解析链接目标并规范化为物理绝对路径（读 reparse 数据，不穿越链接——
/// 提升权限进程穿越 junction 会被 Windows 重定向信任缓解拒绝，os error 448）。
fn resolve_link_physically(link: &Path) -> AppResult<PathBuf> {
    let target = std::fs::read_link(link)?;
    let target = if target.is_absolute() {
        target
    } else {
        link.parent().unwrap_or_else(|| Path::new(".")).join(target)
    };
    Ok(std::fs::canonicalize(&target).unwrap_or(target))
}

/// 递归收集目录下的真实文件。
/// `dir` 与返回的 abs 全程使用物理路径，链接在枚举时被解析为目标物理路径后
/// 单独进入（见 resolve_link_physically）；`rel_prefix` 为当前层内容相对档案根的
/// 前缀（None 表示 dir 本身位于档案根下，rel 即真实路径）。
/// `link_ancestors` 记录当前递归链上展开过的链接物理目标：目标再次出现在链上
/// 即为真环，立即跳过；兄弟位置指向同一目标的多个链接各自完整收集。
fn walk_physical(
    dir: &Path,
    rel_prefix: Option<&Path>,
    link_ancestors: &mut Vec<PathBuf>,
    out: &mut Vec<Collected>,
) -> AppResult<()> {
    for entry in std::fs::read_dir(dir)? {
        // 遍历失败向上传播：目录读不了意味着盘点不完整，不能静默剔除
        let entry =
            entry.map_err(|e| AppError::Io(std::io::Error::other(format!("遍历失败：{e}"))))?;
        let ft = entry.file_type()?;
        let path = entry.path();
        let rel = match rel_prefix {
            Some(p) => p.join(entry.file_name()),
            None => path.clone(),
        };
        if ft.is_symlink() {
            let physical = resolve_link_physically(&path)?;
            if link_ancestors.iter().any(|a| a == &physical) {
                continue; // 链接环：链上已展开过同一物理目标
            }
            link_ancestors.push(physical.clone());
            let md = std::fs::metadata(&physical)?;
            if md.is_dir() {
                walk_physical(&physical, Some(&rel), link_ancestors, out)?;
            } else if md.is_file() {
                out.push(Collected { abs: physical, rel });
            }
            link_ancestors.pop();
        } else if ft.is_dir() {
            walk_physical(&path, Some(&rel), link_ancestors, out)?;
        } else if ft.is_file() {
            out.push(Collected { abs: path, rel });
        }
    }
    Ok(())
}

/// 收集一个路径（文件或目录，含符号链接/junction）下的全部文件为 ScannedFile。
/// 迁移语义：链接（如 skills → ~/.skills-manager 的外链技能）按目标真实内容入包，
/// 新机得到自包含副本；全程以物理路径访问，不受进程权限级别影响。
/// `with_hash=false` 用于 Excluded 类别（只统计，不读内容）。
fn collect_files(abs: &Path, root: &Path, with_hash: bool) -> AppResult<Vec<ScannedFile>> {
    let mut collected: Vec<Collected> = Vec::new();
    // 规则路径不存在是合法状态（Missing 类别），返回空；其余错误传播
    let ft = match abs.symlink_metadata() {
        Ok(md) => md.file_type(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    if ft.is_symlink() {
        let physical = resolve_link_physically(abs)?;
        let md = std::fs::metadata(&physical)?;
        if md.is_file() {
            collected.push(Collected { abs: physical, rel: abs.to_path_buf() });
        } else if md.is_dir() {
            let mut ancestors = vec![physical.clone()];
            walk_physical(&physical, Some(abs), &mut ancestors, &mut collected)?;
        }
    } else if ft.is_file() {
        collected.push(Collected { abs: abs.to_path_buf(), rel: abs.to_path_buf() });
    } else if ft.is_dir() {
        walk_physical(abs, None, &mut Vec::new(), &mut collected)?;
    }
    // 排序保证清单稳定（同目录内容不变时两次扫描结果一致）
    collected.sort_by(|a, b| a.rel.cmp(&b.rel));
    let mut out = Vec::with_capacity(collected.len());
    for c in collected {
        let rel = rel_string(&c.rel, root)?;
        let size = std::fs::metadata(&c.abs)?.len();
        let kind = kind_of(&rel);
        let sha = if with_hash { sha256_file(&c.abs)? } else { String::new() };
        out.push(ScannedFile { rel_path: rel, size, sha256: sha, kind, source_abs: c.abs });
    }
    Ok(out)
}

/// 相对路径统一为 `/` 分隔的字符串。
fn rel_string(abs: &Path, root: &Path) -> AppResult<String> {
    let rel = abs
        .strip_prefix(root)
        .map_err(|_| AppError::Internal(format!("路径越界：{abs:?} 不在 {root:?} 下")))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// 扫描单个类别。`with_hash=false` 时只收集路径/大小/种类不算哈希
/// （sha256 置空），供打包路径专用——哈希由写包时流式计算（见 packer::pack），
/// 避免同一文件读两遍；WAL/SHM 阻断检测不依赖哈希，行为不受开关影响。
fn scan_category(
    root: &Path,
    cat: &crate::profile::AssetCategory,
    with_hash: bool,
) -> AppResult<CategoryReport> {
    let targets = expand_rule(root, &cat.rule);

    match &cat.strategy {
        CategoryStrategy::Excluded => {
            // 只统计体量与存在性，绝不读内容（快且不碰敏感数据）
            let mut files = Vec::new();
            let mut total = 0u64;
            for t in &targets {
                if !t.exists() {
                    continue;
                }
                for f in collect_files(t, root, false)? {
                    total += f.size;
                    files.push(f);
                }
            }
            let status = if files.is_empty() {
                CategoryStatus::Missing
            } else {
                CategoryStatus::Ready
            };
            Ok(CategoryReport { category_id: cat.id.clone(), status, files, total_bytes: total })
        }
        CategoryStrategy::SqliteDb => {
            let mut files = Vec::new();
            let mut blocked: Option<String> = None;
            let mut total = 0u64;
            for t in &targets {
                if !t.exists() {
                    continue;
                }
                // WAL/SHM 检测：存在说明源程序可能未完全退出，库可能不一致
                let sidecars: Vec<String> = ["-wal", "-shm"]
                    .iter()
                    .filter_map(|sfx| {
                        let name = format!("{}{sfx}", t.file_name()?.to_string_lossy());
                        t.with_file_name(&name).exists().then(|| name)
                    })
                    .collect();
                if !sidecars.is_empty() {
                    blocked = Some(format!(
                        "检测到 {}，源程序可能未完全退出；请退出后重新检测，或跳过该类别",
                        sidecars.join(" 与 ")
                    ));
                }
                for f in collect_files(t, root, with_hash)? {
                    total += f.size;
                    files.push(f);
                }
            }
            let status = if let Some(reason) = blocked {
                CategoryStatus::Blocked(reason)
            } else if files.is_empty() {
                CategoryStatus::Missing
            } else {
                CategoryStatus::Ready
            };
            Ok(CategoryReport { category_id: cat.id.clone(), status, files, total_bytes: total })
        }
        _ => {
            let mut files = Vec::new();
            let mut total = 0u64;
            for t in &targets {
                for f in collect_files(t, root, with_hash)? {
                    total += f.size;
                    files.push(f);
                }
            }
            let status = if files.is_empty() {
                CategoryStatus::Missing
            } else {
                CategoryStatus::Ready
            };
            Ok(CategoryReport { category_id: cat.id.clone(), status, files, total_bytes: total })
        }
    }
}

/// 按档案扫描根目录，产出完整盘点报告。根目录必须存在。
/// UI 盘点页数据源：全部类别、含哈希（报告要展示完整性基线）。
pub fn scan(profile: &Profile, root: &Path) -> AppResult<ScanReport> {
    if !root.is_dir() {
        return Err(AppError::PathSetup(format!("扫描根目录不存在：{}", root.display())));
    }
    let mut categories = Vec::with_capacity(profile.categories.len());
    for cat in &profile.categories {
        categories.push(scan_category(root, cat, true)?);
    }
    Ok(ScanReport {
        profile_id: profile.id.clone(),
        profile_version: profile.version,
        root: root.to_string_lossy().to_string(),
        categories,
    })
}

/// 按档案扫描根目录的**指定类别**（打包路径专用）：未选中类别完全不
/// 触碰（枚举、元数据、内容读取都不发生），自定义小档打包不再为未选中的
/// 大会话库支付扫描成本；哈希一律不算（sha256 置空），由写包时流式计算
/// （见 packer::pack）。类别顺序按 category_ids，未知 id 报 InvalidPackage。
pub fn scan_selected(
    profile: &Profile,
    root: &Path,
    category_ids: &[String],
) -> AppResult<ScanReport> {
    if !root.is_dir() {
        return Err(AppError::PathSetup(format!("扫描根目录不存在：{}", root.display())));
    }
    let mut categories = Vec::with_capacity(category_ids.len());
    for id in category_ids {
        let cat = profile
            .category(id)
            .ok_or_else(|| AppError::InvalidPackage(format!("未知类别：{id}")))?;
        categories.push(scan_category(root, cat, false)?);
    }
    Ok(ScanReport {
        profile_id: profile.id.clone(),
        profile_version: profile.version,
        root: root.to_string_lossy().to_string(),
        categories,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::zcode::zcode_profile;
    use std::fs;
    use tempfile::TempDir;

    /// 前端契约锁定：跨 IPC 枚举必须序列化为前端类型镜像（src/lib/ipc.ts）里的小写字面量。
    /// 曾因 CategoryStatus 缺 rename_all 输出 "Ready" 大写，真实模式下前端全部误判
    /// 为"本机不存在"、文件数/体量全显示"—"（mock 层手写小写掩盖了漂移）。
    #[test]
    fn scanner_status_serialization_matches_frontend_contract() {
        assert_eq!(
            serde_json::to_value(CategoryStatus::Ready).unwrap(),
            serde_json::json!({"status": "ready"})
        );
        assert_eq!(
            serde_json::to_value(CategoryStatus::Blocked("原因".into())).unwrap(),
            serde_json::json!({"status": "blocked", "detail": "原因"})
        );
        assert_eq!(
            serde_json::to_value(CategoryStatus::Missing).unwrap(),
            serde_json::json!({"status": "missing"})
        );
        assert_eq!(serde_json::to_value(FileKind::Text).unwrap(), serde_json::json!("text"));
        assert_eq!(serde_json::to_value(FileKind::Binary).unwrap(), serde_json::json!("binary"));
        assert_eq!(serde_json::to_value(FileKind::Sqlite).unwrap(), serde_json::json!("sqlite"));
    }

    /// 构造假 ZCode 资产树：各类别齐备 + WAL 场景 + 排除项。
    fn make_fake_tree() -> TempDir {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("AGENTS.md"), "# 规则\n").unwrap();
        fs::create_dir_all(root.join("skills/animate")).unwrap();
        fs::write(root.join("skills/animate/SKILL.md"), "技能A".repeat(50)).unwrap();
        fs::create_dir_all(root.join("commands")).unwrap();
        fs::write(root.join("commands/bsfb.md"), "命令1").unwrap();
        fs::create_dir_all(root.join("agents")).unwrap();
        fs::write(root.join("agents/kimi-k3.md"), "子代理定义").unwrap();
        fs::create_dir_all(root.join("cli/memories/projects/p1")).unwrap();
        fs::write(root.join("cli/memories/projects/p1/MEMORY.md"), "记忆").unwrap();
        fs::write(root.join("cli/config.json"), r#"{"mcp":[{"cmd":"C:\\Users\\old\\py.exe"}]}"#).unwrap();
        fs::create_dir_all(root.join("v2")).unwrap();
        fs::write(root.join("v2/config.json"), "{}").unwrap();
        fs::create_dir_all(root.join("cli/plugins")).unwrap();
        fs::write(root.join("cli/plugins/installed_plugins.json"), "[]").unwrap();
        fs::write(root.join("cli/plugins/known_marketplaces.json"), "[]").unwrap();
        // 会话库 + WAL（触发阻断）
        fs::create_dir_all(root.join("cli/db")).unwrap();
        fs::write(root.join("cli/db/db.sqlite"), "sqlite-bytes-0123456789").unwrap();
        fs::write(root.join("cli/db/db.sqlite-wal"), "wal").unwrap();
        // 任务索引（无 WAL，Ready）
        fs::write(root.join("v2/tasks-index.sqlite"), "idx-bytes").unwrap();
        // 排除项
        fs::write(root.join("v2/credentials.json"), "enc:v1:xxx").unwrap();
        fs::create_dir_all(root.join("cli/log")).unwrap();
        fs::write(root.join("cli/log/run.log"), "日志".repeat(1000)).unwrap();
        dir
    }

    /// 盘点归类：文件数、类别、kind、阻断与排除行为全部正确。
    #[test]
    fn scanner_categorizes_fake_tree() {
        let dir = make_fake_tree();
        let report = scan(&zcode_profile(), dir.path()).unwrap();

        let get = |id: &str| {
            report
                .categories
                .iter()
                .find(|c| c.category_id == id)
                .unwrap_or_else(|| panic!("缺少类别 {id}"))
        };

        assert_eq!(get("skills").files.len(), 1);
        assert_eq!(get("skills").files[0].rel_path, "skills/animate/SKILL.md");
        assert_eq!(get("skills").files[0].kind, FileKind::Text);
        assert!(!get("skills").files[0].sha256.is_empty());

        // 插件清单 Many 规则收集 2 个文件
        assert_eq!(get("plugin_manifests").files.len(), 2);

        // config 归类为 Text
        assert_eq!(get("main_config").files[0].kind, FileKind::Text);

        // WAL 存在 → 会话库阻断
        match &get("session_db").status {
            CategoryStatus::Blocked(reason) => assert!(reason.contains("db.sqlite-wal")),
            other => panic!("session_db 应阻断，实际 {other:?}"),
        }
        // 任务索引无 WAL → Ready 且 kind=Sqlite
        assert!(matches!(get("tasks_index").status, CategoryStatus::Ready));
        assert_eq!(get("tasks_index").files[0].kind, FileKind::Sqlite);

        // 排除类别：不读内容（sha 为空）、不产生阻断
        let cred = get("credentials");
        assert_eq!(cred.files[0].sha256, "");
        assert!(matches!(cred.status, CategoryStatus::Ready));
        assert!(get("caches").total_bytes > 0);
    }

    /// 未使用的功能目录缺失是合法状态（Missing），不报错。
    #[test]
    fn scanner_missing_dir_is_not_error() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("AGENTS.md"), "仅规则").unwrap();
        let report = scan(&zcode_profile(), dir.path()).unwrap();
        let skills = report.categories.iter().find(|c| c.category_id == "skills").unwrap();
        assert!(matches!(skills.status, CategoryStatus::Missing));
    }

    /// 外链技能（目录链接指向档案根之外，如 ~/.skills-manager）必须跟随并收集真实内容。
    /// 真实事故（2026-08-17）：skills 下大量技能为符号链接，不跟随时全部被跳过，
    /// 迁移包技能不全；跟随方式必须是"读 reparse 数据 + 物理路径访问"（提升权限进程
    /// 穿越链接会被 Windows 拒绝，os error 448）。
    #[test]
    fn scanner_follows_symlinked_skill_dirs() {
        let external = TempDir::new().unwrap();
        let skill = external.path().join("linked-skill");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "外链技能内容").unwrap();

        let home = TempDir::new().unwrap();
        let root = home.path();
        fs::write(root.join("AGENTS.md"), "规则").unwrap();
        let link = root.join("skills").join("linked-skill");
        fs::create_dir_all(root.join("skills")).unwrap();
        #[cfg(windows)]
        junction::create(&skill, &link).unwrap();
        #[cfg(not(windows))]
        std::os::unix::fs::symlink(&skill, &link).unwrap();

        let report = scan(&zcode_profile(), root).unwrap();
        let skills = report
            .categories
            .iter()
            .find(|c| c.category_id == "skills")
            .unwrap();
        let rels: Vec<&str> = skills.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(
            rels.contains(&"skills/linked-skill/SKILL.md"),
            "外链技能丢失：{rels:?}"
        );
        let f = skills
            .files
            .iter()
            .find(|f| f.rel_path == "skills/linked-skill/SKILL.md")
            .unwrap();
        assert!(!f.sha256.is_empty(), "外链技能内容必须可读并计算哈希");
    }

    /// 链接环防护：真环（链接指回链上目标）不死循环；兄弟位置指向同一物理目标的
    /// 多个链接各自完整收集（防环只拦递归链上的重复，不误伤同名入口）。
    #[test]
    fn scanner_survives_link_cycles_and_sibling_links() {
        let home = TempDir::new().unwrap();
        let root = home.path();
        fs::write(root.join("AGENTS.md"), "规则").unwrap();
        let skills = root.join("skills");
        fs::create_dir_all(&skills).unwrap();
        let real = root.join("real-skill");
        fs::create_dir_all(&real).unwrap();
        fs::write(real.join("SKILL.md"), "真实内容").unwrap();

        // 兄弟链接：a 与 a2 指向同一物理目标 → 两个入口各收一份
        #[cfg(windows)]
        {
            junction::create(&real, skills.join("a")).unwrap();
            junction::create(&real, skills.join("a2")).unwrap();
            // 真环：real 内再放一个链接指回 real 自身（经 skills/a 亦可达同一物理目标）
            junction::create(&real, real.join("loop")).unwrap();
        }
        #[cfg(not(windows))]
        {
            std::os::unix::fs::symlink(&real, skills.join("a")).unwrap();
            std::os::unix::fs::symlink(&real, skills.join("a2")).unwrap();
            std::os::unix::fs::symlink(&real, real.join("loop")).unwrap();
        }

        let report = scan(&zcode_profile(), root).unwrap();
        let skills = report
            .categories
            .iter()
            .find(|c| c.category_id == "skills")
            .unwrap();
        let rels: Vec<&str> = skills.files.iter().map(|f| f.rel_path.as_str()).collect();
        assert!(rels.contains(&"skills/a/SKILL.md"), "兄弟链接 a 未收集：{rels:?}");
        assert!(rels.contains(&"skills/a2/SKILL.md"), "兄弟链接 a2 未收集：{rels:?}");
        // 环内的 loop 入口被链上拦截，不产生 a/loop/SKILL.md（递归进入 real 时 real 已在链上）
        assert!(
            !rels.iter().any(|r| r.starts_with("skills/a/loop/")),
            "环未被拦截：{rels:?}"
        );
    }

    /// 打包路径专用扫描行为锁（scan_selected）：只返回选中类别；哈希置空
    /// （延迟到写包时流式计算）；选中的 WAL 库阻断仍生效（sidecar 检测不依赖
    /// 哈希）；未知类别报 invalid_package。
    #[test]
    fn scanner_scan_selected_only_returns_selected_categories() {
        let dir = make_fake_tree();

        let report = scan_selected(&zcode_profile(), dir.path(), &["skills".to_string()]).unwrap();
        assert_eq!(report.categories.len(), 1);
        assert_eq!(report.categories[0].category_id, "skills");
        assert_eq!(report.categories[0].files.len(), 1);
        assert!(
            report.categories[0].files.iter().all(|f| f.sha256.is_empty()),
            "打包路径扫描不算哈希（写包时流式计算）"
        );

        let report2 =
            scan_selected(&zcode_profile(), dir.path(), &["session_db".to_string()]).unwrap();
        assert!(matches!(
            report2.categories[0].status,
            CategoryStatus::Blocked(_)
        ), "选中 WAL 库时阻断必须仍生效");

        let err = scan_selected(&zcode_profile(), dir.path(), &["no_such".to_string()]).unwrap_err();
        assert_eq!(err.code(), "invalid_package");
    }

    /// 根目录不存在时报路径错误。
    #[test]
    fn scanner_rejects_missing_root() {
        let err = scan(&zcode_profile(), Path::new("Z:/不存在/目录")).unwrap_err();
        assert_eq!(err.code(), "path_setup");
    }

    /// 扫描是只读的：前后目录内容与 mtime 不变。
    #[test]
    fn scanner_never_mutates_source() {
        let dir = make_fake_tree();
        let before = snapshot_tree(dir.path());
        scan(&zcode_profile(), dir.path()).unwrap();
        let after = snapshot_tree(dir.path());
        assert_eq!(before, after, "扫描不得修改源目录任何文件");
    }

    /// 递归快照（路径、大小、mtime）。
    fn snapshot_tree(root: &Path) -> Vec<(String, u64, std::time::SystemTime)> {
        let mut out = Vec::new();
        for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
            let e = entry.unwrap();
            if e.file_type().is_file() {
                let mtime = e.metadata().unwrap().modified().unwrap();
                out.push((
                    e.path().strip_prefix(root).unwrap().to_string_lossy().to_string(),
                    e.metadata().unwrap().len(),
                    mtime,
                ));
            }
        }
        out
    }

    /// 规模回归：文件数 ×10 时耗时增长不超过 ×15（哈希需读全文件，线性为下限；
    /// 本测试拦截的是超线性恶化，如每文件反复重扫目录）。
    #[test]
    fn scanner_scales_linearly_with_file_count() {
        let small = make_scale_tree(200);
        let (dur_small, files_small) = timed_scan(&small);
        let large = make_scale_tree(2000);
        let (dur_large, files_large) = timed_scan(&large);

        assert_eq!(files_small, 200);
        assert_eq!(files_large, 2000);
        let ratio_files = files_large as f64 / files_small as f64; // 10x
        let ratio_time = dur_large.as_millis() as f64 / dur_small.as_millis().max(1) as f64;
        assert!(
            ratio_time <= ratio_files * 1.5,
            "扫描耗时随文件数超线性恶化：{ratio_time:.1}x（文件 {ratio_files}x）"
        );
    }

    fn make_scale_tree(n: usize) -> TempDir {
        let dir = TempDir::new().unwrap();
        let skills = dir.path().join("skills");
        fs::create_dir_all(&skills).unwrap();
        for i in 0..n {
            let sub = skills.join(format!("s{i:04}"));
            fs::create_dir_all(&sub).unwrap();
            fs::write(sub.join("SKILL.md"), format!("技能内容 {i} ").repeat(20)).unwrap();
        }
        dir
    }

    fn timed_scan(dir: &TempDir) -> (std::time::Duration, usize) {
        let start = std::time::Instant::now();
        let report = scan(&zcode_profile(), dir.path()).unwrap();
        let files = report
            .categories
            .iter()
            .find(|c| c.category_id == "skills")
            .unwrap()
            .files
            .len();
        (start.elapsed(), files)
    }

    /// 档案数据驱动：注册第二个假档案即可扫描（架构扩展性）。
    #[test]
    fn scanner_supports_second_profile() {
        let fake = Profile {
            id: "fakeagent".into(),
            display_name: "假软件".into(),
            version: 1,
            categories: vec![crate::profile::AssetCategory {
                id: "rules".into(),
                display_name: "规则".into(),
                description: String::new(),
                tier: crate::profile::PresetTier::Recommended,
                strategy: CategoryStrategy::Copy,
                rule: PathRule::File { rel: "RULES.md".into() },
                pack_warning: None,
            }],
        };
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("RULES.md"), "规则内容").unwrap();
        let report = scan(&fake, dir.path()).unwrap();
        assert_eq!(report.profile_id, "fakeagent");
        assert_eq!(report.categories[0].files.len(), 1);
    }

    /// jsonl 判定为文本（经决策者授权的引擎例外 #2）：jsonl 是逐行 JSON 文本，
    /// 判 Binary 会让 CopyTextNeedsPathAdapt 类别（codex session_index.jsonl）的
    /// 路径适配静默失效——pathfix 只处理 kind=text 的文件。
    #[test]
    fn scanner_kind_of_treats_jsonl_as_text() {
        assert_eq!(kind_of("a/b/session_index.jsonl"), FileKind::Text);
        assert_eq!(kind_of("history.jsonl"), FileKind::Text);
        // 既有判定不变
        assert_eq!(kind_of("x.sqlite"), FileKind::Sqlite);
        assert_eq!(kind_of("x.exe"), FileKind::Binary);
    }

    /// 一致性锁（防"名义标路径适配、实际 kind 不匹配"的静默失效复发）：
    /// 遍历全部内置档案中 CopyTextNeedsPathAdapt 且路径规则为单文件的类别，
    /// 断言其扩展名被 kind_of 判为 Text（pathfix 的触发是"策略 + kind=text"双重门，
    /// scanner.rs/pathfix.rs:97）。
    /// 目录规则的类别（如 codex plugins_sources）含混合二进制，不适用本静态检查。
    #[test]
    fn scanner_path_adapt_file_categories_are_text_kind() {
        use crate::profile::codex::codex_profile;
        use crate::profile::{claude::claude_profile, CategoryStrategy, PathRule};
        for p in [zcode_profile(), codex_profile(), claude_profile()] {
            for c in &p.categories {
                if matches!(c.strategy, CategoryStrategy::CopyTextNeedsPathAdapt) {
                    if let PathRule::File { rel } = &c.rule {
                        assert_eq!(
                            kind_of(rel),
                            FileKind::Text,
                            "档案 {} 类别 {} 标注路径适配但 kind 非 Text，路径适配将静默失效",
                            p.id,
                            c.id
                        );
                    }
                }
            }
        }
    }

    /// 真实目录只读 smoke（本机装有 codex/claude 时才有意义；目录不存在则跳过）：
    /// 扫描成功、排除类别不读内容（无哈希）、SqliteDb 类别状态合法、
    /// skills 收集到外链技能实体。吸取教训：外链技能（→~/.skills-manager）必须完整收集。
    #[test]
    fn scanner_real_dir_smoke_codex_and_claude() {
        use crate::profile::codex::codex_profile;
        use crate::profile::claude::claude_profile;
        for (profile, dot_dir) in [(codex_profile(), ".codex"), (claude_profile(), ".claude")] {
            let root = crate::profile::home_dir().join(dot_dir);
            if !root.is_dir() {
                continue; // 未安装该软件的机器上跳过
            }
            let report = scan(&profile, &root).expect("真实目录扫描失败");
            let get = |id: &str| {
                report
                    .categories
                    .iter()
                    .find(|c| c.category_id == id)
                    .unwrap_or_else(|| panic!("{} 缺类别 {}", profile.id, id))
            };
            // 排除类别：凭据与缓存绝不读内容（sha256 全空）
            for excluded in ["credentials", "caches", "config"] {
                if profile.category(excluded).is_some() {
                    for f in &get(excluded).files {
                        assert_eq!(f.sha256, "", "{} 的 {} 不应计算哈希", profile.id, f.rel_path);
                    }
                }
            }
            // 推荐档核心类别在真实环境必须至少存在（本机实测有 AGENTS.md/settings 等）
            if profile.id == "codex" {
                assert!(matches!(get("main_config").status, CategoryStatus::Ready), "config.toml 必须存在");
                assert!(
                    matches!(get("memories_db").status, CategoryStatus::Ready | CategoryStatus::Blocked(_)),
                    "memories_1.sqlite 状态应可判定"
                );
                assert!(!get("skills").files.is_empty(), "skills 必须收集到技能（含外链）");
                assert!(
                    get("skills").files.iter().any(|f| f.rel_path.starts_with("skills/.system/")
                        || f.rel_path.contains("/SKILL.md")),
                    "外链技能应按实体收集"
                );
            }
            if profile.id == "claude" {
                assert!(matches!(get("settings").status, CategoryStatus::Ready), "settings.json 必须存在");
                assert!(!get("skills").files.is_empty(), "skills 必须收集到外链技能");
            }
        }
    }
}
