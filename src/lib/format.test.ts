// formatBytes 体量格式化测试。
import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes 体量格式化", () => {
  it("小于 1KB 直接以 B 显示", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("KB/MB 档保留一位小数（>=100 归整）", () => {
    expect(formatBytes(371 * 1024)).toBe("371 KB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
  });

  it("非法与负数输入回退为 0 B", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});
