# Triage Labels

Skills（triage 等）使用五个 canonical triage roles（标准分诊角色）。本文件把这些 roles 映射到本仓库 issue tracker 中实际使用的记录位置与取值。

本仓库 tracker 为本地 Markdown 方案（见 `issue-tracker.md`）：没有独立的 label 字段，**分诊状态记录在 issue 文件顶部附近的 `Status:` 行**。

| Label in mattpocock/skills | `Status:` 行取值（本仓库） | 含义 |
| -------------------------- | -------------------------- | ---- |
| `needs-triage`             | `needs-triage`             | 维护者需要评估这个 issue |
| `needs-info`               | `needs-info`               | 等待报告者补充更多信息 |
| `ready-for-agent`          | `ready-for-agent`          | 规格完整，可交给 AFK agent 执行 |
| `ready-for-human`          | `ready-for-human`          | 需要人工实现 |
| `wontfix`                  | `wontfix`                  | 不予处理 |

当某个 skill 提到 role（例如 "apply the AFK-ready triage label"）时，把对应字符串写入该 issue 文件的 `Status:` 行。

既有状态词汇不受影响：本仓库现存 issue 使用 `Status: done`（已完成）等自有状态；wayfinding（导航式拆解）流程使用 `claimed`/`resolved`（见 `issue-tracker.md`）。上表五个词汇只在新 issue 进入分诊流程时使用，与既有词汇共存于同一 `Status:` 行字段。

编辑上表右列即可调整本仓库实际使用的词汇；改动后同步检查引用这些词汇的 issue 文件。
