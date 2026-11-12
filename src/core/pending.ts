/**
 * What an agent still has to act on, card by card. Shared by `preside pending` and the
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

/**
 * The agent's receipt for what `preside pending` showed it about a card: every feedback
 * entry up to that moment and the resolution (when resolved). `preside seen` and
 * `preside applied` must be given it, and they only mark what it covers, so a note the
 * human adds, or a decision they change, while the agent works is never marked as read or
 * applied without the agent having seen it.
 *
 * Format: `<number of feedback entries shown>-<hash>`. The hash is not a secret, it only
 * has to change when what was shown changes.
 */
export function agentToken(card: { id: string; frontmatter: Card }): string {
  const shown = card.frontmatter.feedback.length;
  return `${shown}-${tokenHash(card.id, card.frontmatter, shown)}`;
}

export type TokenCheck =
  | {
      ok: true;
      /** The feedback entries the agent was shown, oldest first. */
      shown: FeedbackEntry[];
      /** Feedback the human added after the agent ran `preside pending`. */
      newer: FeedbackEntry[];
    }
  | { ok: false; error: string };

const TOKEN = /^(\d{1,6})-([0-9a-z]{6,20})$/;
const RERUN = "Run `preside pending` again, act on what it shows, and use the token it prints.";

/** Checks a token from {@link agentToken} against the card as it is now. */
export function checkAgentToken(
  card: { id: string; frontmatter: Card },
  token: string,
): TokenCheck {
  const match = TOKEN.exec(token.trim());
  if (!match) {
    return {
      ok: false,
      error: `"${token}" is not a token from \`preside pending\`. ${RERUN}`,
    };
  }
  const shown = Number(match[1]);
  const { feedback } = card.frontmatter;
  if (shown <= feedback.length && tokenHash(card.id, card.frontmatter, shown) === match[2]) {
    return { ok: true, shown: feedback.slice(0, shown), newer: feedback.slice(shown) };
  }
  return { ok: false, error: `${staleReason(card.frontmatter)} ${RERUN}` };
}

function staleReason(card: Card): string {
  const now =
    card.status === "resolved" && card.resolution
      ? `resolved as "${card.resolution.choice}" (decided at ${card.resolution.resolved_at})`
      : card.status;
  return `The card changed since you ran \`preside pending\`: it is now ${now}. The human may have changed their decision or undone a note, or the token is for another card.`;
}

/**
 * The newest `at` among the entries an agent was shown, or the current `seen_at` if that
 * is later. This is the `seen_at` that marks exactly those entries as read.
 */
export function seenAtAfter(
  card: Pick<Card, "seen_at">,
  shown: FeedbackEntry[],
): string | undefined {
  let best = card.seen_at;
  for (const entry of shown) {
    if (best === undefined || Date.parse(entry.at) > Date.parse(best)) best = entry.at;
  }
  return best;
}

function tokenHash(id: string, card: Card, shown: number): string {
  const resolution =
    card.status === "resolved" && card.resolution
      ? {
          choice: card.resolution.choice,
          note: card.resolution.note ?? null,
          resolved_at: card.resolution.resolved_at,
        }
      : null;
  return hash(canonical({ id, feedback: card.feedback.slice(0, shown), resolution }));
}

/** JSON with object keys sorted, so the same data always gives the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** cyrb53: a fast 53-bit string hash (no crypto needed; this file also runs in the browser). */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, "0");
}
