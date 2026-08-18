# Ticket 01：项目脚手架（Tauri v2 + React + TS + 浅色设计令牌）

Status: done
Type: task

## 目标

在仓库根建立可构建的桌面应用骨架：Vite + React + TypeScript 前端、Tauri v2 Rust 壳、浅色系设计令牌 `src/styles/tokens.css`（唯一来源）、类型化 IPC 约定文件骨架。`npm run build` 与 `cargo check`（src-tauri）通过。

## 验收

- [ ] `src-tauri` Tauri v2 工程：唯一 invoke_handler、AppError 骨架（thiserror + Serialize）、窗口配置（1200×800 最小 1024×768、浅色标题栏）
- [ ] `src/styles/tokens.css` 浅色系全套令牌：色板（语义：中性/进行中/成功/警告/危险）、间距（4/8/12/16/24/32）、圆角（6/12）、阴影两档、控件高度 44px
- [ ] 前端无原始十六进制色值（tokens.css 除外）
- [ ] `npm run build` 通过；`cargo check --manifest-path src-tauri/Cargo.toml` 通过
- [ ] 测试框架就位：vitest 配置 + 示例测试 1 条通过

## Blocked by

（无）
