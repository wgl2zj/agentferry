// 打包向导组件测试：步骤前进/回退流转 + 阻断类别横幅动作 + 档案选择（仅 ZCode，产品收窄）与凭据警告展示。
// jsdom 无桌面桥（window.agentferry），自动走内置 mock；apiCall 包一层 vi.fn 以便断言调用。
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../lib/ipc";

vi.mock("../lib/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mock")>();
  return {
    ...actual,
    apiCall: vi.fn(actual.apiCall),
    pickDirectory: vi.fn(async () => null),
  };
});

import { apiCall, pickDirectory, resetMockState } from "../lib/mock";
import { ToastProvider } from "../components/Toast";
import { PackWizard } from "./PackWizard";

function renderWizard() {
  return render(
    <ToastProvider>
      <PackWizard onExit={() => undefined} />
    </ToastProvider>,
  );
}

describe("打包向导步骤流转", () => {
  // vitest 未开 globals，RTL 无自动 cleanup，需显式清理避免跨用例 DOM 残留
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(apiCall).mockClear();
    vi.mocked(pickDirectory).mockClear();
    resetMockState();
  });

  it("四步可顺序前进，也可回退到上一步", async () => {
    renderWizard();

    // 第 1 步：等待档案卡加载（list_profiles mock）
    const heading = await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    expect(heading).toBeInTheDocument();
    expect(screen.getByLabelText("资产根目录")).toHaveValue("C:\\Users\\demo\\.zcode");

    // 前进到第 2 步：触发 scan_assets（先等数据行出现再取表格断言）
    fireEvent.click(screen.getByRole("button", { name: "下一步：扫描盘点" }));
    await screen.findByText(/全局规则/);
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("技能（skills/）");
    expect(table).toHaveTextContent("会话历史库");
    expect(vi.mocked(apiCall).mock.calls.some((c) => c[0] === COMMANDS.scanAssets)).toBe(true);

    // WAL 阻断横幅可见，且提供两个动作
    expect(screen.getByText(/暂时无法打包/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我已退出，重新检测" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳过该库继续" })).toBeInTheDocument();

    // 前进到第 3 步：档位三卡可见
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择档位与输出" }));
    expect(await screen.findByText("推荐（纯资产）")).toBeInTheDocument();
    expect(screen.getByText("完整（含会话历史）")).toBeInTheDocument();
    expect(screen.getByLabelText("迁移包输出路径")).toBeInTheDocument();

    // 回退到第 2 步，再回退到第 1 步
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(await screen.findByRole("table")).toHaveTextContent("会话历史库");
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(await screen.findByLabelText("资产根目录")).toBeInTheDocument();
  });

  it("阻断类别可跳过：跳过标记后横幅消失，状态变为已跳过", async () => {
    renderWizard();
    await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    fireEvent.click(screen.getByRole("button", { name: "下一步：扫描盘点" }));
    await screen.findByText(/全局规则/);

    fireEvent.click(screen.getByRole("button", { name: "跳过该库继续" }));
    await waitFor(() => {
      expect(screen.queryByText(/暂时无法打包/)).not.toBeInTheDocument();
    });
    expect(screen.getByText("已跳过")).toBeInTheDocument();
  });

  it("盘点表：阻断类别也显示文件数与体量，missing 类别显示 —", async () => {
    renderWizard();
    await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    fireEvent.click(screen.getByRole("button", { name: "下一步：扫描盘点" }));
    await screen.findByText(/全局规则/);

    // mock 数据：session_db 阻断（已收集文件，显示体量）、tasks_index missing（显示 —）
    const sessionRow = screen.getByRole("row", { name: /会话历史库/ });
    expect(sessionRow).toHaveTextContent("416 MB");
    const missingRow = screen.getByRole("row", { name: /任务索引/ });
    expect(missingRow).toHaveTextContent("—");
  });

  it("输出路径「浏览…」选择目录后拼回建议文件名", async () => {
    // 宏任务模拟选目录耗时（微任务 setState 在 jsdom+React19 下不可见，项目 mock 均走 delay 宏任务）
    vi.mocked(pickDirectory).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0));
      return "E:\\U盘";
    });
    renderWizard();
    await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    fireEvent.click(screen.getByRole("button", { name: "下一步：扫描盘点" }));
    await screen.findByText(/全局规则/);
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择档位与输出" }));
    const input = await screen.findByLabelText("迁移包输出路径");
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => {
      const value = (input as HTMLInputElement).value;
      expect(value).toMatch(/^E:\\U盘\//);
      expect(value).toMatch(/\.zam$/);
    });
  });
});

describe("打包向导：档案选择（仅 ZCode，产品收窄）", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(apiCall).mockClear();
    resetMockState();
  });

  it("第 1 步档案选择器仅 ZCode 一家，默认选中 ZCode（codex/claude 不出现）", async () => {
    renderWizard();
    // 先等档案卡出现（profiles 加载完成），再读选择器选项
    await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    const select = (await screen.findByLabelText("资产档案")) as HTMLSelectElement;
    const options = within(select).getAllByRole("option");
    // 产品收窄（spec 决策 1）：打包入口只出现 ZCode 一个档案
    expect(options.map((o) => o.textContent)).toEqual(["ZCode（26 类）"]);
    expect(select.value).toBe("zcode");
    // 反向断言：codex/claude 不得作为可选软件出现
    expect(options.some((o) => o.textContent?.includes("Codex"))).toBe(false);
    expect(options.some((o) => o.textContent?.includes("Claude"))).toBe(false);
  });

  it("建议输出文件名按档案动态生成（zcode-迁移包-日期.zam）", async () => {
    renderWizard();
    await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    fireEvent.click(screen.getByRole("button", { name: "下一步：扫描盘点" }));
    await screen.findByText(/全局规则/);
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择档位与输出" }));
    const output = (await screen.findByLabelText("迁移包输出路径")) as HTMLInputElement;
    expect(output.value).toMatch(/\/zcode-迁移包-\d{8}\.zam$/);
  });

  it("ZCode 推荐档含两个凭据类别，确认步骤出现点名具体字段的凭据横幅（v2）", async () => {
    renderWizard();
    await screen.findByRole("heading", { name: /ZCode 资产档案/ });
    fireEvent.click(screen.getByRole("button", { name: "下一步：扫描盘点" }));
    await screen.findByText(/全局规则/);
    fireEvent.click(screen.getByRole("button", { name: "下一步：选择档位与输出" }));
    await screen.findByText("推荐（纯资产）");
    // v2：推荐档自动包含 provider_config/openviking_state → 凭据横幅点名具体字段（与后端同源）
    expect(await screen.findByText("凭据随包迁移提醒")).toBeInTheDocument();
    expect(
      screen.getByText(
        "本包含 API 凭据：v2/provider_config.json 的 access.apiKey（嵌套字段）将随包迁移，请妥善保管迁移包",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("本包含 API 凭据：openviking/ 配置的 userKey 将随包迁移，请妥善保管迁移包"),
    ).toBeInTheDocument();
  });
});
