// 顶部横幅通道（消息四通道之一）：重要且需要用户介入的信息，持久显示至手动关闭。
import type { ReactNode } from "react";
import { IconClose, IconError, IconInfo, IconWarning } from "./icons";

export type BannerKind = "info" | "warning" | "danger" | "success";

const KIND_ICON: Record<BannerKind, () => ReactNode> = {
  info: () => <IconInfo size={18} />,
  warning: () => <IconWarning size={18} />,
  danger: () => <IconError size={18} />,
  success: () => <IconInfo size={18} />,
};

export function Banner(props: {
  kind: BannerKind;
  title: string;
  children?: ReactNode;
  /** 右侧动作区（按钮等） */
  actions?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`banner banner-${props.kind}`} role="alert">
      <span className="banner-icon">{KIND_ICON[props.kind]()}</span>
      <div className="banner-body">
        <p className="banner-title">{props.title}</p>
        {props.children && <div className="banner-text">{props.children}</div>}
      </div>
      {props.actions && <div className="banner-actions">{props.actions}</div>}
      {props.onClose && (
        <button
          type="button"
          className="banner-close"
          aria-label="关闭这条提示"
          onClick={props.onClose}
        >
          <IconClose size={14} />
        </button>
      )}
    </div>
  );
}
