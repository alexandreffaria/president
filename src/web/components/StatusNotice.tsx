import type { CardDetailDto, NewOptionsRunDto } from "../../core/api.ts";
import { CUSTOM_CHOICE, withdrawalOf } from "../../core/model.ts";
import { activeWithdrawal, isBackFromDeferral, isWaitingOnAgent } from "../../core/queue.ts";
import { clockTime, fullDate, timeAgo } from "../format.ts";

export function StatusNotice({
  card,
  newOptions,
}: {
  card: CardDetailDto;
  /** The new-options run (#0007), unless the "changed" notice already speaks of it. */
  newOptions: NewOptionsRunDto | undefined;
}) {
  const fm = card.frontmatter;
  if (fm.status === "open" && newOptions?.state === "written") {
    return (
      <p className="notice notice-info">
        New options, written from your note at {clockTime(newOptions.note)}.
      </p>
    );
  }
  if (isWaitingOnAgent(card) && newOptions?.state === "started") {
    return <p className="notice notice-info">Writing new options…</p>;
  }
  if (fm.status === "resolved" && fm.resolution) {
    const option = fm.options.find((o) => o.id === fm.resolution?.choice);
    // 20261112jdyg (quiet-line): a decision keeps `withdrawn` (#0014 D), and the withdrawal is
    // a field, not in the card's history, so say it under the decision, muted.
    const withdrawal = withdrawalOf(fm);
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
        {withdrawal && (
          <p className="withdrawal-note muted small">
            An agent had withdrawn this card: {withdrawal.reason}
          </p>
        )}
      </div>
    );
  }
  const newOptionsNotice = (
    <p className="notice notice-info">
      You asked for different options. An agent will rewrite this card; you can still pick one of
      these.
    </p>
  );
  // #0014: above the options, which still work. Shown instead of a deferred card's date,
  // which is ignored while the card is withdrawn (202611116ff6), but not instead of the
  // human's own request for new options.
  const withdrawal = activeWithdrawal(card);
  if (withdrawal) {
    return (
      <>
        <p className="notice notice-info">
          <strong>Withdrawn by the agent:</strong> {withdrawal.reason}
        </p>
        {fm.needs_new_options === true && newOptionsNotice}
      </>
    );
  }
  // Open, or back from deferral (R1-1): either way it waits on the agent.
  if (isWaitingOnAgent(card)) return newOptionsNotice;
  if (fm.status === "deferred") {
    // #0017 snooze; a deferred card without a date counts as due (202611112hzh, back-now).
    const until = fm.defer_until;
    if (!isBackFromDeferral(card)) {
      return (
        <p className="notice notice-info">
          Deferred until{" "}
          <time dateTime={until} title={until && timeAgo(until)}>
            {until && fullDate(until)}
          </time>
          . It comes back to the queue then.
        </p>
      );
    }
    return (
      <p className="notice notice-info">
        Back from deferral
        {until ? (
          <>
            : you deferred it until{" "}
            <time dateTime={until} title={timeAgo(until)}>
              {fullDate(until)}
            </time>
          </>
        ) : (
          ": it was deferred with no return date"
        )}
        . Press <kbd>d</kbd> to defer it again for a week.
      </p>
    );
  }
  return null;
}
