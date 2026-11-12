import { type ReactNode, useEffect, useRef, useState } from "react";
import type { BrokenCardDto, CardDto } from "../../core/api.ts";
import {
  buildQueue,
  isBackFromDeferral,
  isSnoozed,
  isWaitingOnAgent,
  openDependencies,
} from "../../core/queue.ts";
import { useHeadingFocus } from "../focus.ts";
import { fullDate, KIND_LABEL, PRIORITY_LABEL, timeAgo } from "../format.ts";
import { useHub } from "../hub.tsx";
import { useKeyboard } from "../keyboard.ts";
import { cardPath, Link, navigate } from "../router.tsx";

export function QueueView() {
  const hub = useHub();
  const { cards, broken, projects, projectFilter, setProjectFilter } = hub;
  const queue = buildQueue(cards, projectFilter);
  const inFilter = (c: { project: string }) => !projectFilter || c.project === projectFilter;
  const waiting = cards.filter((c) => isWaitingOnAgent(c) && inFilter(c));
  // Deferred cards whose date hasn't passed; the others are back in the queue (#0017).
  const deferred = cards.filter((c) => isSnoozed(c) && inFilter(c));
  const brokenHere = broken.filter(inFilter);
  const [selected, setSelected] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useHeadingFocus(heading, hub.loaded);

  useEffect(() => {
    if (selected >= queue.length) setSelected(Math.max(0, queue.length - 1));
  }, [queue.length, selected]);

  const move = (step: 1 | -1) =>
    setSelected((i) => Math.max(0, Math.min(i + step, queue.length - 1)));
  useKeyboard({
    j: () => move(1),
    k: () => move(-1),
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    enter: () => {
      const card = queue[selected];
      if (!card) return false;
      navigate(cardPath(card.project, card.id));
    },
  });

  if (!hub.loaded) return <p className="muted">Loading…</p>;
  // The shell shows the error itself (see LoadErrorBanner).
  if (hub.loadError && cards.length === 0) return null;

  const openCount = (project: string) => buildQueue(cards, project).length;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title" ref={heading} tabIndex={-1}>
          Queue
        </h1>
        <p className="muted">
          {queue.length === 0
            ? "Nothing waiting for you."
            : `${queue.length} ${queue.length === 1 ? "decision" : "decisions"} waiting${
                projectFilter ? ` in ${projectFilter}` : ""
              }.`}
        </p>
      </div>

      {projects.length > 1 && (
        <fieldset className="filters">
          <legend className="sr-only">Filter by project</legend>
          <button
            type="button"
            className={!projectFilter ? "chip chip-active" : "chip"}
            aria-pressed={!projectFilter}
            onClick={() => setProjectFilter(undefined)}
          >
            All <span className="count">{buildQueue(cards).length}</span>
          </button>
          {projects.map((p) => (
            <button
              key={p.name}
              type="button"
              className={projectFilter === p.name ? "chip chip-active" : "chip"}
              aria-pressed={projectFilter === p.name}
              onClick={() => setProjectFilter(p.name)}
            >
              {p.name} <span className="count">{openCount(p.name)}</span>
            </button>
          ))}
        </fieldset>
      )}

      {hub.projectErrors.map((e) => (
        <p key={e.project} className="notice notice-warn">
          <strong>{e.project}:</strong> {e.error}
        </p>
      ))}

      {projects.length === 0 ? (
        <div className="empty">
          <p>No projects yet.</p>
          <p className="muted">
            Register a project folder on the <Link to="/projects">Projects</Link> page, or let an
            agent run <code>preside add &lt;path&gt;</code>.
          </p>
        </div>
      ) : queue.length === 0 ? (
        <div className="empty">
          <p>You're all caught up.</p>
          <p className="muted">New cards appear here as soon as an agent writes them.</p>
        </div>
      ) : (
        <ol className="queue">
          {queue.map((card, i) => (
            <QueueItem
              key={`${card.project}/${card.id}`}
              card={card}
              blockers={openDependencies(card, cards)}
              showProject={!projectFilter && projects.length > 1}
              selected={i === selected}
            />
          ))}
        </ol>
      )}

      {waiting.length > 0 && (
        <section className="section">
          <h2 className="section-heading">Waiting for new options</h2>
          <p className="muted small">
            You asked for different options. An agent will rewrite these cards.
          </p>
          <ul className="compact-list">
            {waiting.map((card) => (
              <CompactItem key={`${card.project}/${card.id}`} card={card} />
            ))}
          </ul>
        </section>
      )}

      {deferred.length > 0 && (
        <details className="section">
          <summary className="section-heading">Deferred ({deferred.length})</summary>
          <ul className="compact-list">
            {deferred.map((card) => (
              <CompactItem
                key={`${card.project}/${card.id}`}
                card={card}
                note={backOn(card.frontmatter.defer_until)}
              />
            ))}
          </ul>
        </details>
      )}

      {brokenHere.length > 0 && <BrokenList broken={brokenHere} />}
    </div>
  );
}

function QueueItem(props: {
  card: CardDto;
  blockers: string[];
  showProject: boolean;
  selected: boolean;
}) {
  const { card, selected } = props;
  const fm = card.frontmatter;
  const item = useRef<HTMLLIElement>(null);
  // Keep the keyboard selection in view.
  useEffect(() => {
    if (selected) item.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <li ref={item} className={selected ? "queue-item queue-item-selected" : "queue-item"}>
      <Link
        to={cardPath(card.project, card.id)}
        className="queue-link"
        aria-current={selected ? "true" : undefined}
      >
        <span
          className={`priority priority-${fm.priority}`}
          title={PRIORITY_LABEL[fm.priority]}
          aria-hidden="true"
        />
        <span className="queue-main">
          <span className="queue-title">{fm.title}</span>
          <span className="sr-only">, {PRIORITY_LABEL[fm.priority]}</span>
          <span className="queue-meta">
            {props.showProject && <span>{card.project}</span>}
            <span>#{card.id}</span>
            <span>{KIND_LABEL[fm.kind]}</span>
            <time dateTime={fm.created} title={fullDate(fm.created)}>
              {timeAgo(fm.created)}
            </time>
            {fm.feedback.length > 0 && (
              <span>
                {fm.feedback.length} {fm.feedback.length === 1 ? "note" : "notes"}
              </span>
            )}
            {isBackFromDeferral(card) && <span className="back">back from deferral</span>}
            {props.blockers.length > 0 && (
              <span className="blocked">
                depends on {props.blockers.map((id) => `#${id}`).join(", ")}
              </span>
            )}
          </span>
        </span>
        {fm.tags.length > 0 && (
          <span className="tags">
            {fm.tags.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: tags may repeat
              <span key={i} className="tag">
                {t}
              </span>
            ))}
          </span>
        )}
      </Link>
    </li>
  );
}

function CompactItem({ card, note }: { card: CardDto; note?: ReactNode }) {
  return (
    <li>
      <Link to={cardPath(card.project, card.id)}>{card.frontmatter.title}</Link>{" "}
      <span className="muted small">
        {card.project} #{card.id}
        {note && <> · {note}</>}
      </span>
    </li>
  );
}

/** "back in 5 days", for a snoozed card in the Deferred list. */
function backOn(until: string | undefined): ReactNode {
  if (!until) return undefined;
  return (
    <>
      back{" "}
      <time dateTime={until} title={fullDate(until)}>
        {timeAgo(until)}
      </time>
    </>
  );
}

function BrokenList({ broken }: { broken: BrokenCardDto[] }) {
  return (
    <section className="section">
      <h2 className="section-heading">Broken cards ({broken.length})</h2>
      <p className="muted small">
        These files couldn't be read as cards. Ask an agent to fix them;{" "}
        <code>preside validate</code> shows the same errors.
      </p>
      <ul className="broken-list">
        {broken.map((b) => (
          <li key={`${b.project}/${b.fileName}`} className="broken">
            <div>
              <strong>{b.fileName}</strong> <span className="muted small">{b.project}</span>
            </div>
            <ul>
              {b.errors.map((error, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: messages may repeat
                <li key={i}>{error}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
