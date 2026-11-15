import { type RefObject, useEffect, useRef } from "react";
import type { CardAction } from "../../core/actions.ts";
import type { CardDetailDto } from "../../core/api.ts";
import { CUSTOM_CHOICE, KEYED_OPTIONS, withdrawalOf } from "../../core/model.ts";
import { isSnoozed, isWithdrawn } from "../../core/queue.ts";
import type { ActOptions, Panel } from "../card-actions.ts";
import type { Draft, Panel as DraftPanel } from "../drafts.ts";
import { fullDate, optionLabel } from "../format.ts";
import { DeferMenu } from "./DeferMenu.tsx";

export function ActionBar(props: {
  card: CardDetailDto;
  busy: boolean;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  onDiscard: () => void;
  onDecide: (
    choice: string | undefined,
    note: string,
    sent: Partial<Draft>,
    panel?: DraftPanel,
  ) => Promise<boolean>;
  onAct: (action: CardAction, options?: ActOptions) => Promise<boolean>;
  /** Decide (or "Decide this as my answer"), for focus after the "Before deciding" box. */
  decideButton: RefObject<HTMLButtonElement | null>;
  canDefer: boolean;
  onDefer: (until?: Date) => void;
  deferMenu: boolean;
  onDeferMenu: (open: boolean) => void;
  /** The card has a new-options run: Neither waits for it to end (one note at a time). */
  optionsRun: boolean;
}) {
  const { card, busy, draft, panel } = props;
  const { selected, answer } = draft;
  const fm = card.frontmatter;
  const neitherButton = useRef<HTMLButtonElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const deferMenuButton = useRef<HTMLButtonElement>(null);
  const lastPanel = useRef<Panel>(null);
  const lastMenu = useRef(false);

  useEffect(() => {
    // When a panel closes, put focus back on the button that opens it.
    if (!panel && lastPanel.current === "neither") neitherButton.current?.focus();
    else if (!panel && lastPanel.current === "note") noteButton.current?.focus();
    lastPanel.current = panel;
  }, [panel]);
  useEffect(() => {
    if (!props.deferMenu && lastMenu.current) deferMenuButton.current?.focus();
    lastMenu.current = props.deferMenu;
  }, [props.deferMenu]);

  if (panel) {
    const neither = panel === "neither";
    const text = draft[panel];
    /** #0010: settle the card with what was typed, as a custom answer. */
    const decideAsAnswer = async () => {
      if (!text.trim()) return;
      const ok = await props.onDecide(CUSTOM_CHOICE, text, { neither: "" }, "neither");
      if (ok) props.onPanel(null);
    };
    // One note at a time (2026111459oa): a new one waits for the options being written.
    const waits = neither && props.optionsRun;
    const submit = async () => {
      if (!text.trim() || waits) return;
      const sent = { [panel]: "" };
      const ok = await props.onAct(
        { type: neither ? "neither" : "note", note: text },
        neither
          ? { leave: true, done: `Asked for new options on #${card.id}.`, sent }
          : { done: "Note added.", sent },
      );
      if (ok) props.onPanel(null);
    };
    return (
      <div className="action-bar action-bar-open">
        <form
          className="action-bar-inner action-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="panel-text" className="action-panel-label">
            {neither
              ? "None of these. What would you rather see, or what is your answer?"
              : "Add a note for the agent"}
          </label>
          <textarea
            id="panel-text"
            // biome-ignore lint/a11y/noAutofocus: the panel opens on purpose to type into
            autoFocus
            rows={3}
            value={text}
            onChange={(event) => props.onDraft({ [panel]: event.target.value })}
            onKeyDown={(event) => {
              // Esc is handled by the panel's key layer (CardView), wherever focus is.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="action-panel-buttons">
            {text.trim() && (
              <button type="button" className="button button-quiet" onClick={props.onDiscard}>
                Discard
              </button>
            )}
            <button type="button" className="button" onClick={() => props.onPanel(null)}>
              Close <kbd>Esc</kbd>
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={busy || waits || !text.trim()}
              aria-describedby={waits ? "panel-waits" : undefined}
            >
              {neither ? "Ask for new options" : "Add note"} <kbd>Ctrl ⏎</kbd>
            </button>
            {neither && (
              <button
                type="button"
                className="button"
                ref={props.decideButton}
                disabled={busy || !text.trim()}
                onClick={() => void decideAsAnswer()}
              >
                Decide this as my answer
              </button>
            )}
          </div>
          {waits && (
            <p className="muted small" id="panel-waits">
              A new-options run is going on for this card; ask again once it has ended.
            </p>
          )}
        </form>
      </div>
    );
  }

  if (fm.status === "resolved") {
    // #0011: a note on a decided card keeps the decision and whether it was applied.
    return (
      <div className="action-bar">
        <div className="action-bar-inner">
          <span className="muted">This decision is made.</span>
          <span className="action-bar-secondary">
            <button
              ref={noteButton}
              type="button"
              className="button"
              disabled={busy}
              onClick={() => props.onPanel("note")}
            >
              Note… <kbd>m</kbd>
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void props.onAct(
                  { type: "reopen" },
                  {
                    // A decision keeps `withdrawn` (D), so the reopened card is open with the
                    // field and listed under Withdrawn by agents, not the queue (#0014).
                    done: withdrawalOf(fm)
                      ? `Reopened #${card.id}; it is still withdrawn by the agent, so it is listed under Withdrawn by agents.`
                      : `Reopened #${card.id}.`,
                  },
                )
              }
            >
              Reopen
            </button>
          </span>
        </div>
      </div>
    );
  }

  if (props.deferMenu && props.canDefer) {
    return (
      <DeferMenu busy={busy} onDefer={props.onDefer} onClose={() => props.onDeferMenu(false)} />
    );
  }

  const selectedIndex = fm.options.findIndex((o) => o.id === selected);
  const selectedOption = fm.options[selectedIndex];

  const isOpenKind = fm.kind === "open";
  const customAnswer = isOpenKind && !selectedOption;
  return (
    <div className="action-bar">
      <form
        className="action-bar-inner"
        onSubmit={(event) => {
          event.preventDefault();
          if (customAnswer) {
            void props.onDecide(answer.trim() ? CUSTOM_CHOICE : undefined, answer, { answer: "" });
          } else {
            void props.onDecide(selected, draft.decisionNote, {
              selected: undefined,
              decisionNote: "",
            });
          }
        }}
      >
        {customAnswer ? (
          <textarea
            className="answer"
            aria-label="Your answer"
            placeholder={
              fm.options.length > 0 ? "Pick a suggestion or write your answer" : "Your answer"
            }
            rows={2}
            value={answer}
            onChange={(event) => props.onDraft({ answer: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        ) : (
          <>
            <span className="choice-summary">
              {selectedOption ? (
                <>
                  <span className="option-key">{optionLabel(selectedIndex, fm.kind)}</span>
                  <span className="choice-title">{selectedOption.title}</span>
                </>
              ) : (
                <span className="muted">
                  Pick an option <kbd>1</kbd>–
                  <kbd>{Math.min(fm.options.length, KEYED_OPTIONS)}</kbd>
                </span>
              )}
            </span>
            <input
              className="decision-note"
              aria-label="Why (optional)"
              placeholder="Why? (optional)"
              value={draft.decisionNote}
              disabled={!selectedOption}
              onChange={(event) => props.onDraft({ decisionNote: event.target.value })}
            />
          </>
        )}
        <button
          type="submit"
          className="button button-primary"
          ref={props.decideButton}
          disabled={busy || (customAnswer ? !answer.trim() : !selectedOption)}
        >
          Decide <kbd>{customAnswer ? "Ctrl ⏎" : "⏎"}</kbd>
        </button>
        <span className="action-bar-secondary">
          {fm.options.length > 0 && (
            <button
              ref={neitherButton}
              type="button"
              className="button"
              disabled={busy || props.optionsRun}
              title={props.optionsRun ? "A new-options run is going on for this card" : undefined}
              onClick={() => props.onPanel("neither")}
            >
              Neither… <kbd>n</kbd>
            </button>
          )}
          <button
            ref={noteButton}
            type="button"
            className="button"
            disabled={busy}
            onClick={() => props.onPanel("note")}
          >
            Note… <kbd>m</kbd>
          </button>
          {props.canDefer ? (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => props.onDefer()}
              >
                Defer a week <kbd>d</kbd>
              </button>
              <button
                ref={deferMenuButton}
                type="button"
                className="button"
                disabled={busy}
                onClick={() => props.onDeferMenu(true)}
              >
                Defer until… <kbd>D</kbd>
              </button>
            </>
          ) : isWithdrawn(card) ? (
            // #0014: removes the agent's `withdrawn` and adds a note; the status stays, so a
            // deferred card's date applies again (202611116ff6).
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void props.onAct(
                  { type: "unwithdraw" },
                  {
                    done: (after) => {
                      const until = after.frontmatter.defer_until;
                      return isSnoozed(after) && until
                        ? `#${card.id} is no longer withdrawn; it stays deferred until ${fullDate(until)}.`
                        : `Moved #${card.id} back to the queue.`;
                    },
                  },
                )
              }
            >
              Back to queue
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void props.onAct(
                  { type: "reopen" },
                  { done: `Moved #${card.id} back to the queue.` },
                )
              }
            >
              Back to queue
            </button>
          )}
        </span>
      </form>
    </div>
  );
}
