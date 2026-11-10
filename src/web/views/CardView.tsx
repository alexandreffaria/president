import { useCallback, useEffect, useRef, useState } from "react";
import type { CardAction } from "../../core/actions.ts";
import type { BrokenCardDto, CardDetailDto, CardDto } from "../../core/api.ts";
import { CUSTOM_CHOICE } from "../../core/model.ts";
import { buildQueue, openDependencies, unknownDependencies } from "../../core/queue.ts";
import { api, RequestError } from "../api.ts";
import { CardAssistant } from "../components/CardAssistant.tsx";
import { FeedbackHistory } from "../components/FeedbackHistory.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { OptionCard } from "../components/OptionCard.tsx";
import { fullDate, KIND_LABEL, optionLabel, PRIORITY_LABEL, timeAgo } from "../format.ts";
import { useHub } from "../hub.tsx";
import { type KeyMap, useKeyboard } from "../keyboard.ts";
import { cardPath, Link, navigate } from "../router.tsx";
import { useToast } from "../toast.tsx";

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "broken"; broken: BrokenCardDto }
  | { state: "ok"; card: CardDetailDto };

type Panel = "neither" | "note" | null;

export function CardView({ project, id }: { project: string; id: string }) {
  const hub = useHub();
  const toast = useToast();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [selected, setSelected] = useState<string>();
  const [decisionNote, setDecisionNote] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  /** Set when an agent changed the card while it was open: "cleared" if a choice was undone. */
  const [changedOnDisk, setChangedOnDisk] = useState<"changed" | "cleared" | null>(null);
  const ownRevision = useRef<string | undefined>(undefined);
  /** What the human has started but not submitted, read when the card changes on disk. */
  const pending = useRef({ selected: undefined as string | undefined });
  pending.current.selected = selected;
  const heading = useRef<HTMLHeadingElement>(null);
  const version = hub.versions[project] ?? 0;

  const queue = buildQueue(hub.cards, hub.projectFilter);
  const position = queue.findIndex((c) => c.project === project && c.id === id);

  const currentRevision = useRef<string | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      const res = await api.card(project, id);
      if (!res.ok) {
        setLoaded({ state: "broken", broken: res.broken });
        return;
      }
      const previous = currentRevision.current;
      if (previous && previous !== res.card.revision && res.card.revision !== ownRevision.current) {
        // The options may now mean something else: never keep a choice made on the old text.
        if (pending.current.selected) {
          setSelected(undefined);
          setChangedOnDisk("cleared");
        } else {
          setChangedOnDisk((current) => current ?? "changed");
        }
      }
      currentRevision.current = res.card.revision;
      setLoaded({ state: "ok", card: res.card });
    } catch (error) {
      setLoaded({ state: "error", message: (error as Error).message });
    }
  }, [project, id]);

  // Load on open and again whenever this project's files change on disk.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refetch trigger
  useEffect(() => {
    void load();
  }, [load, version]);

  const card = loaded.state === "ok" ? loaded.card : undefined;
  const fm = card?.frontmatter;

  // Forget a selection whose option an agent removed.
  useEffect(() => {
    if (fm && selected && !fm.options.some((o) => o.id === selected)) setSelected(undefined);
  }, [fm, selected]);

  // Move focus to the new card's title, so keyboard and screen reader users start there.
  const ready = loaded.state !== "loading";
  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [ready]);

  const goTo = (target: CardDto | undefined) => {
    if (target) navigate(cardPath(target.project, target.id));
  };
  /** Where to go once this card leaves the queue. */
  const afterThis = (): CardDto | undefined => {
    if (position === -1) return queue.find((c) => !(c.project === project && c.id === id));
    return queue[position + 1] ?? queue[position - 1];
  };

  const act = async (action: CardAction, options: { leave?: boolean; done?: string } = {}) => {
    if (!card || busy) return false;
    setBusy(true);
    const next = afterThis();
    try {
      const res = await api.act(project, id, action, card.revision);
      ownRevision.current = res.card.revision;
      currentRevision.current = res.card.revision;
      setLoaded({ state: "ok", card: res.card });
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
                    .then((undone) => {
                      ownRevision.current = undone.card.revision;
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
        toast(options.done, { action: undo });
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
        toast("This card was changed on disk. It has been reloaded; please look again.", {
          tone: "error",
        });
        void load();
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

  const decide = async (choice: string | undefined, note: string) => {
    if (!card || !fm || !choice) return;
    const option = fm.options.find((o) => o.id === choice);
    const label = option ? option.title : "your own answer";
    const ok = await act(
      { type: "resolve", choice, note: note.trim() || undefined },
      { leave: true, done: `Decided #${id}: ${label}.` },
    );
    if (ok) {
      setSelected(undefined);
      setDecisionNote("");
    }
  };

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!isActive || !option) return false;
    setSelected(option.id);
    return undefined;
  };

  const keys: KeyMap = {
    j: () => goTo(position === -1 ? queue[0] : queue[position + 1]),
    k: () => goTo(position === -1 ? queue.at(-1) : queue[position - 1]),
    enter: () => {
      if (!selected) return false;
      void decide(selected, decisionNote);
    },
    n: () => {
      if (!isActive || options.length === 0) return false;
      setPanel("neither");
    },
    m: () => {
      if (!isActive) return false;
      setPanel("note");
    },
    d: () => {
      if (fm?.status !== "open") return false;
      void act({ type: "defer" }, { leave: true, done: `Deferred #${id}.` });
    },
    escape: () => {
      if (panel) setPanel(null);
      else navigate("/");
    },
  };
  for (let i = 0; i < 9; i++) keys[String(i + 1)] = () => selectIndex(i);
  if (fm?.kind === "ab") {
    keys.a = () => selectIndex(0);
    keys.b = () => selectIndex(1);
  }
  useKeyboard(keys, loaded.state !== "loading");

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

      {changedOnDisk && (
        <div
          className={`notice ${changedOnDisk === "cleared" ? "notice-warn" : "notice-info"} notice-dismissable`}
          role="alert"
        >
          <p>
            {changedOnDisk === "cleared"
              ? "An agent changed this card while you had it open, so your choice was cleared. Read it again before deciding."
              : "An agent changed this card while you had it open. What you see now is the new version."}
          </p>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setChangedOnDisk(null)}
          >
            Dismiss
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
                onSelect={() => setSelected(option.id)}
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
        selected={selected}
        decisionNote={decisionNote}
        onDecisionNote={setDecisionNote}
        panel={panel}
        onPanel={setPanel}
        onDecide={(choice, note) => void decide(choice, note)}
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
  selected: string | undefined;
  decisionNote: string;
  onDecisionNote: (note: string) => void;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  onDecide: (choice: string | undefined, note: string) => void;
  onAct: (action: CardAction, options?: { leave?: boolean; done?: string }) => Promise<boolean>;
}) {
  const { card, busy, selected, panel } = props;
  const fm = card.frontmatter;
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const neitherButton = useRef<HTMLButtonElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const lastPanel = useRef<Panel>(null);

  useEffect(() => {
    if (panel) setText("");
    // When a panel closes, put focus back on the button that opens it.
    else if (lastPanel.current === "neither") neitherButton.current?.focus();
    else if (lastPanel.current === "note") noteButton.current?.focus();
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
    const submit = async () => {
      if (!text.trim()) return;
      const ok = await props.onAct(
        { type: neither ? "neither" : "note", note: text },
        neither
          ? { leave: true, done: `Asked for new options on #${card.id}.` }
          : { done: "Note added." },
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
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              } else if (event.key === "Escape") {
                props.onPanel(null);
              }
            }}
          />
          <div className="action-panel-buttons">
            <button type="button" className="button" onClick={() => props.onPanel(null)}>
              Cancel <kbd>Esc</kbd>
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
          if (customAnswer) props.onDecide(answer.trim() ? CUSTOM_CHOICE : undefined, answer);
          else props.onDecide(selected, props.decisionNote);
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
            onChange={(event) => setAnswer(event.target.value)}
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
              value={props.decisionNote}
              disabled={!selectedOption}
              onChange={(event) => props.onDecisionNote(event.target.value)}
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
