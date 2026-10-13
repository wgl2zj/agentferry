# QA 结论记录 — 01 ZCode 档案升级 v2（26 类别）

- 梯队：1/3（Blocked by: 无）
- 工作树：`D:/.tmp/zcoder-move-wt-20261013-223945` · 分支 `wt-aicode/main/20261013-223945` · 基线 a94eaa8（main）
- 引擎与名册：工作流 run dwfrun-73cdf457（2026-10-13，26m31s，3 阶段 13 步）；执行者 GLM-5.3（max，个人计划）/ 路A deepseek-v4.1-flash（max，workbuddy，异构）/ 路B GLM-5.3 独立会话 / 路C ocr review 机器闸门
- 复制清单：node_modules（收尾删副本）
- 交付提交：bf42b79（单提交，10 文件：electron/engine 5 个 profile/测试文件 + src 5 个合同/组件/mock 文件，全在授权根内）

## 完成定义（方案断言，派发前固化——源自 ticket 01 验收项与 spec Implementation Decisions 3/4/5）

正向断言：
- [x] 档案类别总数 26（推荐 17/完整 7/排除 2 承载），与 spec 第 3 条一致（profileContract/commands 测试断言更新）
- [x] 9 个新推荐类别走通"假资产树盘点→入包→逐文件哈希复验"（packer/scanner 新用例）
- [x] provider_config/openviking_state 警告串进 manifest.warnings（调用方警告在前），点名 access.apiKey / userKey（zcode_v2_credential_categories_carry_field_level_warning 等用例）
- [x] hooks_config/app_settings/provider_config 路径适配标记 + kind=text 一致性遍历锁扩展通过
- [x] checkpoints/visualizations 入完整档与自定义勾选；默认推荐档不含（preset 过滤断言）
反向断言：
- [x] 无两个凭据类别时警告零变化（回归锁改写后保留语义）
- [x] caches 增补路径不入包（双重核验：manifest 条目遍历 + 盘点只计体量）
- [x] 源目录只读、WAL 阻断既有反向测试不弱化（终裁抽查 66 用例全绿）
- [x] 注册范围不变：list_profiles 仍返回 3 档案（commands.test.ts 既有断言未动且通过）

禁用清单：无（本轮纯档案扩充；收窄类禁用清单在 02 的 QA 记录维护）

## run 验收结论（终裁后填写）

- 返工轮次：1（首轮即零阻塞）
- 路A结论：advise 2 条——①执行者回执漏报测试名改动（称 1 处实为 4 处，改动本身可辩护）；②mock 演示数据 kind 与引擎 kindOf 判定不一致（checkpoints .json 标 binary、ov-recall.mjs 标 text，无行为影响）
- 路B结论：pass——构造性验证完成（排除项物理不入包负向对照、无凭据类别警告零变化对拍、caches 只计体量行为对比），独立发现同一回执漏报问题并判建议级
- 路C结论：run 内失败（脚本 `--background` 中文参数经 node spawnSync(shell:true) 拼命令行时被空格截断，报 unknown command "档案"）→ 降级留痕；终裁手动重跑（去 --background）：见下方补记
- 冲突裁定：无两路冲突；两条建议的裁定=测试名改动属合理偏离予以保留（旧断言在 v2 语义下必然失真，`模块_场景` 标识符部分保留、FEATURE_MAP:75 引用仍可解析）、回执漏记录为流程瑕疵不改代码、mock kind 不一致挂账
- 纪律核对（管理员亲自）：diff 范围=授权根内 10 文件无夹带；边界=树内无未跟踪杂物、主工作区仅台账改动；敏感=diff 中凭据相关串全部为字段名断言与 PLACEHOLDER 夹具，零真实凭据；台账=提交 bf42b79 与回执一致、票据勾选与 Status 同步
- 偏离自检（终裁）：正向核对——E1-E7 双审+管理员抽查（8 文件 66 用例全绿）确认；反向核对——注册范围/引擎行为/排除项均经反向测试确认未偏离；主动降级检测——未发现方案外兜底/镜像/回退（路A路B均未报）
- 终裁：**通过**（候选放行不否决；bf42b79 合并回 main）

## 路 C 手动重跑补记

- 命令：ocr review --from main --to wt-aicode/main/20261013-223945 --audience agent --format json --output dist/zcodev2-01-R1-manual.json（每 session 新生成）
- 结果：exit 0，产出 dist/zcodev2-01-R1-manual.json；severity 归并 **low=1、critical/high/medium=0** → 按归并规则（low 忽略）**路C 通过**。

## 流程教训（供后续 run 脚本沿用）

- ocrSpawnCode 适配层（spawnSync shell:true）拼命令行时，含空格/中文的可选参数（如 --background 描述）会被 shell 按空格拆散导致 unknown command——**后续脚本不再传 --background**，业务背景已由双审任务书承载。
