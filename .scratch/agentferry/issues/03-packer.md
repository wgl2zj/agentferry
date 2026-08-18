# Ticket 03：打包引擎（packer）

Status: done
Type: task

## 目标

纯 Rust 模块：把选中类别打包为 `.zam`（实质 ZIP）：逐文件 SHA-256 → manifest.json（决策 3 全部字段）→ zip 写入；异步/进度钩子接口；源目录全程只读。

## 验收

- [ ] 临时目录假资产树打包 → `.zam` 可被 zip 库重新打开，manifest 字段齐全（format_version=1、source、preset、files[].sha256/size/kind/needs_path_adapt、counts、warnings）
- [ ] 反向测试：打包前后源目录全部文件内容与 mtime 不变
- [ ] 反向测试：excluded 类别（缓存/凭据）文件绝不出现在包与 manifest 中
- [ ] WAL 阻断类别被选中时拒绝打包该库（AppError），提供"跳过该库"路径并把跳过记入 warnings[]
- [ ] 打包产物逐文件再校验：zip 内读回哈希 == manifest 记录
- [ ] 进度回调按文件计数推进（测试回调次数 == 文件数）

## Blocked by

02
