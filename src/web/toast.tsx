import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useKeyboard } from "./keyboard.ts";

interface ToastAction {
  label: string;
  run: () => void;
  /** A single-key shortcut that runs the action while the toast is shown (e.g. "u"). */
  key?: string;
}

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  action: ToastAction | undefined;
  durationMs: number;
}

type ShowToast = (
  message: string,
  options?: { tone?: Toast["tone"]; action?: ToastAction | undefined; durationMs?: number },
) => void;

const ToastContext = createContext<ShowToast | null>(null);

/**
 * Short notices in one polite live region. A toast with an action (Undo) stays longer,
 * its timer pauses while it is hovered or focused, and its action has a keyboard
 * shortcut, so nobody has to race the timer to reach it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>((message, options = {}) => {
    const id = nextId.current++;
    const toast: Toast = {
      id,
      message,
      tone: options.tone ?? "info",
      action: options.action,
      durationMs: options.durationMs ?? (options.action ? 10_000 : 5000),
    };
    setToasts((all) => [...all.slice(-2), toast]);
  }, []);

  // The newest toast whose action has a shortcut answers that key.
  const keys: Record<string, () => unknown> = {};
  for (const toast of toasts) {
    const action = toast.action;
    if (action?.key) {
      keys[action.key] = () => {
        action.run();
        dismiss(toast.id);
      };
    }
  }
  useKeyboard(keys, Object.keys(keys).length > 0);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const paused = hovered || focused;

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started));
    };
  }, [paused]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses the timer
    <div
      className={`toast toast-${toast.tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="button-link"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
          {toast.action.key && <kbd>{toast.action.key}</kbd>}
        </button>
      )}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
