// 状态标签：图标 + 文字 + 颜色三重表达，不只靠颜色区分状态。
import type { ReactNode } from "react";
import { IconCheck, IconError, IconInfo, IconSkip, IconWarning } from "./icons";

export type TagKind = "neutral" | "info" | "success" | "warning" | "danger";

const KIND_ICON: Record<TagKind, () => ReactNode> = {
  neutral: () => <IconInfo size={12} />,
  info: () => <IconInfo size={12} />,
  success: () => <IconCheck size={12} />,
  warning: () => <IconWarning size={12} />,
  danger: () => <IconError size={12} />,
};

export function StatusTag(props: { kind: TagKind; children: ReactNode; icon?: boolean }) {
  const showIcon = props.icon ?? true;
  return (
    <span className={`tag tag-${props.kind}`}>
      {showIcon && <span className="tag-icon">{KIND_ICON[props.kind]()}</span>}
      {props.children}
    </span>
  );
}

/** 跳过/不适用专用标签（中性灰 + 斜杠图标）。 */
export function SkipTag(props: { children: ReactNode }) {
  return (
    <span className="tag tag-neutral">
      <span className="tag-icon">
        <IconSkip size={12} />
      </span>
      {props.children}
    </span>
  );
}
