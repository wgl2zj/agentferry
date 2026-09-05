// @vitest-environment node
// 进度节流测试：Rust progress.rs 内联测试的逐条翻译。

import { describe, expect, it } from "vitest";
import { ProgressThrottle } from "./progress";

describe("progress_throttle_drops_close_events_but_keeps_first_and_last", () => {
  it("首条必发、间隔不足丢弃、超过间隔重发、末条必发", () => {
    const t0 = 1_000_000;
    const th = new ProgressThrottle();
    expect(th.shouldEmit(t0, 1, 100)).toBe(true);
    expect(th.shouldEmit(t0 + 10, 2, 100)).toBe(false);
    expect(th.shouldEmit(t0 + 20, 3, 100)).toBe(false);
    expect(th.shouldEmit(t0 + 60, 4, 100)).toBe(true);
    expect(th.shouldEmit(t0 + 61, 100, 100)).toBe(true);
  });

  it("progress_throttle_single_file_task_emits：单文件任务（current==total==1）首条即末条，必须发射", () => {
    const th = new ProgressThrottle();
    expect(th.shouldEmit(Date.now(), 1, 1)).toBe(true);
  });
});
