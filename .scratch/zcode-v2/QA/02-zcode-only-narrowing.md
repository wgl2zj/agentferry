# QA 结论记录 — 02 产品收窄为仅 ZCode + 旧包兼容

- 梯队：2/3（Blocked by: 01，已终裁合并 bf42b79）
- 工作树：`D:/.tmp/zcoder-move-wt-20261013-233142` · 分支 `wt-aicode/main/20261013-233142` · 基线 853e492（main）
- 引擎与名册：工作流 run dwfrun-4d6eb3e9（2026-10-13 启动、跨日完成）；执行者 GLM-5.3（max）/ 路A deepseek-v4.1-flash（max，异构）/ 路B GLM-5.3 独立会话 / 路C ocr review（无 --background，修复 run1 教训后一次成功）
- 复制清单：node_modules（收尾删副本）
- 交付提交：98a5e3c（单提交，14 文件：注册中心/命令层/协议 6 个 electron 文件 + 前端与测试 8 个 src 文件，全在授权根内）

## 完成定义（方案断言，派发前固化——源自 ticket 02 与 spec Solution/Implementation Decisions 1）

正向断言：
- [x] 档案注册中心仅返回 zcode（list_profiles 断言 3→1）
- [x] codex/claude 档案定义保留在代码中（数据模块），打包入口、前端档案选择处均不出现
- [x] 旧包兼容回归：codex/claude 旧包分别推导各自目标根（推导测试改造为"旧包兼容"语义并保留 zcode 用例）
- [x] 前端档案枚举断言同步更新，直接相关 vitest 全绿（定向，禁全量）

禁用清单（方案纪律 2）：

| 旧入口/旧字段 | 方案要求 | 当前是否仍被写入 | 反向测试已加 |
|---|---|---|---|
| list_profiles 返回 codex/claude | 停用（仅返回 zcode） | 否 | [x] 断言仅 1 个档案 |
| 前端打包向导档案选择出现 codex/claude | 停用（只出现 ZCode） | 否 | [x] 前端测试断言"仅 ZCode 一家，codex/claude 不出现" |
| codex/claude 档案定义数据 | 显式保留（spec 决策 1：旧包目标根推导） | 保留 | [x] 旧包兼容回归（codex/claude→各自目标根用例保留） |

反向断言：
- [x] 未删除 codex/claude 档案定义数据模块
- [x] 旧包解包不因收窄破坏（目标根按包内档案正确推导）
- [x] 引擎行为零变化（改动集中在注册中心/命令层/前端表现层）

## run 验收结论（终裁后填写）

- 返工轮次：1（首轮即零阻塞）
- 路A结论：advise 4 条——①偏离自检清单粒度（PackWizard 两处用例名改写未单列，无整条遗漏）；②旧包预览类别名降级显示 zcode 描述（用户可见轻微误导）；③pkgProfileLabel 未考虑档案清单加载失败（profiles=null 时在产 zcode 包误标"旧版档案"）；④知悉项：基线既有 smoke 测试对真实 ~/.codex/~/.claude 凭据文件计算哈希（只读不回显）
- 路B结论：pass——构造性验证完成（探针实测 packAssets("codex"/"claude") 抛 AppError、list_profiles 负向断言、旧包目标根推导正向保留）；另报 2 条建议（packAssets 拒绝缺正式断言、前端无 claude 旧包用例）
- 路C结论：已跑通过——critical/high=0，medium=1（UnpackWizard resolveTargetRoot 失败被静默吞掉，见挂账①），low=2（忽略）
- 冲突裁定：无两路冲突；路C medium 与路A②③同族（解包向导旧包 UI 健壮性），统一裁定挂账不阻塞——理由：触发均需"包内档案完全未知"或"档案清单加载失败"的边角条件，且第 4 步 dry-run 确认页向用户展示目标根与文件清单，写入前有人工确认兜底
- 纪律核对（管理员亲自）：diff 范围=授权根内 14 文件无夹带；边界=树内无未跟踪杂物、主工作区仅台账改动；敏感=零真实凭据；台账=提交 98a5e3c 与回执一致、票据勾选与 Status 同步
- 偏离自检（终裁）：正向核对——E1-E4 双审+管理员抽查（7 文件 54 用例全绿）确认；反向核对——禁用清单三行均配反向测试且过；主动降级检测——执行者如实上报 pkgProfile 显示降级（在 spec 决策 1 字面边界内），未发现方案外兜底
- 终裁：**通过**（候选放行不否决；挂账 5 项与知悉 1 项见 ticket Comments，98a5e3c 合并回 main）
