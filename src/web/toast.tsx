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
}

type ShowToast = (
  message: string,
  options?: {
    tone?: Toast["tone"];
    action?: ToastAction | undefined;
    durationMs?: number;
    /** Lets {@link useDismissToasts} remove it, e.g. "undo:demo/0001". */
    group?: string;
  },
) => void;

const ToastContext = createContext<{
  show: ShowToast;
  dismissGroup: (group: string) => void;
  shown: (group: string) => boolean;
} | null>(null);

/**
 * Short notices in one polite live region. A toast with an action (Undo) stays longer,
 * its timer pauses while it is hovered or focused, and its action has a keyboard
 * shortcut, so nobody has to race the timer to reach it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // The toasts shown, read outside a state update (`shown`).
  const current = useRef<Toast[]>([]);

  /** Shows `next`. */
  const replace = useCallback((next: Toast[]) => {
    current.current = next;
    setToasts(next);
  }, []);

  const dismiss = useCallback(
    (id: number) => replace(current.current.filter((t) => t.id !== id)),
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
      };
      const all = current.current;
      if (all.length < 3) {
        replace([...all, toast]);
        return;
      }
      // Three at most. A notice must not push an Undo out (the refusal to save a summary
      // during a decision's Undo would take that very Undo away): plain ones go first.
      const drop = all.find((t) => !t.action) ?? all[0];
      replace([...all.filter((t) => t !== drop), toast]);
    },
    [replace],
  );

  const dismissGroup = useCallback(
    (group: string) => {
      replace(current.current.filter((t) => t.group !== group));
    },
    [replace],
  );

  const shown = useCallback((group: string) => current.current.some((t) => t.group === group), []);

  const context = useMemo(() => ({ show, dismissGroup, shown }), [show, dismissGroup, shown]);

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
    <ToastContext.Provider value={context}>
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

/** Whether a toast of the group is on screen now (an Undo still within reach, say). */
export function useToastShown(): (group: string) => boolean {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToastShown must be used inside <ToastProvider>");
  return context.shown;
}
