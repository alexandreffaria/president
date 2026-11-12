import type { CardKind, Priority } from "../core/model.ts";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
// A date-only value ("2026-11-11") parses as UTC midnight, so it is formatted in UTC: in the
// viewer's zone it would show the day before anywhere west of UTC.
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 days ago", "yesterday", "just now". */
export function timeAgo(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const seconds = (time - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Full date (and time when the value has one), for tooltips. */
export function fullDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return iso.includes("T") ? absolute.format(time) : dateOnly.format(time);
}

export const KIND_LABEL: Record<CardKind, string> = {
  choice: "Choice",
  ab: "A / B",
  open: "Open question",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High priority",
  normal: "Normal priority",
  low: "Low priority",
};

/** "A", "B", ... for A/B cards; "1", "2", ... otherwise. */
export function optionLabel(index: number, kind: CardKind): string {
  return kind === "ab" ? String.fromCharCode(65 + index) : String(index + 1);
}
