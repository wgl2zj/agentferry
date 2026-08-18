//! 全链路集成测试：假资产树 → 打包 → 模拟换机（目标已有部分文件）→
//! 增量/覆盖解包 → 路径适配 → 断言每一步的安全铁律。全程临时目录，不触碰真实家目录。

use agentferry_lib::applier::{self, ApplyMode};
use agentferry_lib::packer;
use agentferry_lib::pathfix;
use agentferry_lib::profile::{category_ids_for_preset, zcode::zcode_profile, Preset};
use std::fs;
use tempfile::TempDir;

/// 打包→换机→增量解包→路径适配 的完整旅程。
#[test]
fn integration_pack_move_incremental_pathfix_journey() {
    // ---- 旧机：构造资产并打包（跳过带 WAL 的会话库，模拟用户选择）----
    let old_machine = TempDir::new().unwrap();
    let old_root = old_machine.path();
    fs::write(old_root.join("AGENTS.md"), "# 全局规则\n").unwrap();
    fs::create_dir_all(old_machine.path().join("skills/demo")).unwrap();
    fs::write(old_root.join("skills/demo/SKILL.md"), "技能").unwrap();
    fs::create_dir_all(old_root.join("cli")).unwrap();
    fs::write(
        old_root.join("cli/config.json"),
        r#"{"mcpCmd":"C:\\Users\\olduser\\AppData\\Python\\py.exe","home":"/Users/olduser/work"}"#,
    )
    .unwrap();
    fs::create_dir_all(old_root.join("cli/db")).unwrap();
    fs::write(old_root.join("cli/db/db.sqlite"), "会话库").unwrap();
    fs::write(old_root.join("cli/db/db.sqlite-wal"), "wal").unwrap();

    let profile = zcode_profile();
    let full_ids = category_ids_for_preset(&profile, &Preset::Full);
    let selected: Vec<String> = full_ids.into_iter().filter(|id| id != "session_db").collect();
    let pkg = old_root.join("ferry/换机包.zam");
    let warnings = vec!["会话历史库检测到 WAL，用户选择跳过".to_string()];
    let pack_result = packer::pack(&profile, old_root, &selected, "full", &pkg, warnings, &mut |_, _, _| {})
        .expect("打包失败");
    assert_eq!(pack_result.manifest.warnings.len(), 1);

    // ---- 新机：目标已有部分旧文件（含一个内容不同的冲突文件）----
    // 目标根 = 新机的 ZCode 资产目录（显式指定，模拟真实换机恢复到 ~/.zcode）
    let new_machine = TempDir::new().unwrap();
    let pkg2 = new_machine.path().join("换机包.zam");
    fs::copy(&pkg, &pkg2).unwrap();
    let restored = new_machine.path().join(".zcode");
    fs::create_dir_all(restored.join("cli")).unwrap();
    fs::write(restored.join("AGENTS.md"), "# 新机自己攒的规则").unwrap(); // 冲突
    fs::write(restored.join("cli/config.json"), r#"{"mcpCmd":"D:\\new\\py.exe"}"#).unwrap(); // 冲突
    fs::write(restored.join("cli/新机独有.md"), "保留").unwrap();

    // ---- 打开校验 → 增量计划 → 执行 ----
    let manifest = applier::open_package(&pkg2, &mut |_, _, _| {}).expect("包校验失败");
    let mut overrides = vec!["cli/config.json".to_string()]; // 用户改判：config 用包里的
    let mut plan = applier::make_plan(&pkg2, &manifest, &restored, ApplyMode::Incremental, &overrides).unwrap();
    // 冲突分组正确
    let get = |rel: &str| plan.items.iter().find(|i| i.target_rel == rel).unwrap();
    assert!(matches!(get("AGENTS.md").action, applier::ActionKind::Keep)); // 未改判 → 保留新机
    assert!(matches!(get("cli/config.json").action, applier::ActionKind::Replace)); // 改判 → 替换
    assert!(matches!(get("skills/demo/SKILL.md").action, applier::ActionKind::Create));

    // 执行（confirmed_overrides 已由 make_plan 存入计划）
    let report = applier::execute_apply_to(&plan, &restored, &mut |_, _, _| {}).expect("执行失败");
    // 新机独有文件仍在；未改判冲突保留新机内容
    assert_eq!(fs::read_to_string(restored.join("AGENTS.md")).unwrap(), "# 新机自己攒的规则");
    assert!(restored.join("cli/新机独有.md").is_file());
    // 改判冲突已被包内容替换，且原内容已备份
    assert!(fs::read_to_string(restored.join("cli/config.json")).unwrap().contains("olduser"));
    let backup_dir = PathBuf::from(report.backup_dir.expect("应有备份"));
    assert!(backup_dir.join("cli/config.json").is_file());
    // 已核对文件数 = 非保留项（Keep 是明确保留目标，无写入与复验动作）
    let non_keep = plan.items.iter().filter(|i| i.action != applier::ActionKind::Keep).count();
    assert_eq!(report.verified_files, non_keep);

    // ---- 路径适配：检出旧机路径并替换 ----
    let mut manifest2 = manifest.clone();
    manifest2.source.username = "olduser".into();
    let det = pathfix::detect(&restored, &manifest2).unwrap();
    assert!(det.seeds.iter().map(|s| s.total_hits).sum::<usize>() >= 2);
    let mappings: Vec<(String, String)> = det.seeds.iter().map(|s| (s.old.clone(), s.new.clone())).collect();
    let fix_report = pathfix::apply_mappings(&restored, &manifest2, &mappings, true).unwrap();
    assert_eq!(fix_report.replaced.len(), 1);
    let now = fs::read(restored.join("cli/config.json")).unwrap();
    assert!(!now.starts_with(&[0xEF, 0xBB, 0xBF]), "不得引入 BOM");
    let text = String::from_utf8(now).unwrap();
    assert!(!text.contains("olduser"), "旧用户名应全部替换：{text}");
}

use std::path::PathBuf;

/// 覆盖模式旅程：全部冲突备份后替换，目标独有文件依旧保留。
#[test]
fn integration_pack_move_overwrite_journey() {
    let old_machine = TempDir::new().unwrap();
    let old_root = old_machine.path();
    fs::write(old_root.join("AGENTS.md"), "规则A").unwrap();
    let profile = zcode_profile();
    let ids = category_ids_for_preset(&profile, &Preset::Recommended);
    let pkg = old_root.join("包.zam");
    packer::pack(&profile, old_root, &ids, "recommended", &pkg, vec![], &mut |_, _, _| {}).unwrap();

    let new_machine = TempDir::new().unwrap();
    let pkg2 = new_machine.path().join("包.zam");
    fs::copy(&pkg, &pkg2).unwrap();
    let restored = new_machine.path().join(".zcode");
    fs::create_dir_all(&restored).unwrap();
    fs::write(restored.join("AGENTS.md"), "新机旧规则").unwrap();
    fs::write(restored.join("独有.txt"), "独有内容").unwrap();

    let manifest = applier::open_package(&pkg2, &mut |_, _, _| {}).unwrap();
    let plan = applier::make_plan(&pkg2, &manifest, &restored, ApplyMode::Overwrite, &[]).unwrap();
    let report = applier::execute_apply_to(&plan, &restored, &mut |_, _, _| {}).unwrap();

    assert_eq!(fs::read_to_string(restored.join("AGENTS.md")).unwrap(), "规则A");
    assert!(restored.join("独有.txt").is_file(), "覆盖模式同样不得删除目标独有文件");
    let backup_dir = PathBuf::from(report.backup_dir.unwrap());
    assert_eq!(fs::read_to_string(backup_dir.join("AGENTS.md")).unwrap(), "新机旧规则");
}
