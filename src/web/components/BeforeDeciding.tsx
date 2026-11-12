/**
 * Deciding a card whose conversation isn't summarized on this machine (#0019 `wait`, and
 * 20261111is21 `wait` for "Decide this as my answer"): first "Writing a summary…", then
 *
 *   ┌ Before deciding: summary of your conversation ─────────────┐
 *   │ (the agent's summary, editable)                             │
 *   │ [Save and decide  ⏎]   [Decide without summary]   [Esc]      │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Save and decide is one `resolve` write carrying the summary; Decide without summary is
 * today's Decide, closing the conversation as "Close without summary" does (20261112hq3k);
 * Esc goes back to the card without deciding. It sits where the action bar
 * is, and while it is open it is a key layer: Esc and Enter (off the text box) work, nothing
 * else on the page does. CardView holds the state and does the writes.
 */
import { useEffect, useRef } from "react";
import { useKeyLayer } from "../keyboard.ts";

const TITLE = "Before deciding: summary of your conversation";

/** A hub message as a sentence: they have no final period. */
const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export function BeforeDeciding(props: {
  /** The summary is being written. */
  writing: boolean;
  /** Why no summary could be written, when it couldn't. */
  error: string | undefined;
  /** Another summary run was going (the panel's Write summary); it fills the box if empty. */
  summaryRunning: boolean;
  summary: string;
  onSummary: (summary: string) => void;
  busy: boolean;
  onSaveAndDecide: () => void;
  onDecideWithout: () => void;
  onCancel: () => void;
}) {
  const { writing, busy } = props;
  const canSave = !writing && !busy && props.summary.trim() !== "";
  const saveButton = useRef<HTMLButtonElement>(null);
  const summaryBox = useRef<HTMLTextAreaElement>(null);
  // Once the summary is there, focus Save and decide, so Enter takes it as the sketch says.
  // Without one (it failed, or came back empty) Save is off: focus the box to write one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once the summary is written
  useEffect(() => {
    if (writing) return;
    if (props.summary.trim()) saveButton.current?.focus();
    else summaryBox.current?.focus();
  }, [writing]);
  useKeyLayer(
    {
      escape: props.onCancel,
      enter: () => {
        if (!canSave) return false;
        props.onSaveAndDecide();
      },
    },
    true,
  );
  return (
    <div className="action-bar action-bar-open">
      <form
        className="action-bar-inner action-panel before-deciding"
        aria-labelledby="before-deciding-label"
        aria-busy={writing}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) props.onSaveAndDecide();
        }}
      >
        {/* A label only once its text box is there; until then it names the form alone. */}
        {writing ? (
          <span className="action-panel-label" id="before-deciding-label">
            {TITLE}
          </span>
        ) : (
          <label
            htmlFor="before-deciding-summary"
            className="action-panel-label"
            id="before-deciding-label"
          >
            {TITLE}
          </label>
        )}
        {writing ? (
          <p className="muted" role="status">
            Writing a summary…
          </p>
        ) : (
          <>
            <p className="muted small">
              {props.error && !props.summary.trim()
                ? `Couldn't write the summary: ${sentence(props.error)} Write one yourself, or decide without it.`
                : props.summaryRunning && !props.summary.trim()
                  ? "The agent is already writing a summary; it appears here when it's done, unless you write one first. Or decide without it."
                  : "Edit it if needed. It is added to the card's history as a conversation summary, in the same write as your decision."}
            </p>
            <textarea
              id="before-deciding-summary"
              ref={summaryBox}
              rows={5}
              value={props.summary}
              onChange={(event) => props.onSummary(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (canSave) props.onSaveAndDecide();
                }
              }}
            />
          </>
        )}
        <div className="action-panel-buttons">
          <button
            type="submit"
            className="button button-primary"
            ref={saveButton}
            disabled={!canSave}
          >
            Save and decide <kbd>⏎</kbd>
          </button>
          <button
            type="button"
            className="button"
            disabled={writing || busy}
            onClick={props.onDecideWithout}
          >
            Decide without summary
          </button>
          <button
            type="button"
            className="button"
            aria-label="Back to the card without deciding (Esc)"
            onClick={props.onCancel}
          >
            <kbd>Esc</kbd>
          </button>
        </div>
      </form>
    </div>
  );
}
