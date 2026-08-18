// 右上角 Toast 通道（消息四通道之一）：
// 成功/提示数秒自动消失；警告/错误不自动消失、必须手动关闭；相同内容不重复堆叠。
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconCheck, IconClose, IconError, IconInfo, IconWarning } from "./icons";

export type ToastKind = "success" | "info" | "warning" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

export interface ToastApi {
  show: (kind: ToastKind, text: string) => void;
  success: (text: string) => void;
  info: (text: string) => void;
  warning: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** 获取 Toast 通道 API；必须在 ToastProvider 内使用。 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

const KIND_ICON: Record<ToastKind, (p: { size?: number }) => ReactNode> = {
  success: () => <IconCheck />,
  info: () => <IconInfo />,
  warning: () => <IconWarning />,
  error: () => <IconError />,
};

const KIND_LABEL: Record<ToastKind, string> = {
  success: "成功",
  info: "提示",
  warning: "警告",
  error: "错误",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // 用 ref 做去重判定的权威副本，避免 setState updater 内放副作用。
  const itemsRef = useRef<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    itemsRef.current = itemsRef.current.filter((t) => t.id !== id);
    setItems(itemsRef.current);
  }, []);

  const show = useCallback(
    (kind: ToastKind, text: string) => {
      // 相同内容不重复堆叠
      if (itemsRef.current.some((t) => t.kind === kind && t.text === text)) return;
      const id = (idRef.current += 1);
      const item: ToastItem = { id, kind, text };
      itemsRef.current = [...itemsRef.current, item];
      setItems(itemsRef.current);
      // 轻量反馈自动消失；警告/错误必须手动关闭
      if (kind === "success" || kind === "info") {
        setTimeout(() => remove(id), 4000);
      }
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (t) => show("success", t),
      info: (t) => show("info", t),
      warning: (t) => show("warning", t),
      error: (t) => show("error", t),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="通知消息">
        {items.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            role={t.kind === "warning" || t.kind === "error" ? "alert" : "status"}
          >
            <span className="toast-icon">{KIND_ICON[t.kind]({})}</span>
            <span className="toast-text">
              <span className="toast-kind">{KIND_LABEL[t.kind]}：</span>
              {t.text}
            </span>
            <button
              type="button"
              className="toast-close"
              aria-label="关闭这条通知"
              onClick={() => remove(t.id)}
            >
              <IconClose size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
