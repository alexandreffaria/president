import { useState } from "react";
import { dateInputValue, nextMonth, startOfDay, tomorrow } from "../snooze.ts";

/** #0017: "Defer until: [Next week] Tomorrow  Next month  Pick a date…" */
export function DeferMenu(props: {
  busy: boolean;
  onDefer: (until?: Date) => void;
  onClose: () => void;
}) {
  const { busy } = props;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const now = new Date();
  const earliest = dateInputValue(tomorrow(now));
  const pickedDay = startOfDay(picked);
  const pickedOk = pickedDay !== undefined && picked >= earliest;
  return (
    <div className="action-bar action-bar-open">
      <form
        className="action-bar-inner defer-menu"
        aria-labelledby="defer-menu-label"
        onSubmit={(event) => {
          event.preventDefault();
          if (pickedOk) props.onDefer(pickedDay);
        }}
      >
        <span className="action-panel-label" id="defer-menu-label">
          Defer until:
        </span>
        <button
          type="button"
          className="button button-primary"
          // biome-ignore lint/a11y/noAutofocus: the menu opens on purpose; Enter takes the default
          autoFocus
          disabled={busy}
          onClick={() => props.onDefer()}
        >
          Next week <kbd>⏎</kbd>
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => props.onDefer(tomorrow(new Date()))}
        >
          Tomorrow
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => props.onDefer(nextMonth(new Date()))}
        >
          Next month
        </button>
        {picking ? (
          <>
            <input
              type="date"
              aria-label="Date to bring the card back"
              // biome-ignore lint/a11y/noAutofocus: shown on purpose to pick a date
              autoFocus
              min={earliest}
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
            />
            <button type="submit" className="button" disabled={busy || !pickedOk}>
              Defer
            </button>
          </>
        ) : (
          <button type="button" className="button" disabled={busy} onClick={() => setPicking(true)}>
            Pick a date…
          </button>
        )}
        <button type="button" className="button button-quiet" onClick={props.onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </form>
    </div>
  );
}
