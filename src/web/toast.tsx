import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from "react";

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: { label: string; run: () => void } | undefined;
}

type ShowToast = (
  message: string,
  options?: { tone?: Toast["tone"]; action?: Toast["action"]; durationMs?: number },
) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (message, options = {}) => {
      const id = nextId.current++;
      const toast: Toast = { id, message, tone: options.tone ?? "info", action: options.action };
      setToasts((all) => [...all.slice(-2), toast]);
      window.setTimeout(() => dismiss(id), options.durationMs ?? (options.action ? 8000 : 5000));
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  toast.action?.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast must be used inside <ToastProvider>");
  return show;
}
