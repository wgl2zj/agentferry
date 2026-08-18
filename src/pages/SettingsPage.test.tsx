// 设置页组件测试：设置加载展示 + 「浏览…」目录选择回填 + 保存调用契约。
// jsdom 无 __TAURI_INTERNALS__，自动走内置 mock；apiCall/pickDirectory 包 vi.fn 以便断言。
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMANDS } from "../lib/ipc";

vi.mock("../lib/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mock")>();
  return {
    ...actual,
    apiCall: vi.fn(actual.apiCall),
    pickDirectory: vi.fn(actual.pickDirectory),
  };
});

import { apiCall, pickDirectory } from "../lib/mock";
import { ToastProvider } from "../components/Toast";
import { SettingsPage } from "./SettingsPage";

function renderPage() {
  return render(
    <ToastProvider>
      <SettingsPage />
    </ToastProvider>,
  );
}

describe("设置页", () => {
  // vitest 未开 globals，RTL 无自动 cleanup，需显式清理避免跨用例 DOM 残留
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.mocked(apiCall).mockClear();
    vi.mocked(pickDirectory).mockReset();
    vi.mocked(pickDirectory).mockImplementation(async () => null);
  });

  it("加载设置并展示默认输出目录", async () => {
    renderPage();
    const input = await screen.findByLabelText("迁移包默认保存到");
    // 断言放 waitFor 内重试：loadSettings 走 mock 宏任务延迟，直接断言有加载竞态
    await waitFor(() => expect(input).toHaveValue("C:\\Users\\demo\\Downloads"));
  });

  it("「浏览…」选择目录后回填并进入未保存状态", async () => {
    // 宏任务模拟选目录耗时（微任务 setState 在 jsdom+React19 下不可见，项目 mock 均走 delay 宏任务）
    vi.mocked(pickDirectory).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0));
      return "E:\\U盘备份";
    });
    renderPage();
    const input = await screen.findByLabelText("迁移包默认保存到");
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(input).toHaveValue("E:\\U盘备份"));
    expect(screen.getByText("有未保存的修改")).toBeInTheDocument();
  });

  it("「浏览…」取消（返回 null）不改动当前值", async () => {
    renderPage();
    const input = await screen.findByLabelText("迁移包默认保存到");
    // 先等初始加载完成（消加载竞态），再验证取消不改动
    await waitFor(() => expect(input).toHaveValue("C:\\Users\\demo\\Downloads"));
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    await waitFor(() => expect(pickDirectory).toHaveBeenCalled());
    expect(input).toHaveValue("C:\\Users\\demo\\Downloads");
  });

  it("保存携带新目录调用 save_settings", async () => {
    vi.mocked(pickDirectory).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 0));
      return "E:\\U盘备份";
    });
    renderPage();
    await screen.findByLabelText("迁移包默认保存到");
    fireEvent.click(screen.getByRole("button", { name: "浏览…" }));
    const saveBtn = await screen.findByRole("button", { name: "保存设置" });
    await waitFor(() => expect(saveBtn).toBeEnabled());
    fireEvent.click(saveBtn);
    await waitFor(() => {
      const call = vi.mocked(apiCall).mock.calls.find((c) => c[0] === COMMANDS.saveSettings);
      expect(call?.[1]).toEqual({ settings: { default_output_dir: "E:\\U盘备份" } });
    });
  });
});
