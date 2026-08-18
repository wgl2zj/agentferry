# Ticket 02：资产档案（profile）+ 扫描引擎（scanner）

Status: done
Type: task

## 目标

纯 Rust 模块（不依赖 Tauri 类型）：`Profile` 数据驱动结构（软件 → 资产类别 → 路径规则 → 处理策略：纯复制/文本需路径适配/SQLite 需退出检测）；内置 ZCode 档案（按可行性研究实测路径）；`scanner` 按档案扫描任意根目录，产出盘点结果（类别、文件清单、体量、SHA-256、可迁移性、WAL/SHM 阻断标记）。

## 验收

- [ ] 临时目录构造假 `~/.zcode` 树（含纯资产/SQLite+wal/缓存各类），扫描结果与构造一致（文件数、类别归类、kind 判定 text|binary|sqlite）
- [ ] `-wal`/`-shm` 存在 → 该类别 blocked=true 且给出原因
- [ ] 缓存/凭据类别（日志、检查点、子代理产物、插件缓存、credentials.json）标记为 excluded，扫描不计算其 SHA-256（快）
- [ ] 大文件集规模测试：扫描 5000 文件不随文件数超线性恶化（相对基线断言）
- [ ] 档案结构支持未来新增软件（测试：注册第二个假档案可扫描）

## Blocked by

01（需要 Cargo 工程）
