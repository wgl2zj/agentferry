# 资产摆渡 AgentFerry

ZCode 配置备份与转移工具：在老机器上把 ZCode 的个人资产（全局规则、技能、命令、子代理定义、记忆、CLI 与 v2 配置、插件、记忆钩子、MCP、应用设置、模型服务商、机器人配置等）**扫描 → 打包**为 `.zam` 迁移包，换机后在新机器上**校验 → dry-run 预览 → 确认 → 解包**（覆盖/增量两种模式，先备份、逐文件哈希复验），完整复刻 ZCode 的功能与配置；对话/会话历史默认不打包，作为完整档可选项。解包后提供**路径适配**（旧机绝对路径 → 新机路径，用户逐条确认后替换）。

## 技术栈

- 后端引擎：TypeScript（Node API，运行于 Electron 主进程，纯逻辑可独立 vitest）
- 桌面壳：Electron（contextBridge 受控 IPC + 系统窗口）
- 前端：React 19 + TypeScript + Vite，浅色系设计令牌（`src/styles/tokens.css` 唯一来源）

## 开发

```bash
npm install            # 全部依赖
npm run dev:electron   # 桌面应用开发模式（vite + electron 联动）
npm run build          # 前端构建 + 主进程/预加载打包
npm run build:installer # 一键产出 Windows 安装包（release/AgentFerry-Setup-<版本>.exe，产物不入库；下载镜像见 .npmrc 与 build.electronDownload，首次构建需联网约 200MB）
npm test               # 全部 vitest（引擎 + 前端）
```

## 安全设计（铁律）

- 源资产目录全程只读；写入目标必须来自用户显式选择
- ZCode 档案 v2 共 26 类别（推荐档 17 + 完整档 7 + 排除 2 类承载）；打包向导仅提供 ZCode 一个档案——codex/claude 档案定义保留仅供旧迁移包解包兼容，不再提供任何打包入口
- 排除项（登录凭据、约 4GB+ 运行痕迹含网络 CA 私钥等安全材料，2026-10-13 实测）永不入包
- 内嵌明文凭据的配置（模型服务商 `access.apiKey`、OpenViking 接入 `userKey`）照迁，打包与确认页点名具体字段警告
- SQLite 检测到 `-wal`/`-shm` → 该库阻断打包（无强制打包选项）
- 解包必须先 dry-run 四组计划（新增/一致/冲突/保留）→ 用户确认（双道令牌防篡改）→ 执行
- 任何"替换已存在文件"先备份到 `zam-backups/<时间戳>/`；两种模式都不删除目标文件
- 路径替换仅文本类、UTF-8 无 BOM 字节级保持，含 BOM/非 UTF-8 跳过并警告

## 文档

- 现行 spec（ZCode 档案 v2 与产品收窄）：`.scratch/zcode-v2/spec.md`
- 历史 spec（2026-08-17 基线，Tauri 时代）：`.scratch/agentferry/spec.md`
- 功能地图（模块行为预期）：`.rules/FEATURE_MAP.md`
- 可行性研究（资产盘点实测 + 2026-10-13 复勘）：`ZCode迁移可行性研究.md`
- 规则体系：`AGENTS.md` + `.rules/`

## 许可证

[MIT](LICENSE)
