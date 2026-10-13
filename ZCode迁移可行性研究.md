# ZCode 工作流 / 经验 / 记忆跨机迁移可行性研究

- 撰写日期：2026-08-17
- 研究对象：本机 `~/.zcode/`（实测约 4GB）
- 研究方式：全程只读勘察（目录结构、体量分布、文件格式、路径绑定程度、SQLite 只读查表），未对源数据做任何改动

---

## 一、总体结论

**可行，且分两档"无损"：**

1. **字面无损可迁移**：全局规则（AGENTS.md）、44 个技能、自定义命令、子代理定义、10 个项目的记忆——合计不足 1MB，全部是纯文本，无数据库、无加密、无本机路径绑定，可逐字节校验迁移。
2. **可迁移但需适配**：会话历史主体存于 `cli/db/db.sqlite`（578MB，跨平台 SQLite 格式，可整库搬运）；配置文件中含本机绝对路径，需按新机环境替换。
3. **无法搬运（也无损失）**：登录凭据为 `enc:v1:` 加密存储，大概率绑定本机，新机重新登录即可，账号与订阅数据在云端，不受影响。
4. **不必搬运**：约 2.9GB 的运行时缓存（子代理产物、检查点、日志、插件缓存），全部可重建。

---

## 二、资产盘点（实测）

`~/.zcode/` 约 4GB，实质是"约 1MB 的知识 + 约 3GB 的运行痕迹"。

### ✅ 纯资产——可 100% 无损迁移

| 类别 | 位置 | 体量 | 说明 |
|------|------|------|------|
| 全局规则 | `~/.zcode/AGENTS.md` | 8K | 纯文本 |
| 技能（44 个） | `~/.zcode/skills/` | 168K | 已 grep 检查，无本机路径绑定（检出的 "Users" 仅为英文单词误报） |
| 自定义命令 | `~/.zcode/commands/`（bsfb.md、gz.md） | 2K | 纯文本 |
| 子代理定义 | `~/.zcode/agents/kimi-k3.md` | 4K | 纯文本 |
| 记忆库（10 个项目） | `~/.zcode/cli/memories/projects/` | 371K | 纯 Markdown。有内容的 7 个项目，最大的 example_dev 约 212K |
| 插件清单 | `~/.zcode/cli/plugins/installed_plugins.json`、`known_marketplaces.json` | <10K | 照单在新机重装即可 |

### ⚠️ 半绑定——可迁移但需适配

| 类别 | 位置 | 体量 | 绑定点 |
|------|------|------|--------|
| 主配置 | `~/.zcode/cli/config.json` | 4K | 含 24 处本机路径（如 `C:\Users\alice\AppData\Local\Programs\Python\Python312\...` 的 MCP 命令行），新机用户名或软件安装位置不同则需替换 |
| v2 配置 | `~/.zcode/v2/config.json` | 16K | 同上，可能含状态类配置 |
| 会话历史主库 | `~/.zcode/cli/db/db.sqlite`（含 -wal/-shm） | 578M | SQLite 为跨平台格式，可整库拷贝。实测含 **812 个会话、36422 条消息、133467 个消息部件、1601 条 todo、100 条输入历史** |
| 会话工件 | `~/.zcode/cli/artifacts/`（244M）、`~/.zcode/cli/rollout/`（17M） | 261M | 按会话 ID 组织的纯文件，可搬；内容里嵌有旧机绝对路径 |
| 任务索引 | `~/.zcode/v2/tasks-index.sqlite`（含 -wal/-shm） | 12M | 同 SQLite，可搬 |
| Claude 导入会话 | `~/.zcode/v2/sessions/` | 1.7M | JSON 文本，可搬 |

### ❌ 不可移植 / 不必迁移

| 类别 | 位置 | 体量 | 处置 |
|------|------|------|------|
| 登录凭据 | `~/.zcode/v2/credentials.json` | 小 | 值均为 `enc:v1:` 加密格式，若密钥绑定本机则新机无法解密。**新机重新登录即可，无实际损失** |
| 子代理运行产物 | `~/.zcode/cli/agents/` | 1.7G | 可再生缓存，不迁 |
| 检查点 | `~/.zcode/v2/checkpoints/` | 1.0G | 可再生缓存，不迁 |
| 日志 / 崩溃转储 | `cli/log/`(35M)、`v2/logs/`(65M)、`v2/crash/`(67M) | ~170M | 不迁 |
| 图片缓存 | `~/.zcode/cli/image-cache/` | 2.4M | 不迁 |
| 插件缓存 | `~/.zcode/cli/plugins/cache/` | 35M | 不迁，按清单重装 |

---

## 三、"无损"的三个边界

### 1. 字面无损的部分

上表所有 ✅ 项：纯文本、无外部依赖。迁移后逐文件比对 SHA-256 即可证明无损。

### 2. 无损但有"语义时差"的部分——记忆

文件层面记忆会完整迁移，但记忆内容记录的是**这台机器的事实**：

- WPS 装在 `D:\WPS Office`
- Node.js 装在 `E:\Program Files\nodejs`
- DevEco Studio 在 D 盘、模拟器在 `127.0.0.1:5555`
- 本机 pwsh 为 7.6.4、中文用户名的路径坑

这不是迁移造成的损失；但若新电脑软件布局不同，这些记忆在新机上会过时甚至误导，届时需在新机上让 ZCode 更新记忆。同理，`AGENTS.md` 全局规则深度绑定 Windows + Git Bash + 本机环境（多模态白名单等），新机同为 Windows 则直接适用，换平台则规则本身需重写。

### 3. 无法搬运的部分——凭据

`enc:v1:` 加密，重新登录一次解决；账号侧数据不受影响。

---

## 四、迁移路线（三档方案）

### 方案 A · 资产迁移（推荐）

**得到 100% 的工作流与记忆，约 1MB，耗时约十分钟。**

1. 新机安装 ZCode，登录一次，退出；
2. 从旧机拷贝：`AGENTS.md`、`skills/`、`commands/`、`agents/`、`cli/memories/`、`cli/plugins/installed_plugins.json`、`cli/plugins/known_marketplaces.json`；
3. 新机首次启动前，替换 `cli/config.json` 中的路径差异（用户名、盘符、Python 等软件路径）；
4. 按 `installed_plugins.json` 清单重装插件。

### 方案 B · 资产 + 历史

**在 A 基础上保留全部 812 个会话的可查历史，约 850MB。**

追加拷贝：`cli/db/db.sqlite`（连同 `-wal`/`-shm`）、`cli/rollout/`、`cli/artifacts/`、`v2/tasks-index.sqlite`（连同 `-wal`/`-shm`）、`v2/sessions/`。

说明：历史在新机可查可读；跨机"续聊"旧会话不保证开箱即用（会话记录里嵌有旧机绝对路径）。

### 方案 C · 整目录克隆（不推荐）

整个 `~/.zcode` 搬过去（排除缓存后约 1.1GB）。会把本机的锁文件（`bots-runtime-locks`）、证书（`certs`）、崩溃转储等状态一起带过去，收益不比方案 B 多，风险更高。

---

## 五、操作铁律与注意事项

1. **拷贝前必须完全退出 ZCode**（客户端与 CLI 全部关闭）。SQLite 的 WAL/SHM 文件在运行中拷贝会得到损坏的库。
2. **两台机之间用压缩包中转**，避免散拷丢文件，也规避中文用户名路径的编码问题。
3. **新机用户名不同时**：`cli/config.json` 的 24 处路径需做一次统一替换（注意保持 UTF-8 无 BOM）。
4. **新机若为 macOS/Linux**：文件照搬仍可行，但 `AGENTS.md` 与部分技能（Windows/pwsh/Git Bash 相关规则）语义需重写，记忆中的本机环境条目需重建。
5. **验证无损的方法**：迁移后对纯资产逐文件比对 SHA-256；核对技能数量（44）、记忆项目数（10）、会话数（812）一致。

---

## 六、待确认变量（影响适配工作量，不影响可行性）

| 变量 | 影响 |
|------|------|
| 新机是否为 Windows？用户名是否相同？ | 同为 Windows 且用户名一致 → 几乎零适配；用户名不同 → 一次路径替换；换平台 → AGENTS.md 与技能规则需重写 |
| 选择哪一档方案？ | 只在乎工作流和记忆选 A；要保留全部会话可查历史选 B |

---

## 七、2026-10-13 复勘（ZCode 档案 v2 的定性依据）

> 本章为追加内容；一至六节是 2026-08-17 的原始勘察记录，保持原样。原记录中的体量、会话数、类别划分均为当时实测值，现势数字以本章为准（各自注明采集日期）。产品现状见 README；本章职责是记录"档案 v2 为什么这样划"的完整依据，供下次 ZCode 更新后复勘对照。

### 7.1 背景：ZCode 已开源，官方存储目录清单成为定性权威

ZCode 已开源（仓库 [zai-org/ZCode](https://github.com/zai-org/ZCode)）。其源码中的存储目录清单 `packages/services/src/storage/domain/storageCatalog.ts`——官方注释自称"存储分类目录：把 .zcode 根下的相对路径映射到类别、聚合 key 与可清理性。纯函数、单一事实源"——把全部存储路径划入 config（用户配置，不可清理）/ sessionStore（会话存储）/ runtimes（运行时）/ toolOutputs·logs·backups·exports 等可清理类别。

AgentFerry 档案 v2（26 类别）的定性即以此清单为权威起点，叠加官方 Configuration Reference 与本机 2026-10-13 只读复勘核对：官方清单明确归类的按官方（如 `v2/*.json` 归 config、`v2/checkpoints` 归 sessionStore、`cli/plugins` 归 runtimes）；官方清单未覆盖的用户资产（根级 `hooks.json`、`mcp.json`、`openviking/` 等）以官方文档与本机实测定性。

### 7.2 v1 → v2 类别对照（15 类 → 26 类）

v1 定稿于 2026-08-17（推荐 8 + 完整 5 + 排除 2 类承载）；v2 于 2026-10-13 依官方清单升级（推荐 17 + 完整 7 + 排除 2 类承载）。

**推荐档（8 → 17）**：原有 8 类全部保留（其中 plugin_manifests 的文件清单由 2 个增至 3 个，补 `icon-sources.json`）；新增 9 类：

| 新类别 | 内容 | 增补依据 |
|---|---|---|
| hooks_config | `hooks.json`（记忆钩子配置） | ZCode 更新新增的用户资产（官方清单对其无专门规则，定性以官方文档与本机实测为准）；本机实测钩子命令含本机绝对路径 → 路径适配 |
| mcp_config | `mcp.json`（用户级 MCP 服务器清单） | 官方 Configuration Reference 载明的用户级配置（官方清单对其无专门规则，以官方文档与本机实测为准） |
| app_settings | `v2/setting.json`（语言、快捷键、最近项目等应用设置） | 官方列为任何类别下都不可删的保护文件；本机实测含本机路径 → 路径适配 |
| provider_config | `v2/provider_config.json`（自定义模型服务商） | 官方归 config（`v2/*.json` 文件规则）；本机实测内嵌明文 API key → 照迁+点名字段警告（沿用凭据先例）+ 路径适配 |
| bot_config | `v2/bot-config.v3.json` 与 `bot-config.json`（机器人配置） | 官方归 config（`v2/*.json` 文件规则） |
| agents_state | `v2/agents-state.json`（代理启用/模型覆盖） | 官方归 config（`v2/*.json` 文件规则） |
| openviking_state | `openviking/` 整目录（记忆库钩子接入配置与脚本） | 本机独有目录（官方清单无此目录）；内嵌 userKey 凭据 → 照迁+警告 |
| user_scripts | 根目录 `vibe-autostart.cmd`、`register-vibe-autostart.ps1`（用户自建） | 本机实测存在的用户自建脚本（官方清单无专门规则） |
| plugin_state | `cli/plugins/data/` 与 `cli/plugins/marketplaces/` | 官方将 cli/plugins 整体归 runtimes（不可清理）→ 插件数据与市场克隆照迁保证"完美复刻"；市场克隆体量约 8.7MB（2026-10-13 实测） |

**完整档（5 → 7）**：原有 5 类（session_db、artifacts、rollout、tasks_index、v2_sessions）保留；新增 2 类——

- **checkpoints**（`v2/checkpoints/`）：由 v1 的排除改入完整档。官方清单把它归 sessionStore（会话存储、不可清理），与"对话可以作为可选项迁移"的产品定位一致，不再是"可再生缓存"。
- **visualizations**（`v2/visualizations/`）：会话可视化产物，属对话的一部分（spec 口径；官方清单对其无专门规则）。

**排除（2 类承载，路径清单 7 → 25 项）**：credentials（登录凭据 `v2/credentials.json`）不变；caches 移出 v2/checkpoints 后增补 19 项——子代理执行现场（`cli/exec`、`cli/sessions`）、工作区草稿与临时区（`workspace`、`tmp`）、pdf 缓存（`cli/pdf-cache`）、v2 运行痕迹（`v2/agent-config`、`v2/repo-wiki`、`v2/runtime`）、安全材料（`v2/certs`，本机自签网络 CA 私钥，不外带）、`v2/bots-runtime-locks`、v2 根下状态/缓存 json（coding-plan-cache、bots-model-cache、telemetry-state、onboarding-record、bot-state×2）、feedback、export-log-stage、plugin-workspace。

### 7.3 完整档体量提示

会话主库 `cli/db/db.sqlite` 已由 2026-08 的 578MB 增至**约 4.3GB**（2026-10-13 实测，本机只读复勘 du 统计）：完整档选中该类别时，包体积与耗时会显著大于推荐档，属预期而非回归（打包向导既有体量展示已覆盖此提醒）。叠加 checkpoints（约 1GB，2026-08 实测）等类别后完整档总体量以向导实测展示为准。

### 7.4 复刻边界（新机需自行完成的事）

以下四件事在迁移包之外，解包后需用户在新机上自行完成：

1. **OpenViking 本体需新机另装**：openviking_state 类别只迁 `~/.zcode/openviking/` 接入配置；OpenViking 本体（`~/.openviking/`，位于 ZCode 档案根之外）不随包迁移，新机未安装则记忆钩子报错。
2. **钩子可能需一次信任确认**：ZCode 官方对钩子有 SHA-256 摘要信任机制，新机默认"待信任"，可能需执行一次 `zcode hooks trust` 确认后才运行；工具只提醒、不代办。
3. **登录凭据需重登**：`v2/credentials.json`（`enc:v1:` 加密，绑定本机）永不入包，新机重新登录即可，账号与订阅数据在云端。
4. **自定义数据目录需改目标根**：若 ZCode 配置了 dataBaseDir（自定义数据根目录），解包向导不会自动发现，需手动修改恢复目标根目录。

### 7.5 官方存储目录全表（存档）

> 来源：zai-org/ZCode 仓库 master 分支 `packages/services/src/storage/domain/storageCatalog.ts`（单一事实源）。采集日期 2026-10-13（spec 复勘定稿依据）；本表于 2026-10-14 文档交付时按 master 当前原文核对誊录。官方清单中 cli/models、workflows、security、mailbox 等目录本机不存在（多为新版本/特性目录），档案 v2 只收录实测过的目录，全表存档供下次复勘对照。

| 官方类别（可清理性） | 覆盖目录 / 文件模式 |
|---|---|
| sessionStore（不可清理） | `v2/sessions`、`v2/session-bindings`、`v2/checkpoints`；`v2/*.sqlite(-wal/-shm)`、`cli/db/db.sqlite(-wal/-shm)` |
| subagentTranscripts（仅 transcript 可删） | `cli/agents/<会话>/<子代理>/transcript.jsonl` |
| toolOutputs（不可清理） | `cli/artifacts`、`cli/agents`、`cli/sessions`、`cli/exec`、`cli/image-cache`、`cli/pdf-cache`、`clipboard`、`git-checkpoint-index`、`editor-icon`、`tmp`、`cache`；`v2/checkpoints/**/(pending\|tmp)/`；`v2/coding-plan-cache.json`、`v2/bots-model-cache*.json` |
| modelTrajectory（可清理） | `cli/debug`、`cli/rollout` |
| devTraces（可清理） | `v2/dev`、`v2/acp-traffic-proxy`、`v2/acp-stream-diagnostics` |
| logs（可清理） | `v2/logs`、`cli/log`、`logs`、`v2/crash`、`v2/perf`、`feedback/logs`；`computer-use/run/*.log` |
| backups（清理需确认） | `backup`、`v2/backup`、`v2/migrations`、`cli/db/backup`、`cli/db/backups`；`cli/db/db.sqlite.*`、`cli/config.json.bak*`、`v2/*.bak`、`v2/*.backup.json`、`v2/setting.json.(corrupt-\|*backup*)`、`v2/config.json.pre-*` |
| exports（可清理） | `export-log`、`export-log-stage`、`feedback` |
| runtimes（不可清理） | `agents`、`bundled-agents`、`lite`、`computer-use`、`cli/plugins`（插件缓存归运行时） |
| config（用户配置，不可清理） | 前缀：`v2/agent-config`、`v2/bots-runtime-locks`、`v2/bot-attachments`、`v2/certs`、`v2/acp-auth`、`v2/acp-config`、`v2/provider`、`cli/models`、`cli/memories`、`cli/workflows`、`security`、`commands`、`skills`、`workflows`、`workspace`、`mailbox`、`server`、`controller`、`launcher`、`dev-signing`、`cua-helper-dev-identity`、`perf-task-manifests`、`plugin-workspace`、`projects`；文件：`v2/*.json`、`cli/config.json`、`agents/*.md`、`AGENTS.md` |
| other（兜底，不可清理） | 未命中以上规则的路径；含 `agent/`（ACP 时代残留）与"启用自定义数据目录后 home 根下 v2 旧副本" |
| 受保护文件（任何类别不可删） | `setting.json`、`setting.json.lock`、`credentials.json`、`.credentials.json`、`.tokens`、`zcode-stdio-tap.json`、`v2/crash/live/` 前缀 |
