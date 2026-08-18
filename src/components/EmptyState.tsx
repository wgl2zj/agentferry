// 空状态：必须说明"为什么为空"和"下一步做什么"，不只显示"暂无数据"。
import type { ReactNode } from "react";
import { IconFolder } from "./icons";

export function EmptyState(props: {
  title: string;
  reason: string;
  nextStep: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">
        <IconFolder size={28} />
      </span>
      <p className="empty-state-title">{props.title}</p>
      <p className="empty-state-reason">{props.reason}</p>
      <p className="empty-state-next">下一步：{props.nextStep}</p>
      {props.action && <div className="empty-state-action">{props.action}</div>}
    </div>
  );
}
