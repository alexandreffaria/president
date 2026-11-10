/**
 * What an agent still has to act on, card by card. Shared by `president pending` and the
 * UI's "seen by an agent" markers.
 */
import type { FeedbackEntry, Frontmatter } from "./schema.ts";

type Card = Pick<Frontmatter, "status" | "feedback" | "applied_at" | "seen_at" | "resolution">;

/** Feedback the human added after an agent last read the card (`seen_at`), oldest first. */
export function unseenFeedback(card: Pick<Card, "feedback" | "seen_at">): FeedbackEntry[] {
  const seen = card.seen_at ? Date.parse(card.seen_at) : Number.NEGATIVE_INFINITY;
  return card.feedback.filter((entry) => Date.parse(entry.at) > seen);
}

/** Resolved and not yet applied: an agent has to record the decision and act on it. */
export function needsApplying(card: Pick<Card, "status" | "applied_at">): boolean {
  return card.status === "resolved" && !card.applied_at;
}

/** The decision a card had before the human reopened it. */
export interface EarlierDecision {
  resolution: unknown;
  /** When an agent applied that earlier decision, if it did. */
  appliedAt: string | undefined;
}

/**
 * The decision this card had before the human reopened it, when it is resolved again and
 * not applied yet. If that earlier decision was applied, the agent has to replace the old
 * record and undo work that no longer applies.
 */
export function earlierDecision(card: Card): EarlierDecision | undefined {
  if (!needsApplying(card)) return undefined;
  const reopened = card.feedback.findLast(
    (entry) => entry.type === "reopen" && entry.previous_resolution !== undefined,
  );
  if (!reopened) return undefined;
  const appliedAt = reopened.previous_applied_at;
  return {
    resolution: reopened.previous_resolution,
    appliedAt: typeof appliedAt === "string" ? appliedAt : undefined,
  };
}
