/**
 * Card state transitions. Pure functions: (card, action, now) -> new raw frontmatter.
 *
 *   open ──resolve──▶ resolved ──applied──▶ resolved + applied_at
 *    │ ▲                 │
 *    │ └─────reopen──────┘
 *    ├──neither──▶ open + needs_new_options (feedback appended)
 *    ├──note─────▶ open (feedback appended)
 *    └──defer────▶ deferred ──reopen──▶ open
 *
 * `resolve`, `neither` and `note` also work on deferred cards. `seen` (an agent has read the
 * human's feedback) works in any state; `applied` implies it. Both take the token that
 * `preside pending` printed, and mark only what the agent was shown (see agentToken).
 *
 * New actions (for example the chat panel's "teach me" or "research") belong here too,
 * so the API, the CLI and future agent runners share one set of rules.
 */
import { z } from "zod";
import type { ParsedCard } from "./card-file.ts";
import { checkAgentToken, seenAtAfter } from "./pending.ts";
import {
  CARD_STATUSES,
  type CardStatus,
  CUSTOM_CHOICE,
  type FeedbackType,
  FrontmatterSchema,
  formatIssues,
  type RawFrontmatter,
} from "./schema.ts";

const Note = z.string().trim().min(1, { error: "a note is required" }).max(20_000);
const OptionalNote = z.string().trim().max(20_000).optional();
const AgentToken = z
  .string({ error: "is required: pass the token `preside pending` printed for this card" })
  .min(1)
  .max(100);

export const CardActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resolve"), choice: z.string().min(1).max(40), note: OptionalNote }),
  z.object({ type: z.literal("neither"), note: Note }),
  z.object({ type: z.literal("note"), note: Note }),
  z.object({ type: z.literal("defer"), note: OptionalNote }),
  z.object({ type: z.literal("reopen"), note: OptionalNote }),
  z.object({ type: z.literal("applied"), token: AgentToken }),
  z.object({ type: z.literal("seen"), token: AgentToken }),
]);

export type CardAction = z.infer<typeof CardActionSchema>;
export type CardActionType = CardAction["type"];

/**
 * `transition`: the action isn't possible in the card's current state (a conflict).
 * `input`: the action itself is wrong for this card (an unknown option, a missing note).
 * `stale`: an agent's token no longer matches the card (the human acted since it looked).
 */
export type ActionResult =
  | { ok: true; raw: RawFrontmatter }
  | { ok: false; error: string; reason: "transition" | "input" | "stale" };

/** ISO timestamp without milliseconds, e.g. 2026-11-10T14:03:00Z. */
export function timestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The `at` of a new feedback entry: now, but always later than every earlier entry and than
 * `seen_at`, so it can never count as already read. Normally whole seconds; when the
 * second is already taken (two notes in one second, or a note in the same second as
 * `seen_at`), one millisecond after the latest.
 */
export function feedbackTimestamp(
  now: Date,
  card: { feedback: { at: string }[]; seen_at?: string | undefined },
): string {
  let latest = Number.NEGATIVE_INFINITY;
  for (const entry of card.feedback) latest = Math.max(latest, Date.parse(entry.at));
  if (card.seen_at) latest = Math.max(latest, Date.parse(card.seen_at));
  const at = timestamp(now);
  if (Date.parse(at) > latest) return at;
  return new Date(latest + 1).toISOString();
}

const ALLOWED_FROM: Record<CardActionType, readonly CardStatus[]> = {
  resolve: ["open", "deferred"],
  neither: ["open", "deferred"],
  note: ["open", "deferred"],
  defer: ["open"],
  reopen: ["deferred", "resolved"],
  applied: ["resolved"],
  seen: CARD_STATUSES,
};

const VERB: Record<CardActionType, string> = {
  resolve: "resolve a card",
  neither: "reject the options of a card",
  note: "add a note to a card",
  defer: "defer a card",
  reopen: "reopen a card",
  applied: "mark a card as applied",
  seen: "mark a card's feedback as seen",
};

export function canApply(status: CardStatus, type: CardActionType): boolean {
  return ALLOWED_FROM[type].includes(status);
}

export function applyAction(
  card: Pick<ParsedCard, "id" | "frontmatter" | "raw">,
  action: CardAction,
  now: Date,
): ActionResult {
  const { frontmatter } = card;
  const at = timestamp(now);
  if (!canApply(frontmatter.status, action.type)) {
    return {
      ok: false,
      reason: "transition",
      error: `cannot ${VERB[action.type]} while it is ${frontmatter.status}`,
    };
  }
  const invalid = (error: string): ActionResult => ({ ok: false, reason: "input", error });

  const next: RawFrontmatter = { ...card.raw };
  const appendFeedback = (type: FeedbackType, note: string, extra: RawFrontmatter = {}) => {
    const existing = Array.isArray(next.feedback) ? next.feedback : [];
    next.feedback = [
      ...existing,
      { at: feedbackTimestamp(now, frontmatter), type, note, ...extra },
    ];
  };

  switch (action.type) {
    case "resolve": {
      const optionIds = frontmatter.options.map((o) => o.id);
      const note = action.note || undefined;
      if (action.choice === CUSTOM_CHOICE) {
        if (!note) return invalid("a custom answer needs a note with the answer");
      } else if (!optionIds.includes(action.choice)) {
        return invalid(`"${action.choice}" is not an option of this card`);
      }
      next.status = "resolved";
      next.resolution = {
        choice: action.choice,
        ...(note ? { note } : {}),
        resolved_at: at,
      };
      delete next.needs_new_options;
      delete next.applied_at;
      break;
    }
    case "neither": {
      if (frontmatter.options.length === 0) {
        return invalid(
          'this card has no options to reject; resolve it with a "custom" answer instead',
        );
      }
      appendFeedback("neither", action.note);
      next.status = "open";
      next.needs_new_options = true;
      break;
    }
    case "note": {
      appendFeedback("note", action.note);
      break;
    }
    case "defer": {
      if (action.note) appendFeedback("defer", action.note);
      next.status = "deferred";
      break;
    }
    case "reopen": {
      const previous = frontmatter.resolution;
      if (previous) {
        const was = `Reopened; it was resolved as "${previous.choice}"${describeNote(previous)}.`;
        appendFeedback("reopen", action.note ? `${was} ${action.note}` : was, {
          previous_resolution: card.raw.resolution,
          ...(card.raw.applied_at ? { previous_applied_at: card.raw.applied_at } : {}),
        });
      } else if (action.note) {
        appendFeedback("reopen", action.note);
      }
      next.status = "open";
      delete next.resolution;
      delete next.applied_at;
      break;
    }
    case "applied":
    case "seen": {
      const check = checkAgentToken(card, action.token);
      if (!check.ok) return { ok: false, reason: "stale", error: check.error };
      // Applying means the agent read the whole card as it was shown, feedback included.
      if (action.type === "applied") next.applied_at = at;
      const seenAt = seenAtAfter(frontmatter, check.shown);
      if (seenAt !== undefined) next.seen_at = seenAt;
      break;
    }
  }

  return validated(next);
}

function validated(next: RawFrontmatter): ActionResult {
  const check = FrontmatterSchema.safeParse(next);
  if (!check.success) {
    return {
      ok: false,
      reason: "input",
      error: `the change would make the card invalid: ${formatIssues(check.error).join("; ")}`,
    };
  }
  return { ok: true, raw: next };
}

function describeNote(resolution: { note?: string | undefined }): string {
  return resolution.note ? ` (${resolution.note})` : "";
}

/**
 * The frontmatter of a card whose decision the human undid: `restored` is the card as it
 * was before the decision, and `undone` the card with the decision. Undo puts the earlier
 * card back and adds an `undo` feedback entry that keeps the decision in
 * `previous_resolution`, so an agent that was shown the decision (and may have acted on it)
 * finds out from `preside pending` that it was taken back, however late it looks.
 */
export function afterUndoingDecision(
  restored: Pick<ParsedCard, "frontmatter" | "raw">,
  undone: Pick<ParsedCard, "frontmatter" | "raw">,
  now: Date,
): ActionResult {
  const decision = undone.frontmatter.resolution;
  if (!decision) {
    return { ok: false, reason: "transition", error: "the card has no decision to undo" };
  }
  const existing = Array.isArray(restored.raw.feedback) ? restored.raw.feedback : [];
  const entry = {
    at: feedbackTimestamp(now, restored.frontmatter),
    type: "undo" satisfies FeedbackType,
    note: `Took back the decision "${decision.choice}"${describeNote(decision)}.`,
    previous_resolution: undone.raw.resolution,
  };
  return validated({ ...restored.raw, feedback: [...existing, entry] });
}
