# 01 — ZCode 档案升级 v2（26 类别）

**What to build:** 打包向导里 ZCode 的"推荐档"自动包含全部复刻必需配置：全局规则、技能、命令、子代理、记忆、CLI 主配置、v2 配置、插件清单（含图标来源）、记忆钩子配置、用户级 MCP、应用设置、模型服务商配置、机器人配置、代理状态、OpenViking 接入、用户自建自启脚本、插件状态（数据与市场克隆）。两类内嵌明文凭据的配置（模型服务商的 access.apiKey 嵌套字段、OpenViking 配置的 userKey）在打包与解包确认页出现点名具体字段的警告。检查点与会话可视化改为"完整档"成员（随对话可选项迁移）。扩充的运行痕迹（子代理执行现场、默认工作区、执行缓存、网络 CA 私钥、各类状态/缓存文件等）永不入包。含本机绝对路径的三类新配置（钩子、应用设置、模型服务商）标记"需要路径适配"。本工单不改档案注册范围（收窄在 02 做）。

**Blocked by:** None — can start immediately

**Status:** resolved

- [x] 档案类别总数 26（推荐档 17、完整档 7、排除 2 类承载），类别清单与 spec「Implementation Decisions」第 3 条一致
- [x] 9 个新推荐类别（hooks/mcp/应用设置/服务商/机器人/代理状态/OpenViking/自建脚本/插件状态）各自走通"假资产树盘点 → 入包 → 逐文件哈希复验"
- [x] provider_config 与 openviking_state 的警告串进入包清单 warnings（调用方警告在前），串内点名具体凭据字段名；无这两个类别时行为零变化（回归锁）
- [x] hooks_config、app_settings、provider_config 标记需要路径适配，且"路径适配类别文件类型必须为 text"一致性遍历锁通过
- [x] checkpoints、visualizations 出现在完整档与自定义勾选列表中；默认推荐档不含它们
- [x] caches 增补路径：盘点只计体量不哈希内容、物理遍历包条目确认不入包
- [x] 源目录只读、WAL 阻断等既有反向测试不弱化，直接相关 vitest 全绿

## Comments

- 2026-10-13 工作流 run dwfrun-73cdf457（专票·工作流引擎）1 轮交付零阻塞，候选放行；管理员终裁**通过**，提交 bf42b79 合并回 main。
- 三路结论：路A（deepseek-v4.1-flash 异构）= advise 2 条；路B（GLM-5.3 独立会话·构造性验证）= pass；路C run 内命令失败（脚本 `--background` 中文参数被 shell 适配层按空格截断），终裁手动重跑结果见 QA 记录。
- 终裁裁定①：4 处既有测试名改动（packer 回归锁描述、profileContract 类别数 15→26、pack_warning 回归锁语义反转、PackWizard 推荐档断言）均因 v2 语义反转使旧断言必然失真，属合理偏离，保留；执行者回执只报 1 处、漏报 3 处，记为审计线索不实的流程瑕疵（不改代码）。
- 终裁裁定②：src/lib/mock.ts 演示数据 kind 与引擎判定不一致（checkpoints 的 .json 标 binary、openviking/ov-recall.mjs 标 text）——无行为影响、无测试锁定，挂账为已知小瑕疵，后续单独处理。
- 管理员终裁抽查：8 个直接相关测试文件 66 用例全绿（含 scanner/packer 规模回归锁、真实目录只读 smoke）；diff 敏感核对零真实凭据（仅 PLACEHOLDER 夹具与字段名断言）。
