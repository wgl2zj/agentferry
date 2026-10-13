# VERSION_HISTORY.md — 版本历史

> 依据 `.rules/DOCUMENTATION.md`「文档职责」设立：记录上线（打 tag、发布 GitHub Release）、架构迁移和版本验证，不承担待办清单职责。
> 条目按时间正序排列；每条附可定位证据（提交哈希或 Release 链接）；不写会随开发增长而过期的数量。

## v0.1.6（`package.json` 当前版本号）

| 日期 | 事件 | 证据 |
|---|---|---|
| 2026-08-18 | 开源基线首发：资产摆渡（AgentFerry）agent 软件个人资产迁移工具，初版为 Rust 引擎 + Tauri v2 + React 19，MIT License（提交历史经用户要求清理，仅保留基线起点） | 提交 `33abfb1` |
| 2026-09-05 | 架构迁移：Rust 引擎整体替换为 TypeScript（Electron 主进程），React 前端零改动；选型经用户当日确认 | 提交 `60f4f44` |
| 2026-09-05 | 去除 Electron 默认英文菜单，对齐 Tauri 版无菜单栏形态（截图验收通过） | 提交 `c920a06` |
| 2026-09-06 | 新增内容级合并：解包冲突文件支持「两边内容都保留」（Markdown 行并集 / JSON 深合并，逐文件勾选，JSON 冲突以旧机包为准） | 提交 `012a4ed` |
| 2026-09-06 | code review 修复：类型镜像单源化、守卫测试换岗、updater 纯函数化 | 提交 `54088db` |
| 2026-09-06 | src-tauri 移除，架构切换收尾（六项清单经用户确认执行） | 提交 `209d63d` |

## 说明

- 本仓库截至 2026-10-13 尚未打 tag、未发布 GitHub Release；上表事件均提取自 git 提交历史（`git log`）。
- 后续上线（打 tag、发布 Release）时在本文件登记新版本条目并附 Release 链接；版本号取舍按发布时用户决定执行。
