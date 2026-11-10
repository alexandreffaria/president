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
 * `resolve`, `neither` and `note` also work on deferred cards.
 *
 * New actions (for example the chat panel's "teach me" or "research") belong here too,
 * so the API, the CLI and future agent runners share one set of rules.
 */
import { z } from "zod";
import type { ParsedCard } from "./card-file.ts";
import {
  type CardStatus,
  CUSTOM_CHOICE,
  type FeedbackType,
  FrontmatterSchema,
  formatIssues,
  type RawFrontmatter,
} from "./schema.ts";

const Note = z.string().trim().min(1, { error: "a note is required" }).max(20_000);
const OptionalNote = z.string().trim().max(20_000).optional();

export const CardActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resolve"), choice: z.string().min(1), note: OptionalNote }),
  z.object({ type: z.literal("neither"), note: Note }),
  z.object({ type: z.literal("note"), note: Note }),
  z.object({ type: z.literal("defer"), note: OptionalNote }),
  z.object({ type: z.literal("reopen"), note: OptionalNote }),
  z.object({ type: z.literal("applied") }),
]);

export type CardAction = z.infer<typeof CardActionSchema>;
export type CardActionType = CardAction["type"];

export type ActionResult = { ok: true; raw: RawFrontmatter } | { ok: false; error: string };

/** ISO timestamp without milliseconds, e.g. 2026-11-10T14:03:00Z. */
export function timestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const ALLOWED_FROM: Record<CardActionType, readonly CardStatus[]> = {
  resolve: ["open", "deferred"],
  neither: ["open", "deferred"],
  note: ["open", "deferred"],
  defer: ["open"],
  reopen: ["deferred", "resolved"],
  applied: ["resolved"],
};

const VERB: Record<CardActionType, string> = {
  resolve: "resolve a card",
  neither: "reject the options of a card",
  note: "add a note to a card",
  defer: "defer a card",
  reopen: "reopen a card",
  applied: "mark a card as applied",
};

export function canApply(status: CardStatus, type: CardActionType): boolean {
  return ALLOWED_FROM[type].includes(status);
}

export function applyAction(
  card: Pick<ParsedCard, "frontmatter" | "raw">,
  action: CardAction,
  now: Date,
): ActionResult {
  const { frontmatter } = card;
  const at = timestamp(now);
  if (!canApply(frontmatter.status, action.type)) {
    return {
      ok: false,
      error: `cannot ${VERB[action.type]} while it is ${frontmatter.status}`,
    };
  }

  const next: RawFrontmatter = { ...card.raw };
  const appendFeedback = (type: FeedbackType, note: string, extra: RawFrontmatter = {}) => {
    const existing = Array.isArray(next.feedback) ? next.feedback : [];
    next.feedback = [...existing, { at, type, note, ...extra }];
  };

  switch (action.type) {
    case "resolve": {
      const optionIds = frontmatter.options.map((o) => o.id);
      const note = action.note || undefined;
      if (action.choice === CUSTOM_CHOICE) {
        if (!note) return { ok: false, error: "a custom answer needs a note with the answer" };
      } else if (!optionIds.includes(action.choice)) {
        return {
          ok: false,
          error: `"${action.choice}" is not an option of this card`,
        };
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
        return {
          ok: false,
          error: 'this card has no options to reject; resolve it with a "custom" answer instead',
        };
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
        const was = `Reopened; it was resolved as "${previous.choice}"${previous.note ? ` (${previous.note})` : ""}.`;
        appendFeedback("reopen", action.note ? `${was} ${action.note}` : was, {
          previous_resolution: card.raw.resolution,
        });
      } else if (action.note) {
        appendFeedback("reopen", action.note);
      }
      next.status = "open";
      delete next.resolution;
      delete next.applied_at;
      break;
    }
    case "applied": {
      next.applied_at = at;
      break;
    }
  }

  const check = FrontmatterSchema.safeParse(next);
  if (!check.success) {
    return {
      ok: false,
      error: `the change would make the card invalid: ${formatIssues(check.error).join("; ")}`,
    };
  }
  return { ok: true, raw: next };
}
