# Ticket 07：集成验证 + code-review + 功能地图 + 收尾

Status: done
Type: task

## 目标

端到端集成验证（临时目录假资产树跑通 打包→拷贝→解包覆盖/增量→复验 全链路）、code-review（Standards+Spec 双轴）、更新 `.rules/FEATURE_MAP.md`（首批模块条目：扫描/打包/apply/路径替换，含测试锁定标注）、最终提交与汇报（偏离自检四问、建议全量回归）。

## 验收

- [ ] 全链路集成测试通过（纯引擎层；不触碰真实 `~/.zcode/`）
- [ ] code-review 双轴报告，高危问题清零
- [ ] FEATURE_MAP.md 五个核心模块条目就位（行为预期+出处+测试锁）
- [ ] spec 行为预期清单 16 条状态全部更新为已实现且注明测试证据
- [ ] 汇报含：正向核对/反向核对/主动降级检测三答 + "建议全量回归"

## Blocked by

06
