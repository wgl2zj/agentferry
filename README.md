# 资产摆渡 AgentFerry

agent 软件个人资产迁移工具：把 ZCode 等 agent 软件在使用中积累的个人资产（记忆、MCP 配置、技能、子代理定义、全局规则、自定义命令、插件清单，可选含会话历史）在本机**扫描 → 打包**为 `.zam` 迁移包，在换机后**校验 → dry-run 预览 → 确认 → 解包**（覆盖/增量两种模式，先备份、逐文件哈希复验），并提供**路径适配**（旧机绝对路径 → 新机路径，用户逐条确认后替换）。

## 技术栈

- 后端引擎：Rust（纯逻辑模块，可独立 `cargo test`）
- 桌面壳：Tauri v2
- 前端：React 19 + TypeScript + Vite，浅色系设计令牌（`src/styles/tokens.css` 唯一来源）

## 开发

```bash
npm install            # 前端依赖
npm run tauri dev      # 桌面应用开发模式
npm run build          # 前端构建（tsc 严格模式）
npm test               # 前端 vitest
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 测试（单元+集成）
```

## 安全设计（铁律）

- 源资产目录全程只读；写入目标必须来自用户显式选择
- 排除项（登录凭据、~3GB 可再生缓存）永不入包
- SQLite 检测到 `-wal`/`-shm` → 该库阻断打包（无强制打包选项）
- 解包必须先 dry-run 四组计划（新增/一致/冲突/保留）→ 用户确认（双道令牌防篡改）→ 执行
- 任何"替换已存在文件"先备份到 `zam-backups/<时间戳>/`；两种模式都不删除目标文件
- 路径替换仅文本类、UTF-8 无 BOM 字节级保持，含 BOM/非 UTF-8 跳过并警告

## 文档

- 产品 spec 与行为预期：`.scratch/agentferry/spec.md`
- 功能地图（模块行为预期）：`.rules/FEATURE_MAP.md`
- 可行性研究（资产盘点实测）：`ZCode迁移可行性研究.md`
- 规则体系：`AGENTS.md` + `.rules/`

## 许可证

[MIT](LICENSE)
