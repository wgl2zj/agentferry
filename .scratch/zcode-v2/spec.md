# Spec：ZCode 档案 v2 与产品收窄（专注 ZCode 配置备份/转移）

- 日期：2026-10-13
- 状态：已实施（2026-10-13 用户确认接受；2026-10-14 三票实施完成——01 档案v2 提交 bf42b79、02 仅ZCode收窄+旧包兼容 98a5e3c、03 定位与复勘文档 24015b7，经三路审查与管理员终裁合并；全量回归由用户决定）
- 调研依据：ZCode 官方开源仓库 zai-org/ZCode 的存储目录清单（packages/services/src/storage/domain/storageCatalog.ts，单一事实源）与官方 Configuration Reference；本机 `~/.zcode/` 2026-10-13 只读复勘
- 上游文档：`ZCode迁移可行性研究.md`（本轮将追加复勘章节）；v1 基线 spec：`../agentferry/spec.md`（保持原样，仅加历史标注）

## Problem Statement

用户想把一台机器上的 ZCode 完整搬到新机器：技能、记忆、钩子、MCP、模型服务商、应用设置、机器人配置等"功能与配置"开箱即用。现状有三层问题：

1. **覆盖缺口**：档案 v1 定稿于 2026-08-17，此后 ZCode 多轮更新（现已开源）新增了一批用户资产——记忆钩子配置（hooks.json）、用户级 MCP 配置（mcp.json）、应用设置（v2/setting.json）、自定义模型服务商配置（内嵌明文密钥）、机器人配置、代理启用状态、OpenViking 接入配置、用户自建脚本、插件状态文件。这些都不在档案里，新机会"缺功能"。
2. **分类过时**：ZCode 官方已把 `v2/checkpoints`（约 1GB）归类为会话存储而非缓存；会话可视化产物（v2/visualizations）也是对话的一部分。它们当前被当缓存排除，与"对话可作为可选项迁移"的产品目标不符。
3. **定位发散**：产品同时维护 zcode/codex/claude 三套档案，与"专注 ZCode 配置备份与转移"的定位不符。

## Solution

AgentFerry 收窄为 **ZCode 配置备份与转移工具**：老机器把 ZCode 个人资产备份成 `.zam` 迁移包，新机器解包后**完整复刻 ZCode 的功能与配置**（对话/会话历史默认不打包，作为完整档可选）。为此：

- ZCode 档案从 v1（15 类别）升级到 v2（26 类别），以 ZCode 官方源码的目录分类为权威依据；
- codex/claude 档案从产品入口移除（其档案定义保留，已打出的旧包仍可解包）；
- 文档层同步改写定位，并把"复刻边界"（需要新机另行完成的事）如实写清。

## User Stories

1. 作为换机的 ZCode 用户，我想在打包向导里只看到 ZCode 一个档案，这样软件聚焦做一件事、不让我做无关选择。
2. 作为换机的 ZCode 用户，我想让"推荐档"自动包含全部复刻必需的配置（全局规则、技能、命令、子代理、记忆、CLI 主配置、v2 配置、插件清单、记忆钩子、MCP、应用设置、模型服务商、机器人、代理状态、OpenViking 接入、自建脚本、插件状态），这样新机器解包后 ZCode 的功能和老机器一样。
3. 作为换机的 ZCode 用户，当配置里嵌着明文凭据（模型服务商 API key、OpenViking userKey）时，我想在打包和确认页看到点名具体字段的警告，这样我知道包里带着敏感信息、由我决定是否继续。
4. 作为换机的 ZCode 用户，我想让含本机绝对路径的新配置（钩子、应用设置、模型服务商配置）被标记"需要路径适配"，这样新机解包时能逐条确认替换、不会带着旧机路径失效。
5. 作为换机的 ZCode 用户，我想让检查点（checkpoints）和会话可视化产物随"完整档"作为对话可选项迁移，这样选了完整档就能连对话现场一起带走，不选则包很小。
6. 作为换机的 ZCode 用户，我想让运行痕迹（子代理执行现场、默认工作区草稿、执行缓存、网络 CA 私钥、各类状态/缓存 json）留在包外，这样包不被无用大体量数据污染、敏感密钥材料不外带。
7. 作为已用过旧版本的用户，我想让以前打出的 codex/claude 迁移包仍能正常解包，这样历史包不作废。
8. 作为换机的 ZCode 用户，我想在文档里看到诚实的"复刻边界"清单（OpenViking 本体需另装、钩子新机可能需一次信任确认、登录凭据需重登、自定义数据目录用户需改目标根），这样我知道哪些事要自己在新机上做。
9. 作为维护者，我想让档案的每个类别都能指出 ZCode 官方源码或本机实测的定性依据，这样下次 ZCode 更新时能快速复勘。

## Implementation Decisions

1. **产品收窄**：档案注册中心只注册 zcode；打包向导自然只出现 ZCode。codex/claude 档案定义文件保留（数据模块、零维护成本），仅供旧迁移包解包时的目标根推导使用，不暴露任何打包入口。
2. **档案版本**：Profile 版本号 1→2；`.zam` 包清单格式版本（format_version）不变，新旧包互相兼容。
3. **v2 类别清单（26 类）**——定性依据为 ZCode 官方存储目录清单（config=不可清理的用户配置 / sessionStore=会话存储 / runtimes=运行时 / toolOutputs·logs 等可清理）+ 本机实测：

   **推荐档（17 类）**：
   | 类别 | 内容 | 策略 |
   |---|---|---|
   | global_rules | 根目录 AGENTS.md | 复制 |
   | skills | skills/ | 复制 |
   | commands | commands/ | 复制 |
   | agent_defs | agents/ | 复制 |
   | memories | cli/memories/ | 复制 |
   | main_config | cli/config.json | 复制+路径适配 |
   | v2_config | v2/config.json | 复制+路径适配 |
   | plugin_manifests | cli/plugins/ 三个清单 json（installed_plugins、known_marketplaces、icon-sources） | 复制 |
   | hooks_config（新） | hooks.json（记忆钩子） | 复制+路径适配 |
   | mcp_config（新） | mcp.json（用户级 MCP） | 复制 |
   | app_settings（新） | v2/setting.json（应用设置） | 复制+路径适配 |
   | provider_config（新） | v2/provider_config.json（模型服务商，内嵌明文 apiKey） | 复制+路径适配+打包警告 |
   | bot_config（新） | v2/bot-config.v3.json 与 v2/bot-config.json | 复制 |
   | agents_state（新） | v2/agents-state.json（代理启用/模型覆盖） | 复制 |
   | openviking_state（新） | openviking/ 整目录（内嵌 userKey 凭据） | 复制+打包警告 |
   | user_scripts（新） | 根目录 vibe-autostart.cmd、register-vibe-autostart.ps1（用户自建） | 复制 |
   | plugin_state（新） | cli/plugins/data/ 与 cli/plugins/marketplaces/ | 复制 |

   **完整档（7 类，对话可选项）**：session_db、artifacts、rollout、tasks_index、v2_sessions（v1 原有）+ **checkpoints（由排除改入完整档，官方归类 sessionStore）** + **visualizations（新，会话可视化产物）**。

   **排除（2 类承载）**：credentials（登录凭据）不变；caches 的路径清单增补：cli/exec、cli/sessions、cli/pdf-cache、workspace、tmp、v2/agent-config、v2/repo-wiki、v2/runtime、v2/certs（自签网络 CA 私钥，安全材料不外带）、v2/bots-runtime-locks、v2 根下状态/缓存 json（coding-plan-cache、bots-model-cache、telemetry-state、onboarding-record、bot-state×2）、feedback、export-log-stage、plugin-workspace（v1 原有 7 项全保留）。

4. **凭据先例沿用**：provider_config 与 openviking_state 按 2026-08-17 已拍板的"凭据混配置照迁+具体警告"处理——警告串点名具体字段名（模型服务商配置的 access.apiKey 嵌套字段、openviking 配置的 userKey），经 packer 追加进包清单 warnings。
5. **不动引擎行为**：扫描/打包/解包/合并/路径适配的语义零变化；本 spec 只改"档案数据 + 注册中心 + 文档"。插件市场克隆（marketplaces/）照迁——体量小（约 8.7MB，2026-10-13 实测），符合"完美复刻"承诺。
6. **文档层**：README 与产品定位改写为"ZCode 配置备份与转移工具"；`ZCode迁移可行性研究.md` 追加 2026-10-13 复勘章节（含官方目录地图对照与会话库约 4.3GB 的体量提示）；功能地图更新档案条目；v1 spec 顶部加历史基线标注（不改正文）。

## Testing Decisions

全部走**既有测试缝隙（seams）**，零新增缝隙：

1. **档案注册与档位缝隙**：档案列表命令与预设过滤的既有 vitest（如 `commands_list_profiles_returns_full_category_table`、`profile_preset_filters_categories`）——断言更新为：注册中心仅返回 zcode、类别总数 26、新类别入选推荐档、caches 扩充仍被排除过滤。
2. **打包缝隙**：packer 既有假资产树测试——新类别文件入包；provider/openviking 的警告串进入包清单 warnings（沿用 `packer_pack_warnings_enter_manifest` 模式）；排除增补项物理不入包（沿用双重核验模式）。
3. **解包兼容缝隙**：目标根推导既有测试改造为"旧包兼容"回归——codex/claude 旧包仍能按包内档案推导目标根（档案定义保留的验收）。
4. **路径适配一致性缝隙**：既有的"路径适配类别 kind 必须为 text"遍历锁扩展覆盖新标记类别（hooks/app_settings/provider_config 均为 json，天然满足）。

反向测试沿用：源目录只读、排除项不入包、WAL 阻断，不因本轮改动弱化。

## Out of Scope

- 不做 codex/claude 的打包能力（注册与入口移除；解包兼容除外）。
- 不迁 `~/.agents/` 等跨 agent 生态兼容目录（用户已拍板不做跨 agent 兼容；本机实测该目录也为空）。
- 不迁 OpenViking 集成本体（`~/.openviking/` 在 ZCode 档案根之外）——文档如实声明"新机需另行安装，否则钩子报错"。
- 不自动信任钩子：ZCode 官方对钩子有摘要信任机制（安全设计），新机可能需一次信任确认（`zcode hooks trust`），工具只提醒不代办。
- 不迁登录凭据（v2/credentials.json）与网络 CA 私钥（v2/certs）。
- 对话迁移默认不选的定位不变（完整档可选项）；解包/合并/路径适配引擎行为零变化。
- 不处理 `dataBaseDir` 自定义数据目录的自动发现（解包向导已支持手改目标根；文档提示即可）。

## Further Notes

- 会话主库（cli/db/db.sqlite）自 8 月的 578MB 涨至约 4.3GB（2026-10-13 实测）：完整档选中该类别时体积与耗时会显著，属预期；打包向导既有体量展示已覆盖，无需新功能。
- v1 spec（`../agentferry/spec.md`）第四节的架构图仍是 Tauri 时代内容，本轮仅在顶部加历史标注，正文不改；其架构描述以功能地图与 README 现状为准。
- ZCode 官方目录清单里还有一批本机不存在的目录（cli/models、workflows、security、mailbox 等，多为新版本/特性目录）：本轮不入档（档案只收实测过的目录）；复勘章节记录官方全表，供下次 ZCode 更新后对照。
