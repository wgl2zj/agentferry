# 02 — 产品收窄为仅 ZCode + 旧包兼容

**What to build:** 产品定位收窄为"ZCode 配置备份与转移工具"：打包向导只出现 ZCode 一个档案，codex/claude 不再作为可选软件出现。但此前用旧版打出的 codex/claude 迁移包不作废：解包向导选旧包仍能校验通过，且目标根按包内档案正确推导到各自资产目录。档案定义以数据形式保留（零维护成本），仅从产品入口移除。

**Blocked by:** 01（同一批档案测试文件串行改动，防撞车）

**Status:** resolved

- [x] 档案注册中心仅返回 zcode（档案列表命令测试断言从 3 个档案改为 1 个）
- [x] codex/claude 档案定义保留在代码中（数据模块），打包入口、前端档案选择处均不出现
- [x] 旧包兼容回归：codex/claude 旧包分别推导出各自目标根（把既有推导测试改造为"旧包兼容"语义并保留 zcode 用例）
- [x] 前端相关组件测试（如有档案枚举断言）同步更新，直接相关 vitest 全绿

## Comments

- 2026-10-13 工作流 run dwfrun-4d6eb3e9（专票·工作流引擎）1 轮交付零阻塞，候选放行；管理员终裁**通过**，提交 98a5e3c 合并回 main。
- 三路结论：路A（deepseek-v4.1-flash 异构）= advise 4 条；路B（GLM-5.3 独立会话·构造性验证）= pass（探针实测 packAssets 拒绝行为正确）；路C 通过（critical/high=0，medium=1，low=2，明细 dist/zcodev2-02-R1.json）。
- 终裁抽查：7 个直接相关测试文件 54 用例全绿（含真实目录只读 smoke）；diff 敏感核对零真实凭据（匹配串均为警告文案字段名断言与被删旧用例行）；纪律核对——14 个改动文件全在授权根内、树内无杂物、主工作区仅台账改动。
- 挂账清单（均不阻塞，建议后续小票处理）：① UnpackWizard 新增 resolveTargetRoot 失败被 .catch 静默吞掉（本轮新引入；触发需包内档案完全未知，且下游第 4 步 dry-run 确认页展示目标根兜底，双重门槛）——挂账之首，建议补用户可见提示或清空未手改默认值；② 旧 codex/claude 包预览类别名降级显示 zcode 描述（如 codex main_config 显示"cli/config.json"实为 config.toml，UnpackWizard.tsx pkgProfile 回退）；③ pkgProfileLabel 在档案清单未加载（list_profiles 失败）时把在产 zcode 包误标"（旧版档案）"；④ commands.test.ts 反向用例只断言了 scanAssets 拒绝，packAssets 半边缺正式断言（行为经路B探针证实正确）；⑤ 前端旧包兼容用例仅覆盖 codex，无 claude 前端用例（引擎层已锁）。
- 流程瑕疵记录（较上轮改善）：偏离自检 22 条清单无整条遗漏，但 PackWizard.test.tsx 两处既有用例名改写未按「测试名改动」单列（清单粒度问题）。
- 知悉项（基线既有、非本票引入）：scanner 真实目录 smoke 测试会对 ~/.codex/config.toml、~/.claude/settings.json 等非排除文件读取并计算 SHA-256（只读、不回显、不落盘）；与本轮敏感纪律字面有张力，后续可考虑硬化（如 smoke 跳过凭据文件的哈希）。
