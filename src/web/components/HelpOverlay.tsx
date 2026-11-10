import { useEffect, useRef } from "react";

const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous card (or move in the queue)"],
  ["Enter", "Open the selected card, or confirm your choice"],
  ["1 – 9", "Select an option (A / B also work on A/B cards)"],
  ["n", "Neither: reject all options and say why"],
  ["m", "Add a note"],
  ["d", "Defer the card"],
  ["Esc", "Close a panel, or go back to the queue"],
  ["?", "Show or hide this help"],
];

export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    // The dialog closes itself on Escape and reports it through onClose.
    <dialog
      ref={dialog}
      className="help"
      aria-labelledby="help-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "?") onClose();
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
