// 设计令牌完整性守护测试：锁住 tokens.css 唯一来源约定的关键令牌不缺失。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokensPath = resolve(process.cwd(), "src/styles/tokens.css");

describe("tokens.css 设计令牌完整性", () => {
  const css = readFileSync(tokensPath, "utf-8");

  it("包含浅色基底与表面对照的背景令牌", () => {
    for (const token of [
      "--color-bg-page",
      "--color-bg-surface",
      "--color-bg-subtle",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("包含五类语义状态令牌（中性/进行中/成功/警告/危险）", () => {
    for (const token of [
      "--color-info",
      "--color-success",
      "--color-warning",
      "--color-danger",
      "--color-border",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("包含间距、圆角、阴影与控件高度令牌", () => {
    for (const token of [
      "--space-1",
      "--space-6",
      "--radius-control",
      "--radius-card",
      "--shadow-card",
      "--shadow-overlay",
      "--control-height",
      "--control-height-dense",
    ]) {
      expect(css).toContain(token);
    }
  });

  it("base.css 遵循减少动态效果偏好", () => {
    const baseCss = readFileSync(resolve(process.cwd(), "src/styles/base.css"), "utf-8");
    expect(baseCss).toContain("prefers-reduced-motion");
  });
});
