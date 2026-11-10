import { useEffect, useRef } from "react";

/** Keys mapped to handlers; a handler returning false lets the event through. */
export type KeyMap = Record<string, (event: KeyboardEvent) => unknown>;

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * Single-key shortcuts (j, k, 1-9, ?). Named keys are lowercase: "enter", "escape", "arrowdown".
 * Ignored while typing in a field or when a
 * modifier other than Shift is held, so browser shortcuts keep working.
 */
export function useKeyboard(keys: KeyMap, enabled = true): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;
      const name = event.key.length > 1 ? event.key.toLowerCase() : event.key;
      const handler = ref.current[name];
      if (handler && handler(event) !== false) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
