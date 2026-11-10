import { useEffect, useRef } from "react";

/** Keys mapped to handlers; a handler returning false lets the event through. */
export type KeyMap = Record<string, (event: KeyboardEvent) => unknown>;

/** Elements where typing a character goes into the element. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

const ACTIVATING_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
]);

/**
 * Elements that do something themselves when Enter or Space is pressed on them: buttons,
 * links, `<summary>` and anything with an interactive ARIA role.
 */
export function activatesOnKey(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "SUMMARY") return true;
  if (tag === "A" && target.hasAttribute("href")) return true;
  const role = target.getAttribute("role");
  return role !== null && ACTIVATING_ROLES.has(role);
}

/** True while a modal dialog is open: page shortcuts must not act behind it. */
export function modalOpen(doc: Document = document): boolean {
  return doc.querySelector("dialog[open]") !== null;
}

/** The KeyMap name of a key: single characters as typed, named keys lowercase ("enter"). */
export function keyName(event: KeyboardEvent): string {
  return event.key.length > 1 ? event.key.toLowerCase() : event.key;
}

/**
 * Whether a page shortcut may handle this event. Never while typing in a field, while a
 * modal is open, with a modifier other than Shift (browser shortcuts keep working), or when
 * the focused element handles the key itself (Enter or Space on a button or link).
 */
export function shortcutAllowed(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.isComposing) return false;
  if (isTyping(event.target)) return false;
  const target = event.target instanceof Node ? event.target : null;
  if (modalOpen(target?.ownerDocument ?? document)) return false;
  const name = keyName(event);
  if ((name === "enter" || name === " ") && activatesOnKey(event.target)) return false;
  return true;
}

/**
 * Single-key shortcuts (j, k, 1-9, ?). Named keys are lowercase: "enter", "escape",
 * "arrowdown". See {@link shortcutAllowed} for when they are ignored.
 */
export function useKeyboard(keys: KeyMap, enabled = true): void {
  const ref = useRef(keys);
  ref.current = keys;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      const handler = ref.current[keyName(event)];
      if (handler && handler(event) !== false) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
