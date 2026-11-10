/**
 * The decision card format, as zod schemas.
 *
 * The human-readable spec lives in docs/card-format.md. Keep the two in sync.
 *
 * Every object schema is "loose": fields we don't know about are kept, so a card
 * written by a newer agent (or with extra notes) survives a read/write round trip.
 */
import { z } from "zod";
import {
  CARD_ID_PATTERN,
  CARD_KINDS,
  CARD_STATUSES,
  CUSTOM_CHOICE,
  FEEDBACK_TYPES,
  isIsoDateOrDateTime,
  OPTION_ID_PATTERN,
  PRIORITIES,
} from "./model.ts";

export * from "./model.ts";

const DATE_HINT = "expected a date like 2026-11-10 or a timestamp like 2026-11-10T14:03:00Z";
const Timestamp = z
  .string({ error: (issue) => (issue.input === undefined ? "is required" : DATE_HINT) })
  .refine(isIsoDateOrDateTime, { error: DATE_HINT });

const NonEmpty = z.string().trim().min(1, { error: "must not be empty" });

/**
 * YAML reads an unquoted `0007` as the number 7, so ids may arrive as numbers.
 * We accept both and compare them with {@link sameCardId}.
 */
const CardIdRef = z.union([
  z.string().regex(CARD_ID_PATTERN, {
    error: 'card ids use lowercase letters and digits only, e.g. "0007"',
  }),
  z.number().int().nonnegative(),
]);

export const OptionSchema = z.looseObject({
  id: z.string().regex(OPTION_ID_PATTERN, {
    error: 'option ids are short lowercase slugs such as "a", "b" or "result-types"',
  }),
  title: NonEmpty,
  summary: z.string().optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
});

export const RecommendationSchema = z.looseObject({
  option: z.string(),
  why: NonEmpty,
});

export const FeedbackSchema = z.looseObject({
  at: Timestamp,
  note: NonEmpty,
  type: z.enum(FEEDBACK_TYPES).optional(),
});

export const ResolutionSchema = z.looseObject({
  choice: NonEmpty,
  note: z.string().optional(),
  resolved_at: Timestamp,
});

export const FrontmatterSchema = z
  .looseObject({
    id: CardIdRef,
    title: NonEmpty,
    status: z.enum(CARD_STATUSES),
    kind: z.enum(CARD_KINDS),
    priority: z.enum(PRIORITIES).default("normal"),
    created: Timestamp,
    created_by: NonEmpty,
    tags: z.array(z.string()).default([]),
    depends_on: z.array(CardIdRef).default([]),
    recommendation: RecommendationSchema.optional(),
    options: z.array(OptionSchema).default([]),
    feedback: z.array(FeedbackSchema).default([]),
    needs_new_options: z.boolean().optional(),
    resolution: ResolutionSchema.optional(),
    applied_at: Timestamp.optional(),
    /** When an agent last read the human's feedback (`president seen`, `president applied`). */
    seen_at: Timestamp.optional(),
    /** Reserved for the chat panel (headless Claude Code session per card). */
    session_id: z.string().optional(),
  })
  .superRefine((card, ctx) => {
    const optionIds = card.options.map((o) => o.id);

    if (card.kind === "ab" && card.options.length !== 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `kind "ab" needs exactly 2 options, found ${card.options.length}`,
      });
    }
    if (card.kind === "choice" && card.options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: `kind "choice" needs at least 2 options, found ${card.options.length}`,
      });
    }

    const seen = new Set<string>();
    card.options.forEach((option, index) => {
      if (option.id === CUSTOM_CHOICE) {
        ctx.addIssue({
          code: "custom",
          path: ["options", index, "id"],
          message: `"${CUSTOM_CHOICE}" is reserved for answers outside the options`,
        });
      }
      if (seen.has(option.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["options", index, "id"],
          message: `duplicate option id "${option.id}"`,
        });
      }
      seen.add(option.id);
    });

    if (card.recommendation && !optionIds.includes(card.recommendation.option)) {
      ctx.addIssue({
        code: "custom",
        path: ["recommendation", "option"],
        message: `recommends "${card.recommendation.option}", which is not an option id (${listOrNone(optionIds)})`,
      });
    }

    if (card.status === "resolved" && !card.resolution) {
      ctx.addIssue({
        code: "custom",
        path: ["resolution"],
        message: 'status is "resolved" but there is no resolution',
      });
    }
    if (card.status !== "resolved" && card.resolution) {
      ctx.addIssue({
        code: "custom",
        path: ["resolution"],
        message: `has a resolution but status is "${card.status}"; remove one or the other`,
      });
    }
    if (card.applied_at && card.status !== "resolved") {
      ctx.addIssue({
        code: "custom",
        path: ["applied_at"],
        message: `only resolved cards can be applied, but status is "${card.status}"; remove applied_at`,
      });
    }
    if (card.needs_new_options && card.status === "resolved") {
      ctx.addIssue({
        code: "custom",
        path: ["needs_new_options"],
        message: "a resolved card can't need new options; remove needs_new_options",
      });
    }
    if (card.resolution) {
      const { choice, note } = card.resolution;
      if (choice === CUSTOM_CHOICE) {
        if (!note?.trim()) {
          ctx.addIssue({
            code: "custom",
            path: ["resolution", "note"],
            message: `a "${CUSTOM_CHOICE}" resolution needs a note with the answer`,
          });
        }
      } else if (!optionIds.includes(choice)) {
        ctx.addIssue({
          code: "custom",
          path: ["resolution", "choice"],
          message: `"${choice}" is not an option id (${listOrNone(optionIds)}) or "${CUSTOM_CHOICE}"`,
        });
      }
    }
  });

function listOrNone(ids: string[]): string {
  return ids.length ? ids.map((id) => `"${id}"`).join(", ") : "there are no options";
}

export type CardOption = z.output<typeof OptionSchema>;
export type Recommendation = z.output<typeof RecommendationSchema>;
export type FeedbackEntry = z.output<typeof FeedbackSchema>;
export type Resolution = z.output<typeof ResolutionSchema>;
/** Validated frontmatter, with defaults filled in. */
export type Frontmatter = z.output<typeof FrontmatterSchema>;
/** Frontmatter exactly as it appears in the file (no defaults), used for writing. */
export type RawFrontmatter = Record<string, unknown>;

/**
 * Formats zod issues as `path: message` lines that an agent can act on. `locate` turns an
 * issue path into a file line number, added as ` (line N)` when known.
 */
export function formatIssues(
  error: z.ZodError,
  locate?: (path: readonly PropertyKey[]) => number | undefined,
): string[] {
  return error.issues.map((issue) => {
    const path = formatPath(issue.path);
    const line = lineSuffix(locate?.(issue.path));
    return path ? `${path}: ${issue.message}${line}` : `${issue.message}${line}`;
  });
}

export function lineSuffix(line: number | undefined): string {
  return line === undefined ? "" : ` (line ${line})`;
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${String(part)}` : String(part);
  }
  return out;
}
