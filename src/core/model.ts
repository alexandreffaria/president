/**
 * Card format constants and small helpers with no dependencies, safe to import from the
 * browser bundle. The zod schemas that enforce them live in schema.ts.
 */

export const CARD_STATUSES = ["open", "deferred", "resolved"] as const;
export const CARD_KINDS = ["choice", "ab", "open"] as const;
export const PRIORITIES = ["high", "normal", "low"] as const;
export const FEEDBACK_TYPES = ["neither", "note", "defer", "reopen", "undo"] as const;

/** The reserved resolution choice for an answer that isn't one of the options. */
export const CUSTOM_CHOICE = "custom";

export type CardStatus = (typeof CARD_STATUSES)[number];
export type CardKind = (typeof CARD_KINDS)[number];
export type Priority = (typeof PRIORITIES)[number];
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

/** Card ids: lowercase letters and digits, no dashes (the dash separates id and slug). */
export const CARD_ID_PATTERN = /^[a-z0-9]{1,32}$/;
/** Option ids: short lowercase slugs such as `a`, `b`, `result-types`. */
export const OPTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** `<id>-<slug>.md` or `<id>.md`. */
export const CARD_FILENAME_PATTERN = /^([a-z0-9]{1,32})(?:-([a-z0-9][a-z0-9-]*))?\.md$/;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * True for `2026-11-10` and full ISO 8601 timestamps with a timezone (`2026-11-10T14:03:00Z`).
 * Impossible dates such as `2026-02-30` are rejected (Date.parse would roll them over).
 */
export function isIsoDateOrDateTime(value: string): boolean {
  if (!ISO_DATE.test(value) && !ISO_DATETIME.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/**
 * Card ids compare as strings. Only an unquoted YAML number (`id: 7`, `depends_on: [7]`)
 * matches by numeric value, so `7` matches "0007" but "07" does not.
 */
export function sameCardId(a: string | number, b: string | number): boolean {
  if (String(a) === String(b)) return true;
  if (typeof a !== "number" && typeof b !== "number") return false;
  const isDigits = (v: string | number) => typeof v === "number" || /^\d+$/.test(v);
  return isDigits(a) && isDigits(b) && Number(a) === Number(b);
}
