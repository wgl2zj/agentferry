// 长任务进度条：阶段 + 文案 + current/total 真实进度，不用无限旋转替代。
import type { ProgressPayload } from "../lib/ipc";

/** 阶段中文映射：与后端 progress.rs / commands.rs 实际发射的 phase 字面量一致。 */
const PHASE_LABEL: Record<string, string> = {
  scanning: "扫描",
  packing: "打包",
  verifying: "校验",
  planning: "计划",
  applying: "执行",
  done: "完成",
};

export function ProgressBar(props: { progress: ProgressPayload | null; idleText: string }) {
  const p = props.progress;
  const now = p ? p.current : 0;
  const total = p && p.total > 0 ? p.total : 1;
  const percent = Math.round((now / total) * 100);
  return (
    <div className="progress-block">
      <div
        className="progress-track"
        role="progressbar"
        aria-label="任务进度"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={now}
        aria-valuetext={p ? `${p.message}，${now}/${total}` : props.idleText}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="progress-text" role="status">
        {p ? (
          <>
            <span className="progress-phase">{PHASE_LABEL[p.phase] ?? p.phase}</span>
            {p.message}
            <span className="progress-count">
              {now}/{total}（{percent}%）
            </span>
          </>
        ) : (
          props.idleText
        )}
      </p>
    </div>
  );
}
