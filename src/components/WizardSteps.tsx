// 向导步骤条：可见步骤名 + 当前步骤语义（aria-current），状态同时以文字表达。
export function WizardSteps(props: { steps: string[]; current: number }) {
  return (
    <ol className="wizard-steps" aria-label="向导步骤">
      {props.steps.map((name, i) => {
        const state = i < props.current ? "done" : i === props.current ? "current" : "todo";
        return (
          <li
            key={name}
            className={`wizard-step wizard-step-${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="wizard-step-index" aria-hidden="true">
              {state === "done" ? "✓" : i + 1}
            </span>
            <span className="wizard-step-name">{name}</span>
            {state === "done" && <span className="sr-only">（已完成）</span>}
            {state === "current" && <span className="sr-only">（当前步骤）</span>}
          </li>
        );
      })}
    </ol>
  );
}
