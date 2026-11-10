import { useCallback, useEffect, useRef, useState } from "react";
import type { CardAction } from "../../core/actions.ts";
import type { BrokenCardDto, CardDetailDto, CardDto } from "../../core/api.ts";
import { CUSTOM_CHOICE } from "../../core/model.ts";
import { buildQueue, openDependencies, unknownDependencies } from "../../core/queue.ts";
import { api, RequestError } from "../api.ts";
import { wroteHere } from "../app-writes.ts";
import { describeChanges } from "../card-changes.ts";
import { CardAssistant } from "../components/CardAssistant.tsx";
import { FeedbackHistory } from "../components/FeedbackHistory.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { OptionCard } from "../components/OptionCard.tsx";
import { type Draft, unsentText, useDraft } from "../drafts.ts";
import { fullDate, KIND_LABEL, optionLabel, PRIORITY_LABEL, timeAgo } from "../format.ts";
import { useHub } from "../hub.tsx";
import { type KeyMap, useKeyboard, useKeyLayer } from "../keyboard.ts";
import { cardPath, Link, navigate } from "../router.tsx";
import { useDismissToasts, useToast } from "../toast.tsx";

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "broken"; broken: BrokenCardDto }
  | { state: "ok"; card: CardDetailDto };

type Panel = "neither" | "note" | null;

/**
 * Who changed the card since the human last read it: an agent (or someone editing the file),
 * or the human themselves in another president tab.
 */
type ChangedBy = "agent" | "other-tab";

/** How many views of each card are mounted ("project/id"). */
const openViews = new Map<string, number>();

export function CardView({ project, id }: { project: string; id: string }) {
  const hub = useHub();
  const toast = useToast();
  const dismissToasts = useDismissToasts();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // `latest` is read inside async callbacks, where `draft` would be stale.
  const [draft, updateDraft, latest] = useDraft(project, id);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [changedBy, setChangedBy] = useState<ChangedBy | null>(null);
  /** Set when a change on disk cleared the option the human had picked. */
  const [choiceCleared, setChoiceCleared] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const version = (hub.versions[project] ?? 0) + hub.reconnects;
  const undoGroup = `undo:${project}/${id}`;

  const queue = buildQueue(hub.cards, hub.projectFilter);
  const position = queue.findIndex((c) => c.project === project && c.id === id);

  /** The human has read this version: from now on actions are taken on it. */
  const acknowledge = useCallback(
    (card: CardDetailDto) => {
      updateDraft({ seen: card });
      setChangedBy(null);
      setChoiceCleared(false);
    },
    [updateDraft],
  );

  /** Loads the card; true if it changed in a way the human has to read again. */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const seen = latest.current.seen;
      const res = await api.card(project, id, seen?.revision);
      if (!res.ok) {
        setLoaded({ state: "broken", broken: res.broken });
        return false;
      }
      const card = res.card;
      setLoaded({ state: "ok", card });
      if (seen?.revision === card.revision) return false;
      // First load, our own action (here, or undone from a toast), or nothing the human has
      // to look at again (an agent marking notes read): nothing to point out.
      if (
        !seen ||
        wroteHere(project, id, card.revision) ||
        describeChanges(seen, card).length === 0
      ) {
        acknowledge(card);
        return false;
      }
      // The human hasn't read this version: actions keep carrying the revision they read,
      // so the server refuses them until they acknowledge the change. The server knows
      // whether only president (the human, in another tab) changed it since.
      setChangedBy(card.writtenByPresident ? "other-tab" : "agent");
      if (latest.current.selected) {
        // The options may now mean something else: never keep a choice made on the old text.
        updateDraft({ selected: undefined });
        setChoiceCleared(true);
      }
      return true;
    } catch (error) {
      setLoaded({ state: "error", message: (error as Error).message });
      return false;
    }
  }, [project, id, acknowledge, updateDraft, latest]);

  // Load on open and again whenever this project's files change on disk.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refetch trigger
  useEffect(() => {
    void load();
  }, [load, version]);

  const card = loaded.state === "ok" ? loaded.card : undefined;
  const fm = card?.frontmatter;
  const seen = draft.seen;
  const changes = card && seen && changedBy ? describeChanges(seen, card) : [];

  // Forget a selection whose option an agent removed.
  useEffect(() => {
    if (fm && draft.selected && !fm.options.some((o) => o.id === draft.selected)) {
      updateDraft({ selected: undefined });
    }
  }, [fm, draft.selected, updateDraft]);

  // Move focus to the new card's title, so keyboard and screen reader users start there.
  const ready = loaded.state !== "loading";
  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [ready]);

  // Leaving the card with unsent text keeps it (drafts.ts); say so, so nobody retypes it.
  useEffect(() => {
    const key = `${project}/${id}`;
    openViews.set(key, (openViews.get(key) ?? 0) + 1);
    return () => {
      openViews.set(key, (openViews.get(key) ?? 1) - 1);
      // Checked a moment later: React's StrictMode unmounts and mounts again at once.
      setTimeout(() => {
        if (!openViews.get(key) && unsentText(latest.current)) {
          toast(`What you typed on #${id} is kept; it's there when you come back.`);
        }
      }, 0);
    };
  }, [project, id, toast, latest]);

  const goTo = (target: CardDto | undefined) => {
    if (target) navigate(cardPath(target.project, target.id));
  };
  /** Where to go once this card leaves the queue. */
  const afterThis = (): CardDto | undefined => {
    if (position === -1) return queue.find((c) => !(c.project === project && c.id === id));
    return queue[position + 1] ?? queue[position - 1];
  };

  const act = async (
    action: CardAction,
    options: { leave?: boolean; done?: string; sent?: Partial<Draft> } = {},
  ) => {
    if (!card || !seen || busy) return false;
    setBusy(true);
    const next = afterThis();
    // A new action on this card makes an older undo for it meaningless.
    dismissToasts(undoGroup);
    try {
      // The revision the human read, not the newest one: if the card changed since, the
      // server refuses, and they see what changed first.
      const res = await api.act(project, id, action, seen.revision);
      setLoaded({ state: "ok", card: res.card });
      acknowledge(res.card);
      if (options.sent) updateDraft(options.sent);
      void hub.refresh();
      if (options.done) {
        const after = res.card.revision;
        const undo =
          action.type === "resolve" || action.type === "defer" || action.type === "neither"
            ? {
                label: "Undo",
                key: "u",
                run: () => {
                  api
                    .undo(project, id, after)
                    .then(() => {
                      hub.cardsChanged(project);
                      return hub.refresh();
                    })
                    .then(() => {
                      navigate(cardPath(project, id));
                      toast(`Undone. #${id} is back as it was.`);
                    })
                    .catch((error: Error) =>
                      toast(`Couldn't undo: ${error.message}`, { tone: "error" }),
                    );
                },
              }
            : undefined;
        toast(options.done, { action: undo, group: undo ? undoGroup : undefined });
      }
      if (options.leave) {
        if (next) goTo(next);
        else {
          navigate("/");
          toast("That was the last card in the queue.");
        }
      }
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.code === "conflict") {
        const mustRead = await load();
        toast(
          mustRead
            ? "This card changed since you read it, so nothing was sent. See what changed at the top of the card; what you typed is kept."
            : "This card was updated on disk (nothing you need to read again), so nothing was sent. Please try again.",
          { tone: "error" },
        );
      } else {
        toast((error as Error).message, { tone: "error" });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const isActive = fm?.status === "open" || fm?.status === "deferred";
  const options = fm?.options ?? [];
  const selected = draft.selected;

  const decide = async (choice: string | undefined, note: string, sent: Partial<Draft>) => {
    if (!card || !fm || !choice) return;
    const option = fm.options.find((o) => o.id === choice);
    const label = option ? option.title : "your own answer";
    await act(
      { type: "resolve", choice, note: note.trim() || undefined },
      { leave: true, done: `Decided #${id}: ${label}.`, sent },
    );
  };

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!isActive || !option) return false;
    updateDraft({ selected: option.id });
    return undefined;
  };

  const openPanel = (next: Panel) => {
    setPanel(next);
  };
  /** Closes the Neither/Note panel. What was typed stays as a draft. */
  const closePanel = () => {
    if (panel && latest.current[panel].trim()) {
      toast(
        `Your ${panel === "neither" ? "answer" : "note"} is kept as a draft; press ${panel === "neither" ? "n" : "m"} to finish it.`,
      );
    }
    setPanel(null);
  };

  const keys: KeyMap = {
    j: () => goTo(position === -1 ? queue[0] : queue[position + 1]),
    k: () => goTo(position === -1 ? queue.at(-1) : queue[position - 1]),
    enter: () => {
      if (!selected) return false;
      void decide(selected, draft.decisionNote, { selected: undefined, decisionNote: "" });
    },
    n: () => {
      if (!isActive || options.length === 0) return false;
      openPanel("neither");
    },
    m: () => {
      if (!isActive) return false;
      openPanel("note");
    },
    d: () => {
      if (fm?.status !== "open") return false;
      // A shortcut must not act on the card without what the human typed for it.
      if (unsentText(draft)) {
        toast("You have typed something on this card that isn't sent. Send or clear it first.");
        return;
      }
      void act({ type: "defer" }, { leave: true, done: `Deferred #${id}.` });
    },
    escape: () => navigate("/"),
  };
  for (let i = 0; i < 9; i++) keys[String(i + 1)] = () => selectIndex(i);
  if (fm?.kind === "ab") {
    keys.a = () => selectIndex(0);
    keys.b = () => selectIndex(1);
  }
  useKeyboard(keys, loaded.state !== "loading");
  // While the Neither/Note panel is open, nothing else on the page reacts to keys.
  useKeyLayer({ escape: closePanel }, panel !== null);

  if (loaded.state === "loading") return <p className="muted">Loading…</p>;
  if (loaded.state === "error") {
    return (
      <div className="empty">
        <p>{loaded.message}</p>
        <Link to="/">Back to the queue</Link>
      </div>
    );
  }
  if (loaded.state === "broken") return <BrokenCard broken={loaded.broken} />;
  if (!card || !fm) return null;

  const sections = new Map(card.sections.options.map((s) => [s.id, s.markdown]));
  const blockers = openDependencies(card, hub.cards);
  const unknown = hub.loaded ? unknownDependencies(card, hub.cards) : [];
  const chosen = fm.resolution?.choice;
  const recommended = fm.recommendation
    ? options.findIndex((o) => o.id === fm.recommendation?.option)
    : -1;

  return (
    <div className={`page card-page${fm.kind === "ab" ? " card-page-wide" : ""}`}>
      <nav className="card-nav" aria-label="Queue navigation">
        <Link to="/" className="button button-quiet">
          ← Queue
        </Link>
        {position !== -1 && (
          <span className="muted small">
            {position + 1} of {queue.length}
          </span>
        )}
        <span className="card-nav-arrows">
          <button
            type="button"
            className="button button-quiet"
            disabled={position <= 0}
            onClick={() => goTo(queue[position - 1])}
          >
            Previous <kbd>k</kbd>
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={queue.length === 0 || position === queue.length - 1}
            onClick={() => goTo(position === -1 ? queue[0] : queue[position + 1])}
          >
            Next <kbd>j</kbd>
          </button>
        </span>
      </nav>

      <header className="card-header">
        <p className="card-meta">
          <span>{project}</span>
          <span>#{card.id}</span>
          <span>{KIND_LABEL[fm.kind]}</span>
          <span className={`priority-label priority-label-${fm.priority}`}>
            {PRIORITY_LABEL[fm.priority]}
          </span>
          <span>
            by {fm.created_by},{" "}
            <time dateTime={fm.created} title={fullDate(fm.created)}>
              {timeAgo(fm.created)}
            </time>
          </span>
        </p>
        <h1 className="card-title" ref={heading} tabIndex={-1}>
          {fm.title}
          {position !== -1 && (
            <span className="sr-only">
              , card {position + 1} of {queue.length}
            </span>
          )}
        </h1>
        {fm.tags.length > 0 && (
          <p className="tags">
            {fm.tags.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: tags may repeat
              <span key={i} className="tag">
                {t}
              </span>
            ))}
          </p>
        )}
      </header>

      {changedBy && (
        <div
          className={`notice ${choiceCleared ? "notice-warn" : "notice-info"} notice-dismissable`}
          role="alert"
        >
          <div className="notice-body">
            <p>
              {changedBy === "agent"
                ? "An agent changed this card while you had it open."
                : "You changed this card in another president tab."}{" "}
              {choiceCleared
                ? "Your choice was cleared. Read it again before deciding."
                : "What you see now is the new version. Read what changed before you act on it."}
            </p>
            {changes.length > 0 && (
              <ul className="changes">
                {changes.map((change, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: descriptions may repeat
                  <li key={i}>{change}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="button" onClick={() => acknowledge(card)}>
            I've read it
          </button>
        </div>
      )}
      <StatusNotice card={card} />
      {blockers.length > 0 && isActive && (
        <p className="notice notice-warn">
          This depends on {blockers.map((b) => `#${b}`).join(", ")}, which{" "}
          {blockers.length === 1 ? "isn't" : "aren't"} decided yet.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="notice notice-warn">
          This card lists {unknown.map((b) => `#${b}`).join(", ")} in depends_on, but{" "}
          {unknown.length === 1 ? "that isn't another card" : "those aren't other cards"} in{" "}
          {project}. Ask an agent to fix it.
        </p>
      )}

      <Markdown className="card-context">{card.sections.context}</Markdown>

      {options.length > 0 && (
        <section aria-labelledby="options-heading">
          {fm.kind === "open" ? (
            <h2 id="options-heading" className="section-heading">
              Suggestions
            </h2>
          ) : (
            <h2 id="options-heading" className="sr-only">
              Options
            </h2>
          )}
          <div className={fm.kind === "ab" ? "options options-ab" : "options"}>
            {options.map((option, index) => (
              <OptionCard
                key={option.id}
                option={option}
                index={index}
                kind={fm.kind}
                details={sections.get(option.id)}
                recommended={index === recommended}
                selected={selected === option.id}
                chosen={chosen === option.id}
                selectable={isActive}
                onSelect={() => updateDraft({ selected: option.id })}
              />
            ))}
          </div>
        </section>
      )}

      {fm.recommendation && recommended !== -1 && (
        <aside className="recommendation" aria-label="Agent recommendation">
          <h2 className="section-heading">The agent's take</h2>
          <p>
            <strong>
              {optionLabel(recommended, fm.kind)}. {options[recommended]?.title}
            </strong>
            {" — "}
            {fm.recommendation.why}
          </p>
        </aside>
      )}

      <Markdown className="card-appendix">{card.sections.appendix}</Markdown>

      <FeedbackHistory feedback={fm.feedback} seenAt={fm.seen_at} />
      <CardAssistant card={card} />

      <p className="muted small file-path">
        File: <code>{card.path}</code>
      </p>

      <ActionBar
        card={card}
        busy={busy}
        draft={draft}
        onDraft={updateDraft}
        panel={panel}
        onPanel={(next) => (next ? openPanel(next) : closePanel())}
        onDiscard={() => {
          if (panel) updateDraft({ [panel]: "" });
          setPanel(null);
        }}
        onDecide={decide}
        onAct={act}
      />
    </div>
  );
}

function StatusNotice({ card }: { card: CardDetailDto }) {
  const fm = card.frontmatter;
  if (fm.status === "resolved" && fm.resolution) {
    const option = fm.options.find((o) => o.id === fm.resolution?.choice);
    return (
      <div className="notice notice-done">
        <p>
          <strong>Decided:</strong>{" "}
          {option
            ? option.title
            : fm.resolution.choice === CUSTOM_CHOICE
              ? "own answer"
              : fm.resolution.choice}
          {", "}
          <time dateTime={fm.resolution.resolved_at} title={fullDate(fm.resolution.resolved_at)}>
            {timeAgo(fm.resolution.resolved_at)}
          </time>
          .{" "}
          {fm.applied_at
            ? "An agent has applied it."
            : "Waiting for an agent to apply it to the project."}
        </p>
        {fm.resolution.note && <p className="resolution-note">{fm.resolution.note}</p>}
      </div>
    );
  }
  if (fm.status === "open" && fm.needs_new_options) {
    return (
      <p className="notice notice-info">
        You asked for different options. An agent will rewrite this card; you can still pick one of
        these.
      </p>
    );
  }
  if (fm.status === "deferred") {
    return (
      <p className="notice notice-info">Deferred. It stays out of the queue until reopened.</p>
    );
  }
  return null;
}

function ActionBar(props: {
  card: CardDetailDto;
  busy: boolean;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  onDiscard: () => void;
  onDecide: (choice: string | undefined, note: string, sent: Partial<Draft>) => void;
  onAct: (
    action: CardAction,
    options?: { leave?: boolean; done?: string; sent?: Partial<Draft> },
  ) => Promise<boolean>;
}) {
  const { card, busy, draft, panel } = props;
  const { selected, answer } = draft;
  const fm = card.frontmatter;
  const neitherButton = useRef<HTMLButtonElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const lastPanel = useRef<Panel>(null);

  useEffect(() => {
    // When a panel closes, put focus back on the button that opens it.
    if (!panel && lastPanel.current === "neither") neitherButton.current?.focus();
    else if (!panel && lastPanel.current === "note") noteButton.current?.focus();
    lastPanel.current = panel;
  }, [panel]);

  if (fm.status === "resolved") {
    return (
      <div className="action-bar">
        <div className="action-bar-inner">
          <span className="muted">This decision is made.</span>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void props.onAct({ type: "reopen" }, { done: `Reopened #${card.id}.` })}
          >
            Reopen
          </button>
        </div>
      </div>
    );
  }

  const selectedIndex = fm.options.findIndex((o) => o.id === selected);
  const selectedOption = fm.options[selectedIndex];

  if (panel) {
    const neither = panel === "neither";
    const text = draft[panel];
    const submit = async () => {
      if (!text.trim()) return;
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
              ? "None of these. What's wrong with them, or what would you rather see?"
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
            <button type="submit" className="button button-primary" disabled={busy || !text.trim()}>
              {neither ? "Ask for new options" : "Add note"} <kbd>Ctrl ⏎</kbd>
            </button>
          </div>
        </form>
      </div>
    );
  }

  const isOpenKind = fm.kind === "open";
  const customAnswer = isOpenKind && !selectedOption;
  return (
    <div className="action-bar">
      <form
        className="action-bar-inner"
        onSubmit={(event) => {
          event.preventDefault();
          if (customAnswer) {
            props.onDecide(answer.trim() ? CUSTOM_CHOICE : undefined, answer, { answer: "" });
          } else {
            props.onDecide(selected, draft.decisionNote, {
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
                  Pick an option <kbd>1</kbd>–<kbd>{Math.min(fm.options.length, 9)}</kbd>
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
              disabled={busy}
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
          {fm.status === "open" ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void props.onAct({ type: "defer" }, { leave: true, done: `Deferred #${card.id}.` })
              }
            >
              Defer <kbd>d</kbd>
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

function BrokenCard({ broken }: { broken: BrokenCardDto }) {
  return (
    <div className="page">
      <nav className="card-nav">
        <Link to="/" className="button button-quiet">
          ← Queue
        </Link>
      </nav>
      <h1 className="card-title">This card is broken</h1>
      <p>
        <code>{broken.fileName}</code> in <strong>{broken.project}</strong> couldn't be read:
      </p>
      <ul className="broken">
        {broken.errors.map((error, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages may repeat
          <li key={i}>{error}</li>
        ))}
      </ul>
      <p className="muted">
        Ask an agent to fix the file. This page updates as soon as it's saved.
      </p>
    </div>
  );
}
