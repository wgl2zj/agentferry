// 进度节流协议（引擎层纯逻辑）：逐文件回调 → 事件发射器按 50ms 节流过滤。
// 事件发射（webContents.send）在命令层完成；本模块只含可测的节流判定。

/** 引擎进度回调：(已完成文件数, 总文件数, 当前文件相对路径)。 */
export type ProgressFn = (done: number, total: number, rel: string) => void;

/** 进度事件载荷（task: pack / open / plan / apply / pathfix）。 */
export interface ProgressPayload {
  task: string;
  phase: string;
  message: string;
  current: number;
  total: number;
}

/** 同一任务两次进度发射的最小间隔（ms）。逐文件发射会让前端每文件整页重渲染。 */
const MIN_EMIT_INTERVAL_MS = 50;

/**
 * 进度发射节流器：与上次发射间隔不足阈值的中间事件丢弃；
 * 首条与末条（current === total）必发——进度条必须能启动并到 100%。
 */
export class ProgressThrottle {
  private last: number | null = null;

  /** `now` 由调用方注入（毫秒时间戳，测试构造时间序列用）。 */
  shouldEmit(now: number, current: number, total: number): boolean {
    const intervalOk = this.last === null || now - this.last >= MIN_EMIT_INTERVAL_MS;
    if (current === total || intervalOk) {
      this.last = now;
      return true;
    }
    return false;
  }
}

/** 把引擎的同步进度回调桥接为事件发射器（主进程使用）。
 *  经节流器过滤：引擎回调次数不变（每文件一次），事件按 50ms 节流发射。 */
export function bridge(
  emit: (payload: ProgressPayload) => void,
  task: string,
  phase: string,
): ProgressFn {
  const throttle = new ProgressThrottle();
  return (current, total, rel) => {
    if (throttle.shouldEmit(Date.now(), current, total)) {
      emit({ task, phase, message: rel, current, total });
    }
  };
}
