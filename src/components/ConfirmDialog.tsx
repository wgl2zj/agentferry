// 居中确认对话框（消息四通道之一）：高风险动作的统一"做决定"入口。
// 持续显示对象 / 影响 / 后果 / 目标状态；焦点打开进弹窗、Esc 关闭、关闭归还触发器。
import { useEffect, useRef, type ReactNode } from "react";
import { IconWarning } from "./icons";

export interface ConfirmPoint {
  /** 要点标签，如"对象""影响""后果""目标状态" */
  label: string;
  text: string;
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 危险动作样式（红系确认按钮 + 警告图标） */
  danger?: boolean;
  points: ConfirmPoint[];
  confirmText: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 额外正文（可选） */
  children?: ReactNode;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, title, danger, points, confirmText, cancelText, onConfirm, onCancel } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    // 记录触发器，打开后焦点进入弹窗
    triggerRef.current = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && panel) {
        // 简单焦点陷阱：Tab 在弹窗内循环，不落到被遮挡内容
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // 关闭后归还焦点给触发器
      const trigger = triggerRef.current;
      if (trigger instanceof HTMLElement) trigger.focus();
      triggerRef.current = null;
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="dialog-overlay">
      <div
        ref={panelRef}
        className={`dialog-panel${danger ? " dialog-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        tabIndex={-1}
      >
        <div className="dialog-head">
          {danger && (
            <span className="dialog-head-icon">
              <IconWarning size={20} />
            </span>
          )}
          <h2 id="confirm-dialog-title">{title}</h2>
        </div>
        <dl className="dialog-points">
          {points.map((p) => (
            <div key={p.label} className="dialog-point">
              <dt>{p.label}</dt>
              <dd>{p.text}</dd>
            </div>
          ))}
        </dl>
        {props.children}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelText ?? "取消"}
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
