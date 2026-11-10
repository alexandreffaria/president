import { useRef } from "react";
import type { CardDto } from "../../core/api.ts";
import { CUSTOM_CHOICE } from "../../core/model.ts";
import { buildLog } from "../../core/queue.ts";
import { useHeadingFocus } from "../focus.ts";
import { fullDate, optionLabel, timeAgo } from "../format.ts";
import { useHub } from "../hub.tsx";
import { cardPath, Link } from "../router.tsx";

/** The decision log: every resolved card, most recent first. */
export function LogView() {
  const { cards, loaded, projects, projectFilter, setProjectFilter } = useHub();
  const log = buildLog(cards, projectFilter);
  const heading = useRef<HTMLHeadingElement>(null);
  useHeadingFocus(heading, loaded);

  if (!loaded) return <p className="muted">Loading…</p>;
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title" ref={heading} tabIndex={-1}>
          Decisions
        </h1>
        <p className="muted">
          {log.length === 0
            ? "No decisions yet."
            : `${log.length} ${log.length === 1 ? "decision" : "decisions"} made${
                projectFilter ? ` in ${projectFilter}` : ""
              }.`}
        </p>
      </div>
      {projects.length > 1 && (
        <label className="select-filter">
          Project{" "}
          <select
            value={projectFilter ?? ""}
            onChange={(event) => setProjectFilter(event.target.value || undefined)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <ol className="log">
        {log.map((card) => (
          <LogItem key={`${card.project}/${card.id}`} card={card} />
        ))}
      </ol>
    </div>
  );
}

function LogItem({ card }: { card: CardDto }) {
  const fm = card.frontmatter;
  const resolution = fm.resolution;
  if (!resolution) return null;
  const index = fm.options.findIndex((o) => o.id === resolution.choice);
  const option = fm.options[index];
  return (
    <li className="log-item">
      <div className="log-head">
        <Link to={cardPath(card.project, card.id)} className="log-title">
          {fm.title}
        </Link>
        <span className="muted small">
          {card.project} #{card.id} ·{" "}
          <time dateTime={resolution.resolved_at} title={fullDate(resolution.resolved_at)}>
            {timeAgo(resolution.resolved_at)}
          </time>
        </span>
      </div>
      <p className="log-choice">
        {option ? (
          <>
            <span className="option-key">{optionLabel(index, fm.kind)}</span> {option.title}
          </>
        ) : resolution.choice === CUSTOM_CHOICE ? (
          <em>Own answer</em>
        ) : (
          resolution.choice
        )}
        {fm.applied_at ? (
          <span className="tag tag-applied" title={`Applied ${fullDate(fm.applied_at)}`}>
            applied
          </span>
        ) : (
          <span className="tag" title="An agent hasn't applied this decision yet">
            not applied yet
          </span>
        )}
      </p>
      {resolution.note && <p className="log-note">{resolution.note}</p>}
    </li>
  );
}
