# Ticket 05：Tauri 命令层 + 事件协议 + 前端 IPC 封装

Status: done
Type: task

## 目标

把引擎模块桥接到前端：全部命令集中注册唯一 invoke_handler；统一 `Result<T, AppError>`；长任务（打包/解包/校验）tokio spawn_blocking + `emit` 进度事件（阶段、当前/总数、警告）；前端 `src/lib/ipc.ts` 类型化 invoke 封装 + `useBackendEvent` Hook。

## 命令清单（契约）

- `scan_assets(profile_id, root) -> ScanReport`
- `pack(profile_id, root, categories, preset, output_path) -> PackResult`（事件进度）
- `open_package(path) -> PackageInfo`（校验+预览）
- `plan_apply(path, mode, conflict_overrides) -> ApplyPlan`（dry-run，无写入）
- `execute_apply(path, plan_token, mode) -> ApplyReport`（事件进度；plan_token 为已确认计划的防篡改令牌）
- `detect_path_mappings(path) -> Vec<PathMapping>`；`apply_path_mappings(items, backup=true) -> PathFixReport`
- `save_settings / load_settings`

## 验收

- [ ] 命令全部注册于唯一 invoke_handler；返回统一 AppError（JSON 可序列化 message + code）
- [ ] plan_apply 纯只读（不写目标）；execute_apply 必须携带 plan_token（引擎验证令牌=计划摘要哈希，防 UI 外篡改）
- [ ] 进度事件 payload 结构稳定（phase/message/current/total/warn），前端 Hook 类型化接收
- [ ] vitest：ipc.ts 命令名与后端注册名一致性测试（快照/常量表）

## Blocked by

02, 03, 04
