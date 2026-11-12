import { unseenFeedback } from "../../core/pending.ts";
import type { FeedbackEntry } from "../../core/schema.ts";
import { fullDate, timeAgo } from "../format.ts";

const LABEL: Record<string, string> = {
  neither: "Asked for new options",
  note: "Note",
  defer: "Deferred",
  reopen: "Reopened",
  undo: "Decision taken back",
};

export function FeedbackHistory(props: { feedback: FeedbackEntry[]; seenAt: string | undefined }) {
  const { feedback } = props;
  if (feedback.length === 0) return null;
  const unseen = new Set(unseenFeedback({ feedback, seen_at: props.seenAt }));
  return (
    <section className="section" aria-labelledby="feedback-heading">
      <h2 id="feedback-heading" className="section-heading">
        History
      </h2>
      <ol className="feedback">
        {feedback.map((entry, i) => (
          // Entries are append-only, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <li key={i} className="feedback-entry">
            <div className="feedback-meta">
              <span className="feedback-type">{LABEL[entry.type ?? "note"] ?? "Note"}</span>
              <time dateTime={entry.at} title={fullDate(entry.at)}>
                {timeAgo(entry.at)}
              </time>
              {unseen.has(entry) && (
                <span
                  className="feedback-unseen"
                  title="Agents see it when they run `preside pending`"
                >
                  not read by an agent yet
                </span>
              )}
            </div>
            <p className="feedback-note">{entry.note}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
