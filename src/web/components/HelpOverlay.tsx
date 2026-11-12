import { useEffect, useRef } from "react";

export const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous card (or move in the queue)"],
  ["↓ / ↑", "Move in the queue"],
  ["Enter", "Open the selected card, or confirm your choice"],
  ["1 – 9", "Select an option (A / B also work on A/B cards)"],
  ["n", "Neither: reject all options and say why"],
  ["m", "Add a note"],
  ["d", "Defer the card"],
  [
    "u",
    "Undo the last action on the card: a decision, deferral, Neither, note or reopen (while its notice is shown)",
  ],
  ["s", "Sync: commit your answers in every project, pull, and push"],
  ["Esc", "Close a panel (what you typed is kept), or go back to the queue"],
  ["?", "Show or hide this help"],
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The keyboard help, as a modal dialog. While it is open, page shortcuts are off (see
 * keyboard.ts), Tab stays inside it, and Esc or `?` closes it and puts focus back where it
 * was.
 */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = dialog.current;
    const opener = document.activeElement;
    if (el && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    }
    el?.querySelector<HTMLElement>("button")?.focus();

    // Capture phase: the dialog sees these keys before anything else on the page.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "?") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab" && el) {
        trapTab(event, el);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (el?.open) el.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    // Keys are handled by the capture listener above; a click on the backdrop closes too.
    // The dialog's own Escape (the cancel event) also reports through onClose.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc and ? close it (see the effect)
    <dialog
      ref={dialog}
      className="help"
      aria-labelledby="help-heading"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <h2 id="help-heading">Keyboard shortcuts</h2>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="button" onClick={onClose}>
        Close
      </button>
    </dialog>
  );
}

/** Keeps Tab and Shift+Tab cycling through the dialog's own controls. */
function trapTab(event: globalThis.KeyboardEvent, dialog: HTMLElement): void {
  const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  const inside = dialog.contains(active);
  if (event.shiftKey && (active === first || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}
