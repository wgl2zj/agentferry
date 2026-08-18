# Spec：资产摆渡（AgentFerry）— agent 软件个人资产迁移工具

- 日期：2026-08-17
- 状态：已确认（决策由 decide 子智能体于 2026-08-17 做出，见"决策记录"节）
- 上游研究：`ZCode迁移可行性研究.md`（根目录）
- 决策记录全文：decide-k3 输出，9 项决策已固化到本 spec

## 一、问题

agent 软件（如 ZCode CLI）在使用过程中于用户家目录积累个人资产：记忆、MCP 配置、skills、子智能体定义、系统规则、自定义命令、插件清单等。换机时这些资产缺少搬运手段：手拷易漏、配置含本机绝对路径需适配、无完整性校验、不可再生缓存易被误搬（~3GB）。

## 二、产品定义

**资产摆渡（AgentFerry）**：Tauri v2 桌面应用（浅色系现代界面），提供两条主流程：

1. **打包**：扫描本机 agent 资产 → 按档位勾选 → 压缩为 `.zam` 迁移包（实质 ZIP + `manifest.json` 清单，含逐文件 SHA-256）。
2. **解包**：校验包 → 预览内容 → 选模式（覆盖/增量）→ dry-run 变更计划确认（四组动作）→ 执行（先备份）→ 逐文件哈希复验报告。

附加能力：新机路径适配（旧机绝对路径 → 用户逐条确认的替换映射，仅文本类，UTF-8 无 BOM 保持）。

## 三、决策记录（开发基线）

| # | 事项 | 决定 |
|---|---|---|
| 1 | Rust 工具链 | winget VS Build Tools + rustup MSVC stable；降级序：GNU 工具链 → 纯 Rust crate+CLI 先行 |
| 2 | v1 范围 | 仅内置 ZCode 档案；"资产档案（profile）"数据驱动（软件 → 类别 → 路径规则 → 处理策略），实测过的软件才入档 |
| 3 | 包格式 | `.zam`（实质 ZIP），根置 `manifest.json`：format_version/app_version/created_at/source{os,arch,hostname,username}/profile_id/preset/files[]{path,target_rel,category,sha256,size,kind:text\|binary\|sqlite,needs_path_adapt}/counts/total_bytes/warnings[] |
| 4 | 覆盖/增量语义 | 按内容 SHA-256 判同。新增：两模式都写入。一致：跳过。冲突（哈希不同）：覆盖=备份后替换；增量=默认保留目标、dry-run 中逐条/整组可改判为替换。包无目标有：保留不动。**两模式均不删目标任何文件；无镜像模式；任何替换前必备份**至 `<目标根>/zam-backups/<yyyyMMdd-HHmmss>/<原相对路径>`，保留最近 5 次，更老的提示清理（不静默删） |
| 5 | 路径替换 | 解包内置"路径适配"步骤：扫描 needs_path_adapt 且 kind=text 的文件，以 manifest source.username 等为种子检出旧机绝对路径，生成替换建议清单（旧串→建议新串预填），用户逐条确认/编辑后执行；仅文本类；含 BOM 或非 UTF-8 跳过并警告；替换文件同样走备份 |
| 6 | UI 形态 | 首页仪表盘（打包/解包两功能卡 + 最近任务）+ 打包向导 4 步（选档案→盘点→档位与输出→执行报告）+ 解包向导 6 步（选包校验→内容预览→恢复模式→dry-run 确认→执行与验证报告→路径适配；路径适配移至执行后，因替换作用于已解包目标树——2026-08-17 review 修正）+ 设置页（备份策略/默认输出/档案只读展示） |
| 7 | 档位 | 预设"推荐（纯资产 ~1MB）"默认 /"完整（含会话历史 ~850MB，含退出提示）"+ 自定义类别勾选 |
| 8 | SQLite | 同目录存在 -wal/-shm → 该库类别阻断，横幅提示"源程序可能未完全退出"；动作仅两个："我已退出，重新检测" / "跳过会话历史继续打包其余"（记入 warnings[]）；**无强制打包选项** |
| 9 | 命名 | 中文「资产摆渡」/ 英文 `AgentFerry` / 包扩展名 `.zam` |

## 四、架构

```
src-tauri/src/
  main.rs / lib.rs        — 入口，唯一 invoke_handler
  error.rs                — AppError（thiserror + Serialize）
  profile/mod.rs          — Profile 数据结构 + zcode.rs 内置档案（数据驱动）
  scanner.rs              — 按 profile 扫描盘点（类别→文件清单+体量+可迁移性+WAL检测）
  packer.rs               — 打包：zip + manifest.json + SHA-256，tokio spawn_blocking + 进度事件
  applier.rs              — 解包：读包校验 → dry-run 计划（四组）→ 确认后执行（备份+写入+复验）
  pathfix.rs              — 旧机路径检出 + 替换（UTF-8 无 BOM 保持）
  progress.rs             — 进度事件协议（emit 阶段/进度/警告）
src/                      — React + TS 前端
  styles/tokens.css       — 浅色系设计令牌（唯一来源）
  pages/ + components/    — 首页/打包向导/解包向导/设置 + 公共组件（Toast/确认对话框/进度/空状态）
  lib/ipc.ts              — 类型化 invoke 封装 + useBackendEvent Hook
```

后端引擎（profile/scanner/packer/applier/pathfix）为纯 Rust 模块，不依赖 Tauri 类型，可独立 cargo test；Tauri 命令层只做参数转发与事件桥接（决策 1 降级预案的架构保障）。

## 五、行为预期清单（可验证，逐条验收）

> 状态标注：待实现 / 已实现 / 已修复。实现后逐条更新并配测试锁住。

### 打包侧

1. 【已实现】扫描 `~/.zcode/` 按 ZCode 档案产出盘点（scanner.rs；`scanner_categorizes_fake_tree`、`scanner_supports_second_profile`）。
2. 【已实现】预置档位"推荐/完整/自定义"（profile/mod.rs `category_ids_for_preset`；`profile_preset_filters_categories`）。
3. 【已实现】WAL/SHM 阻断 + 重新检测/跳过两动作、无强制打包（scanner.rs 阻断、packer.rs `SourceNotQuiet` 拒绝；`packer_blocked_sqlite_rejected_and_skippable`；UI 横幅+双按钮见截图 af-03/04/04b）。
4. 【已实现】`.zam` 包 + manifest.json 全字段（packer.rs；`packer_roundtrip_manifest_and_hashes`）；源目录只读（`packer_source_stays_untouched`、`scanner_never_mutates_source`）。
5. 【已实现】缓存/凭据永不入包（`packer_excluded_never_enters_package` 物理遍历 zip 条目核验）。

### 解包侧

6. 【已实现】打开包先校验 manifest/格式版本/逐文件 SHA-256（applier.rs `open_package`；`applier_open_detects_tampered_entry`）。
7. 【已实现】dry-run 四组计划 + 增量冲突默认保留、逐条/整组改判（`applier_plan_groups_four_actions`；未确认零写入反向测试 `applier_plan_only_writes_nothing`；UI 改判见截图 af-13/14）。
8. 【已实现】替换前备份至 `zam-backups/<时间戳>/`、执行后逐文件复验（`applier_execute_overwrite_with_backup`）；保留最近 5 次超限提示（`check_backup_retention` → backup_cleanup_hint）。
9. 【已实现】两模式均不删目标文件（`applier_execute_never_deletes_target_files`）。
10. 【已实现】路径适配建议清单 + 用户确认 + UTF-8 无 BOM 保持（`pathfix_detects_old_machine_paths`、`pathfix_replaces_and_preserves_utf8_no_bom`、`pathfix_skips_bom_files`）。

### 界面侧（浅色系、现代、便捷）

11. 【已实现】四页结构（首页/打包向导 4 步/解包向导 6 步/设置），每页一个 h1（KIMI-K3 两轮共 46 张截图验收逐页核实）。
12. 【已实现】令牌唯一来源 tokens.css，无内联色值（`tokens.test.ts` 守护 + 截图核对）。
13. 【已实现】长任务真实进度（阶段+current/total）、加载态（截图 af-06c 实拍进度态）。
14. 【已实现】高风险动作统一确认对话框（对象/影响/后果）、无原生弹窗（截图 af-11/15；组件测试覆盖确认前不执行）。
15. 【已实现】消息四通道归类正确、WAL 阻断走横幅（截图 af-03/12/13）。
16. 【已实现】焦点可见、弹窗焦点管理、图标 aria、状态文字+图标+颜色三重表达（截图 af-23 焦点环实测）。

## 六、非目标（v1 明确不做）

- 不支持 ZCode 以外软件的实际迁移（架构预留 profile 扩展点）。
- 不迁移登录凭据（`enc:v1:` 绑定本机，新机重登）。
- 不迁移可再生缓存（~3GB）。
- 无镜像/删除目标文件模式。
- 不做跨平台（macOS/Linux）构建产物（三平台路径处理代码层面兼容即可）。
- 不自动替换路径（必须用户确认）。
- 不提供 SQLite 带 WAL/SHM 的强制打包选项（仅"重新检测/跳过该库"两个动作，决策 8 红线）。

## 七、验收与测试策略

- 引擎层（scanner/packer/applier/pathfix）：cargo test 单元+集成测试，全部用临时目录构造假资产树（**不触碰真实 `~/.zcode/`**）。
- 反向测试：源目录只读、未确认不写入、不删目标文件、无 BOM 引入、缓存不入包，各至少一条。
- 编码保持测试：UTF-8 无 BOM 文本改写后字节级校验。
- 前端：vitest 组件测试 + E2E 标记测试（默认跳过、显式开启）。
- 规模回归：哈希/扫描路径用大文件集断言不随文件数线性恶化。
