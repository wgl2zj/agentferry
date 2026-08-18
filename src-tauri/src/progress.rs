//! 进度事件协议：长任务（打包/校验/执行）通过 Tauri 事件汇报阶段与进度。
//! 事件名 `progress`，payload 见 `ProgressPayload`；前端经 `useBackendEvent` 类型化接收。

use serde::Serialize;

/// 进度事件载荷。`task` 标识任务来源，前端按任务过滤。
#[derive(Debug, Clone, Serialize)]
pub struct ProgressPayload {
    /// pack / open / plan / apply / pathfix。
    pub task: &'static str,
    /// 阶段：scanning / hashing / writing / verifying / done。
    pub phase: &'static str,
    /// 人类可读消息（中文）。
    pub message: String,
    pub current: usize,
    pub total: usize,
}

/// 发射一条进度事件（失败静默：进度丢失不阻断任务，错误走命令返回值）。
pub fn emit_progress(
    app: &tauri::AppHandle,
    task: &'static str,
    phase: &'static str,
    message: &str,
    current: usize,
    total: usize,
) {
    use tauri::Emitter;
    let _ = app.emit(
        "progress",
        ProgressPayload {
            task,
            phase,
            message: message.to_string(),
            current,
            total,
        },
    );
}

/// 同一任务两次进度发射的最小间隔。进度条 20fps 已足够平滑；逐文件发射
/// 会让前端每个文件整页重渲染一次，数千文件的 skills 目录会卡 UI。
const MIN_EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(50);

/// 进度发射节流器：与上次发射间隔不足 `MIN_EMIT_INTERVAL` 的中间事件丢弃；
/// 首条与末条（current == total）必发——进度条必须能启动并到 100%。
pub struct ProgressThrottle {
    last: Option<std::time::Instant>,
}

impl ProgressThrottle {
    pub fn new() -> Self {
        Self { last: None }
    }

    /// `now` 由调用方注入（测试构造时间序列用）。
    pub fn should_emit(&mut self, now: std::time::Instant, current: usize, total: usize) -> bool {
        let interval_ok = match self.last {
            None => true,
            Some(t) => now.duration_since(t) >= MIN_EMIT_INTERVAL,
        };
        if current == total || interval_ok {
            self.last = Some(now);
            true
        } else {
            false
        }
    }
}

impl Default for ProgressThrottle {
    fn default() -> Self {
        Self::new()
    }
}

/// 把引擎的同步进度回调桥接为事件发射器（spawn_blocking 线程内使用）。
/// 经节流器过滤：引擎回调次数不变（每文件一次），事件按 50ms 节流发射。
pub fn bridge(app: tauri::AppHandle, task: &'static str, phase: &'static str) -> impl FnMut(usize, usize, &str) {
    let mut throttle = ProgressThrottle::new();
    move |current, total, rel| {
        if throttle.should_emit(std::time::Instant::now(), current, total) {
            emit_progress(&app, task, phase, rel, current, total);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// 节流行为锁：首条必发、间隔不足丢弃、超过间隔重发、末条（current==total）必发。
    /// 防回归：一旦节流失效（逐文件发射），数千文件打包时 UI 逐事件整页重渲染。
    #[test]
    fn progress_throttle_drops_close_events_but_keeps_first_and_last() {
        let t0 = Instant::now();
        let mut th = ProgressThrottle::new();
        assert!(th.should_emit(t0, 1, 100), "首条必发");
        assert!(
            !th.should_emit(t0 + Duration::from_millis(10), 2, 100),
            "与首条间隔不足应丢弃"
        );
        assert!(
            !th.should_emit(t0 + Duration::from_millis(20), 3, 100),
            "间隔仍不足应丢弃"
        );
        assert!(
            th.should_emit(t0 + Duration::from_millis(60), 4, 100),
            "超过最小间隔应重发"
        );
        assert!(
            th.should_emit(t0 + Duration::from_millis(61), 100, 100),
            "末条必发（与上次发射间隔无关）"
        );
    }

    /// 单文件任务（current==total==1）首条即末条，必须发射。
    #[test]
    fn progress_throttle_single_file_task_emits() {
        let mut th = ProgressThrottle::new();
        assert!(th.should_emit(Instant::now(), 1, 1));
    }
}
