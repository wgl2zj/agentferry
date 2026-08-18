// 解包向导组件测试：dry-run 四组渲染与冲突改判交互 + 路径适配在执行之后的第 6 步。
// jsdom 无 __TAURI_INTERNALS__，自动走内置 mock；apiCall 包 vi.fn 断言重新 plan。
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../lib/ipc";

vi.mock("../lib/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mock")>();
  return {
    ...actual,
    apiCall: vi.fn(actual.apiCall),
    pickPackage: vi.fn(async () => null),
  };
});

import { apiCall, pickPackage, resetMockState } from "../lib/mock";
import { ToastProvider } from "../components/Toast";
import { UnpackWizard } from "./UnpackWizard";

function renderWizard() {
  return render(
    <ToastProvider>
      <UnpackWizard onExit={() => undefined} />
    </ToastProvider>,
  );
}

/** 走完前 3 步，停在第 4 步（dry-run 计划确认，四组已渲染）。 */
async function gotoPlanStep() {
  renderWizard();
  // 第 1 步：路径由 loadSettings mock 预填，点击打开并校验
  const openBtn = await screen.findByRole("button", { name: "打开并校验" });
  await waitFor(() => expect(openBtn).toBeEnabled());
  fireEvent.click(openBtn);
  await screen.findByText("包校验通过");
  fireEvent.click(screen.getByRole("button", { name: "下一步：预览内容" }));
  // 第 2 步：内容预览表渲染后进入第 3 步（恢复模式）
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "下一步：选择恢复模式" }));
  // 第 3 步：模式卡渲染后进入第 4 步
  await screen.findByRole("button", { name: /增量模式/ });
  fireEvent.click(screen.getByRole("button", { name: "下一步：生成变更计划" }));
  await screen.findByText("冲突：保留目标");
}

/** 从第 4 步执行解包并进入第 5 步执行报告。 */
async function executeFromPlan() {
  const execBtn = await screen.findByRole("button", { name: "执行解包" });
  await waitFor(() => expect(execBtn).toBeEnabled());
  fireEvent.click(execBtn);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "确认执行" }));
  await screen.findByText("解包完成");
}

describe("解包向导：dry-run 计划确认（第 4 步）", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(apiCall).mockClear();
    vi.mocked(pickPackage).mockClear();
    resetMockState();
  });

  it("四组动作分组渲染，冲突改判触发重新 plan_apply，执行走确认对话框", async () => {
    await gotoPlanStep();

    // 四组标题可见
    expect(screen.getByText("新增文件")).toBeInTheDocument();
    expect(screen.getByText("内容一致，跳过")).toBeInTheDocument();
    expect(screen.getByText("冲突：备份后替换")).toBeInTheDocument();
    expect(screen.getByText("冲突：保留目标")).toBeInTheDocument();

    // 增量模式默认：冲突保留目标 → keep 组内有可改判行
    const keepGroup = screen.getByText("冲突：保留目标").closest("div")!.parentElement!;
    const keepRows = within(keepGroup).getAllByRole("button", { name: "备份后替换" });
    expect(keepRows.length).toBeGreaterThan(0);

    const planCallsBefore = vi
      .mocked(apiCall)
      .mock.calls.filter((c) => c[0] === COMMANDS.planApply).length;

    // 点击第一行的「备份后替换」→ 重新 plan_apply，且带上了改判清单
    fireEvent.click(keepRows[0]);
    await waitFor(() => {
      const planCalls = vi
        .mocked(apiCall)
        .mock.calls.filter((c) => c[0] === COMMANDS.planApply);
      expect(planCalls.length).toBeGreaterThan(planCallsBefore);
      const last = planCalls[planCalls.length - 1][1] as { conflictOverrides: string[] };
      expect(last.conflictOverrides.length).toBeGreaterThan(0);
    });

    // 页脚统计可见
    expect(screen.getByText(/新增 \d+ · 跳过 \d+ · 替换 \d+ · 保留 \d+/)).toBeInTheDocument();

    // 「执行解包」走高风险确认对话框，确认前不调 execute_apply
    const execBtn = await screen.findByRole("button", { name: "执行解包" });
    await waitFor(() => expect(execBtn).toBeEnabled());
    fireEvent.click(execBtn);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("确认执行解包计划");
    expect(vi.mocked(apiCall).mock.calls.some((c) => c[0] === COMMANDS.executeApply)).toBe(
      false,
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "确认执行" }));
    await waitFor(() => {
      expect(vi.mocked(apiCall).mock.calls.some((c) => c[0] === COMMANDS.executeApply)).toBe(
        true,
      );
    });
  });

  it("第 1 步「浏览…」选择迁移包后回填路径，取消不改动", async () => {
    // 宏任务模拟选文件耗时（微任务 setState 在 jsdom+React19 下不可见）
    vi.mocked(pickPackage).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0));
      return "E:\\U盘\\新包.zam";
    });
    renderWizard();
    const input = await screen.findByLabelText("迁移包路径（.zam）");
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(input).toHaveValue("E:\\U盘\\新包.zam"));

    // 取消（返回 null）不改动当前值
    vi.mocked(pickPackage).mockImplementation(async () => null);
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(pickPackage).toHaveBeenCalledTimes(2));
    expect(input).toHaveValue("E:\\U盘\\新包.zam");
  });

  it("第 3 步展示恢复目标目录（默认档案根目录），plan_apply 携带 targetRoot", async () => {
    renderWizard();
    const openBtn = await screen.findByRole("button", { name: "打开并校验" });
    await waitFor(() => expect(openBtn).toBeEnabled());
    fireEvent.click(openBtn);
    await screen.findByText("包校验通过");
    fireEvent.click(screen.getByRole("button", { name: "下一步：预览内容" }));
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择恢复模式" }));
    // 目标目录默认为档案登记的 ZCode 根目录
    expect(await screen.findByLabelText("恢复目标目录")).toHaveValue(
      "C:\\Users\\demo\\.zcode",
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步：生成变更计划" }));
    await screen.findByText("冲突：保留目标");
    const planCall = vi
      .mocked(apiCall)
      .mock.calls.find((c) => c[0] === COMMANDS.planApply);
    expect(planCall?.[1]).toMatchObject({ targetRoot: "C:\\Users\\demo\\.zcode" });
    // 计划对象携带目标根目录（执行以此为写入目标——事故修复契约）
    const plan = await screen.findByText(/新增 \d+/);
    expect(plan).toBeInTheDocument();
  });

  it("打开 Codex 迁移包：类别名、包警告与恢复目标根目录全部按包内档案切换", async () => {
    renderWizard();
    const input = await screen.findByLabelText("迁移包路径（.zam）");
    fireEvent.change(input, { target: { value: "D:\\迁移包\\codex-迁移包-20260817.zam" } });
    fireEvent.click(screen.getByRole("button", { name: "打开并校验" }));
    await screen.findByText("包校验通过");
    // 打包时记录的警告含 codex main_config 的 token 警告（mock 与后端 packer 同源生成）
    expect(screen.getByText(/experimental_bearer_token/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步：预览内容" }));
    const table = await screen.findByRole("table");
    // 类别中文名按 codex 档案表解析（zcode 独有类别不出现）
    expect(table).toHaveTextContent("主配置（config.toml）");
    expect(table).toHaveTextContent("规则（rules/）");
    expect(table).not.toHaveTextContent("自定义命令");

    fireEvent.click(screen.getByRole("button", { name: "下一步：选择恢复模式" }));
    // 恢复目标根目录按包内档案推导为 ~/.codex
    expect(await screen.findByLabelText("恢复目标目录")).toHaveValue(
      "C:\\Users\\demo\\.codex",
    );
    fireEvent.click(screen.getByRole("button", { name: "下一步：生成变更计划" }));
    await screen.findByText("冲突：保留目标");
    const planCall = vi
      .mocked(apiCall)
      .mock.calls.find((c) => c[0] === COMMANDS.planApply);
    expect(planCall?.[1]).toMatchObject({ targetRoot: "C:\\Users\\demo\\.codex" });
  });
});

describe("解包向导：路径适配在执行之后（第 6 步）", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(apiCall).mockClear();
    resetMockState();
  });

  it("执行完成前不调用 detect；进入第 6 步后检出映射，可勾选停用、新串可编辑", async () => {
    await gotoPlanStep();

    // 时序红线：执行前不得调用 detect_path_mappings（目标树尚不存在）
    expect(
      vi.mocked(apiCall).mock.calls.some((c) => c[0] === COMMANDS.detectPathMappings),
    ).toBe(false);

    await executeFromPlan();

    // 执行报告渲染后，detect 仍未自动调用（要等进入第 6 步）
    expect(
      vi.mocked(apiCall).mock.calls.some((c) => c[0] === COMMANDS.detectPathMappings),
    ).toBe(false);

    // 进入第 6 步：路径适配
    const pathfixBtn = await screen.findByRole("button", { name: /下一步：路径适配/ });
    expect(pathfixBtn).toHaveTextContent("2 个文件需要");
    fireEvent.click(pathfixBtn);

    const table = await screen.findByRole("table", { name: "路径替换建议清单" });
    expect(
      vi.mocked(apiCall).mock.calls.some((c) => c[0] === COMMANDS.detectPathMappings),
    ).toBe(true);

    // 勾选停用第一条映射
    const checkbox = within(table).getByRole("checkbox", {
      name: "启用映射 C:\\Users\\zhangsan",
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    // 编辑新串
    const input = within(table).getByRole("textbox", {
      name: "映射 C:\\Users\\zhangsan 的新路径",
    });
    fireEvent.change(input, { target: { value: "C:\\Users\\newuser" } });
    expect(input).toHaveValue("C:\\Users\\newuser");

    // 被跳过文件行内提示原因
    expect(screen.getByText(/包含 BOM 或非 UTF-8 编码/)).toBeInTheDocument();

    // 确认执行路径替换：不带 backup 参数（后端已移除）
    fireEvent.click(screen.getByRole("button", { name: /确认并执行路径替换/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "确认替换" }));
    await waitFor(() => {
      const calls = vi
        .mocked(apiCall)
        .mock.calls.filter((c) => c[0] === COMMANDS.applyPathMappings);
      expect(calls.length).toBe(1);
      expect(calls[0][1]).not.toHaveProperty("backup");
    });
  });
});
