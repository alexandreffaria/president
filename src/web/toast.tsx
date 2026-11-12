import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  group: string | undefined;
  onClose: (() => void) | undefined;
}

type ShowToast = (
  message: string,
  options?: {
    tone?: Toast["tone"];
    action?: ToastAction | undefined;
    durationMs?: number;
    /** Lets {@link useDismissToasts} remove it, e.g. "undo:demo/0001". */
    group?: string;
    /**
     * Called once when the toast goes away without its action being used: its time is up,
     * it was dismissed (×, or with its group), or newer toasts pushed it out. Ask for new
     * options starts its run then (20261112160s `wait-out`).
     */
    onClose?: () => void;
  },
) => void;

const ToastContext = createContext<{
  show: ShowToast;
  dismissGroup: (group: string) => void;
} | null>(null);

/**
 * Short notices in one polite live region. A toast with an action (Undo) stays longer,
 * its timer pauses while it is hovered or focused, and its action has a keyboard
 * shortcut, so nobody has to race the timer to reach it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // The toasts shown, read when one goes away (its onClose runs outside a state update).
  const current = useRef<Toast[]>([]);

  /** Shows `next`; the toasts it leaves out are closed, without their action if `used`. */
  const replace = useCallback((next: Toast[], used?: number) => {
    const gone = current.current.filter((t) => !next.includes(t));
    current.current = next;
    setToasts(next);
    for (const toast of gone) if (toast.id !== used) toast.onClose?.();
  }, []);

  const dismiss = useCallback(
    (id: number, used = false) => {
      replace(
        current.current.filter((t) => t.id !== id),
        used ? id : undefined,
      );
    },
    [replace],
  );

  const show = useCallback<ShowToast>(
    (message, options = {}) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        message,
        tone: options.tone ?? "info",
        action: options.action,
        durationMs: options.durationMs ?? (options.action ? 10_000 : 5000),
        group: options.group,
        onClose: options.onClose,
      };
      replace([...current.current.slice(-2), toast]);
    },
    [replace],
  );

  const dismissGroup = useCallback(
    (group: string) => {
      replace(current.current.filter((t) => t.group !== group));
    },
    [replace],
  );

  const context = useMemo(() => ({ show, dismissGroup }), [show, dismissGroup]);

  // The newest toast whose action has a shortcut answers that key.
  const keys: Record<string, () => unknown> = {};
  for (const toast of toasts) {
    const action = toast.action;
    if (action?.key) {
      keys[action.key] = () => {
        action.run();
        dismiss(toast.id, true);
      };
    }
  }
  useKeyboard(keys, Object.keys(keys).length > 0);

  return (
    <ToastContext.Provider value={context}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
            onUsed={() => dismiss(toast.id, true)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
  onUsed,
}: {
  toast: Toast;
  onDismiss: () => void;
  /** The action was used: the toast goes, without its onClose. */
  onUsed: () => void;
}) {
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
            onUsed();
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
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context.show;
}

/** Removes every toast of a group, e.g. an undo that no longer applies. */
export function useDismissToasts(): (group: string) => void {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useDismissToasts must be used inside <ToastProvider>");
  return context.dismissGroup;
}
