# FEATURE_MAP.md — 功能地图

> 细则文件。记录各功能模块的"行为预期"（该做什么，可验证）和"已知待修问题"（哪里与该做的不一致），用于发现"以为≠实际"的偏差、防止改 A 误伤 B。
> 维护纪律见 `AGENTS.md`「一点五、功能地图维护」；标记规则：只有【强制】、【应当】、【可选】决定优先级。

## 怎么用这份文档

- **只记变化慢的**：行为预期与待修问题入地图；实现细节（具体函数、字段名等会随代码天天改的东西）不入。
- **用前先核实**：把本地图当作判断依据前，必须回到代码核对当前行为，不得直接采信文字——发现对不上当场修正。
- **谁动谁核**：修改某模块代码前，先读该模块条目对照当前代码。

## 条目格式模板

每个功能模块一条，结构如下（各小节可按模块需要增删，但"行为预期"不可省）：

```markdown
## <模块名>

**主代码**：<主要源码文件路径>
**模型/数据**：<核心数据结构/清单格式>
**关联决策**：<相关 ADR / 版本记录>

### 一句话定位
<这个模块在系统里扮演什么角色，下游谁依赖它>

### 用户入口
| 入口 | 能做什么 |
|---|---|
| <页面/命令> | <能力> |

### 行为预期（可验证，已逐条核实代码）
1. **<预期 1>**：<该做什么，写到可核对程度，标注出处 file:line>。
2. **<预期 2>**：……

### 已知待修问题（发现但暂不动代码）
- **<编号>. <问题>**：<现象、影响、暂定对策；修复后改写为"已修复"并保留修复证据>

### 反直觉/易误解（踩坑预警）
- **<容易以为是 A、实际是 B 的点>**：<一句话说明>
```

## 行为预期的写作要求

- 每条预期**可验证**：能回答"怎么核对这条成立"（看哪个函数、跑哪个操作、观察什么）。
- 核实过代码的预期标注"已逐条核实代码"；凭印象写的必须回代码核实后再标注。
- 预期被测试锁住时，在条目里注明测试文件——预期未经测试锁住只有提醒作用，锁住才是机器保障。
- 模块对外行为改变时，同轮更新预期；发现代码与预期不符且属真 BUG 时，记入"已知待修问题"而非直接改预期迁就代码。

## 模块条目

> 五个核心模块已建立（2026-08-17）。测试锁定标注见各条；预期均经代码核实。

## 资产档案（profile）

**主代码**：`src-tauri/src/profile/mod.rs`、`src-tauri/src/profile/zcode.rs`、`src-tauri/src/profile/codex.rs`、`src-tauri/src/profile/claude.rs`
**模型/数据**：`Profile` → `AssetCategory`（id/tier/strategy/rule/pack_warning）→ `PathRule`（File/Dir/Many）
**关联决策**：spec 决策 2（数据驱动）；2026-08-17 决策（decide-k3）：凭据混配置照迁+具体警告、一档案一包、次要归档全量定性

### 一句话定位
描述"一个 agent 软件的资产长什么样"，scanner/packer/applier/pathfix 全部面向它编程；加新软件 = 加档案文件。

### 用户入口
| 入口 | 能做什么 |
|---|---|
| 前端打包向导① | 选择档案（zcode/codex/claude）、展示档案与默认根目录 |

### 行为预期（可验证，已逐条核实代码）
1. **档位解析**：Recommended 只含推荐档且过滤 Excluded；Full 含全部非排除；Custom 请求排除项被静默过滤（`category_ids_for_preset`，测试 `profile_preset_filters_categories` 锁定；codex/claude 各有同名档位测试）。
2. **排除类别**（凭据/缓存）tier 字段无意义，任何档位都不可选入包。
3. **三档案注册**（2026-08-17 起）：zcode（15 类别）/ codex（15）/ claude（10），`list_profiles` 返回 3 个（测试 `commands_list_profiles_returns_full_category_table` 锁定）；默认根映射 `~/.zcode`、`~/.codex`、`~/.claude`，解包目标按包内档案推导（测试 `commands_resolve_target_root_derives_codex_home` 锁定）。
4. **类别级打包警告 pack_warning**（经决策者授权的 packer 增量例外 #1）：codex main_config 与 claude settings 携带具体 token 字段名警告，packer 追加入 manifest.warnings（调用方警告在前）；前端确认页与 manifest 同源展示（list_profiles 同一字符串）。zcode 档案无该字段 → warnings 行为零变化（回归锁 `packer_zcode_warnings_unchanged_by_pack_warning`、`packer_pack_warnings_enter_manifest`、`packer_none_pack_warning_adds_nothing`）。

### Codex/Claude 档案关键定性（2026-08-17 实测勘察 + decide-k3 拍板）
- **照迁+警告**（决策 1-A）：codex `config.toml`（含 experimental_bearer_token）、claude `settings.json`（含 ANTHROPIC_AUTH_TOKEN）整体迁移，警告写明具体字段名；真登录凭据（codex auth.json、claude config.json 的 primaryApiKey）仍排除。
- **codex 排除**：750MB 级 logs_*.sqlite（+wal/shm）、plugins/.plugin-appserver（399M）、state_5.sqlite（运行状态）等 38 项；完整档含 sessions（345M）/archived_sessions/plugins_sources（路径适配）/session_index.jsonl（路径适配）等。
- **claude 限制记录**：家目录 `~/.claude.json` 位于档案根之外（99% 运行统计、无凭据键），v1 不迁不收（决策 4）；projects/ 子目录名编码旧机绝对路径，历史原样迁入不重挂，新机不自动关联（写入类别 description）。
- 两家 skills/ 均含指向 ~/.skills-manager 的外链技能，扫描跟随链接按实体收集（既有引擎能力）。

### 反直觉/易误解（踩坑预警）
- 曾有缺陷：Recommended 档过滤漏了 Excluded（credentials 的 tier 恰为 Recommended），导致打包报"排除项不得入包"。已修复并以测试锁定。
- jsonl 曾被 kind_of 判为 Binary（2026-08-17 修复，经决策者授权的引擎例外 #2）：会使 CopyTextNeedsPathAdapt 类别的路径适配静默失效（pathfix 只处理 kind=text，pathfix.rs 双重门）；现有一致性锁测试遍历三档案 File 规则的路径适配类别断言 kind=Text。

## 资产扫描（scanner）

**主代码**：`src-tauri/src/scanner.rs`
**模型/数据**：`ScanReport` → `CategoryReport`（status/files/total_bytes）→ `ScannedFile`（rel_path/size/sha256/kind）

### 一句话定位
按档案盘点根目录，产出分类别清单；packer 与 UI 盘点页的直接数据源。

### 用户入口
| 入口 | 能做什么 |
|---|---|
| 前端打包向导② | 盘点结果展示、WAL 阻断横幅 |

### 行为预期（可验证，已逐条核实代码）
1. **只读**：扫描不修改源目录任何文件的 mtime 与内容（测试 `scanner_never_mutates_source` 锁定）。
2. **跟随符号链接（物理路径方式）**：目录/文件链接（如 skills → ~/.skills-manager 的外链技能）按目标真实内容收集打包，新机得到自包含副本；跟随实现为"读 reparse 数据解析目标 + 全程物理路径访问"——不穿越链接（提升权限进程穿越 junction 会被 Windows 重定向信任缓解拒绝，os error 448，真实事故 2026-08-17）。真环（链上目标重复）跳过、兄弟链接同目标各自完整收集（测试 `scanner_follows_symlinked_skill_dirs`、`scanner_survives_link_cycles_and_sibling_links` 锁定）。
3. **WAL/SHM 阻断**：SQLite 类别同目录存在 `-wal`/`-shm` → `CategoryStatus::Blocked`（测试 `scanner_categorizes_fake_tree`）。
4. **排除项不哈希**：Excluded 类别只统计体量，sha256 为空（快且不碰敏感内容）。
5. **kind 判定**：扩展名 md/markdown/json/toml/yaml/yml/txt/csv/jsonl→text；sqlite/db→sqlite；其余 binary。jsonl 判 text 是引擎例外 #2（否则路径适配静默失效，见 profile 条目预警）。
6. **规模**：文件数 ×10 耗时增长 ≤ ×15（测试 `scanner_scales_linearly_with_file_count` 拦截超线性）。
7. **状态序列化契约**：CategoryStatus 序列化为小写 `ready`/`blocked`/`missing`，blocked 的 detail 为纯字符串；blocked 类别同样收集 files/total_bytes（测试 `scanner_status_serialization_matches_frontend_contract` 锁定，applier 侧 enum 同锁）。

### 反直觉/易误解（踩坑预警）
- 真实试用事故（2026-08-17 修复）：CategoryStatus 曾缺 serde `rename_all`，序列化出 `"Ready"` 大写，前端按小写判定 → 盘点表全显示"—"、自定义档全标"本机不存在"；浏览器演示层 mock 手写小写字符串掩盖了漂移，截图验收不暴露。教训：**mock 手写的枚举字面量必须与后端 serde 实测形态一致，跨 IPC 枚举要有序列化快照测试**（现已锁）。
- ZCode 的 skills/ 下大量技能是指向 ~/.skills-manager 的符号链接（.skills-manager 仓库本身不在档案覆盖范围）——迁移是否完整取决于扫描跟随链接（已锁定跟随）。

## 打包（packer）

**主代码**：`src-tauri/src/packer.rs`
**模型/数据**：`.zam`（ZIP）+ 包根 `manifest.json`（format_version=1、source.username、files[].sha256/kind/needs_path_adapt、warnings）

### 一句话定位
把选中类别压成单文件迁移包，manifest 是解包侧全部决策的依据。

### 用户入口
| 入口 | 能做什么 |
|---|---|
| 前端打包向导③④ | 档位选择、执行与报告 |

### 行为预期（可验证，已逐条核实代码）
1. **源目录只读**：打包前后源文件内容与 mtime 不变（测试 `packer_source_stays_untouched`）。
2. **读源用物理路径**：链接内文件（外链技能）按扫描携带的物理源路径读取入包，不走 root.join(rel) 穿越链接（提权进程被拒 448、is_file 误判"源文件消失"，真实事故 2026-08-17；测试 `packer_packs_linked_sources_via_physical_path` 锁定）。
3. **排除项不入包**：manifest 与 zip 物理条目均无凭据/缓存（测试 `packer_excluded_never_enters_package` 双重核验）。
4. **WAL 拒绝**：选中 Blocked 类别 → `SourceNotQuiet` 错误；跳过=不选它，警告写入 manifest.warnings。
5. **类别 pack_warning 入清单**（授权例外 #1）：选中携带 pack_warning 的类别时其确切字符串追加进 manifest.warnings（调用方警告在前）；None 零影响、zcode 行为不变（三道测试锁定，见 profile 条目）。
6. **哈希完整性**：包内文件读回哈希 == manifest 记录（测试 `packer_roundtrip_manifest_and_hashes`）。
7. **进度回调**：引擎回调次数 == 文件数（UI 进度条数据源）；Tauri 事件层经 `ProgressThrottle` 50ms 节流（首条与末条必发，进度条能启动并到 100%；测试 `progress_throttle_drops_close_events_but_keeps_first_and_last`）。
8. **只扫选中类别**（性能，2026-08-18）：打包内部经 `scanner::scan_selected` 只盘点选中类别——未选中类别零触碰（枚举/元数据/内容读取都不发生），自定义小档不为未选中大会话库付扫描成本；选中类别的 WAL 阻断仍生效（测试 `scanner_scan_selected_only_returns_selected_categories`、耗时锁 `packer_pack_time_ignores_unselected_categories`）。UI 盘点页的 `scan_assets` 仍是全类别含哈希（展示完整性基线），两者语义不同。
9. **哈希在写包时流式计算**（性能，2026-08-18）：扫描期不算哈希（sha256 置空），写 zip 时对所写内容边写边算——源文件只读一遍，且哈希即所写内容，无"清单与包内容不一致"窗口。
10. **SQLite 条目 Stored 存储**（decide-k3 拍板方案 B，2026-08-18）：`FileKind::Sqlite` 条目不压缩（Stored），其余 Deflated——sqlite 压缩率低且 deflate 是打包耗时大头；判定只走 FileKind 纯函数 `compression_for`，不加大小阈值；manifest 不加压缩方法字段，新旧包互兼容（测试 `packer_sqlite_stored_others_deflated`、`applier_reads_legacy_deflated_sqlite_package`）。包体积预期：sqlite 部分不再缩小，属预期非回归。

## 覆盖 apply（applier）

**主代码**：`src-tauri/src/applier.rs`
**模型/数据**：`ApplyPlan`（items[].action ∈ create/skip_same/replace/keep、plan_token、confirmed_overrides）→ `ApplyReport`

### 一句话定位
解包决策与执行的核心：dry-run 四组计划 → 用户确认（令牌）→ 备份+写入+逐文件复验。

### 用户入口
| 入口 | 能做什么 |
|---|---|
| 前端解包向导④⑤ | 四组确认、冲突逐条改判、执行报告 |
| 前端解包向导③ | 查看/修改/浏览选择恢复目标根目录（默认档案推导 ~/.zcode） |

### 行为预期（可验证，已逐条核实代码）
1. **目标根目录**：解包写入目标 = 显式 target_root（UI 默认按包内档案推导为本机资产目录 `~/.zcode`，可改可浏览选择）；计划携带 target_root，令牌校验纳入目标（篡改 plan.target_root → 执行拒绝，测试 `applier_rejects_tampered_target_root`）；不再写包旁目录（测试 `applier_executes_to_explicit_target_not_package_dir` 锁定）。真实试用事故（2026-08-17 修复）：曾固定写包旁 `<包名>-restored` 导致"解包成功但 ZCode 无变化"。
2. **dry-run 零写入**：plan_apply 不在目标写任何内容（测试 `applier_plan_only_writes_nothing`）。
3. **不删除**：执行前后目标原有文件集合不减（测试 `applier_execute_never_deletes_target_files`；覆盖/增量同规）。
4. **备份先于替换**：任何 Replace 前原文件已复制到 `zam-backups/<时间戳>/`，备份字节一致（测试 `applier_execute_overwrite_with_backup`）。
5. **双道令牌**：传入 items 摘要校验 + 独立重放校验，篡改计划/包被调包均拒绝（测试 `applier_rejects_tampered_plan_token`）。
6. **哈希复验**：写入后逐文件复验，不匹配立即停止（`HashMismatch`）。
7. **冲突语义**：覆盖=全 Replace；增量=默认 Keep、confirmed_overrides 内逐条 Replace。
8. **备份保留**：≥5 次时计划携带 backup_cleanup_hint 提示（不静默删）。
9. **zip-slip 防护**：target_rel 含 `..`、绝对路径、盘符 → 拒绝。
10. **路径适配目标一致**：detect/apply 命令的 target_root 与解包一致（同一目标树），缺省同按档案推导。
11. **校验归档只开一次**（性能，2026-08-18）：`open_package` 全程一个 `ZipArchive` 实例逐条目流式哈希（64KB 缓冲）——曾因每文件重开归档各自解析中央目录导致 O(N²)，且整块进内存令峰值内存=包内最大文件；耗时随条目数线性（测试 `applier_open_package_scales_linearly`）。

### 反直觉/易误解（踩坑预警）
- 曾有缺陷：令牌校验最初只比对"生成时快照"，传入 items 被篡改仍放行——被反向测试抓住后改为双道校验。改本模块时勿再弱化任一道。

## 路径替换（pathfix）

**主代码**：`src-tauri/src/pathfix.rs`
**模型/数据**：`DetectResult`（seeds：旧→新+命中数）→ `PathFixReport`（replaced/skipped/backup_dir）

### 一句话定位
新机适配：检出文本资产里的旧机绝对路径，按用户确认的映射替换。

### 用户入口
| 入口 | 能做什么 |
|---|---|
| 前端解包向导③ | 映射清单展示/编辑/逐条确认 |

### 行为预期（可验证，已逐条核实代码）
1. **范围**：仅 manifest 中 needs_path_adapt=true 且 kind=text 的文件。
2. **编码保持**：替换后无 BOM 引入（字节级断言，测试 `pathfix_replaces_and_preserves_utf8_no_bom`）；BOM/非 UTF-8 跳过并出警告、文件原样（测试 `pathfix_skips_bom_files`）。
3. **备份**：替换前备份到 `zam-backups/<时间戳>/pathfix/`。
4. **无变化不写回**：零命中的文件 mtime 不动。
5. **种子**：旧用户名 → 当前机用户名的五种书写形式（含 JSON 转义双反斜杠）；新旧同名时无种子。

## 应用设置（settings）

**主代码**：`src-tauri/src/commands.rs`（load/save_settings）、`src/lib/mock.ts`（pickDirectory）
**模型/数据**：`Settings { default_output_dir }`，存 `app_config_dir/settings.json`

### 一句话定位
迁移默认值的持久化；输出目录的默认值与选择入口。

### 用户入口
| 入口 | 能做什么 |
|---|---|
| 前端设置页 | 查看/修改/浏览选择默认输出目录并保存 |
| 前端打包向导③ | 输出路径预填默认目录，可弹窗改选 |
| 前端解包向导① | 迁移包路径可弹文件选择框选 .zam（选中不自动校验，仍需手动点「打开并校验」） |

### 行为预期（可验证，已逐条核实代码）
1. **首用默认**：无 settings.json 时，家目录下存在 `Downloads` 目录则作为默认输出目录，否则空（测试 `commands_default_output_dir_requires_existing_downloads` 锁定；不凭空造目录）。
2. **目录选择弹窗**：设置页与打包向导的「浏览…」弹系统目录选择框（tauri-plugin-dialog），取消不改动；选中后设置页直接回填、打包向导拼回建议文件名。解包向导第 1 步「浏览…」弹系统文件选择框（仅 .zam 过滤），取消不改动。浏览器演示模式无系统对话框，pickDirectory/pickPackage 返回演示路径。
3. **保存**：写入 app_config_dir/settings.json；打包向导输出路径用该目录预填（空目录时只预填文件名）。
