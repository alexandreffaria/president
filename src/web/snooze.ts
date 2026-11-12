/**
 * The dates the Defer menu offers (#0017, snooze). `d` and "Next week" send no date: the hub
 * defers for a week then (DEFAULT_SNOOZE_DAYS), so the default lives in one place.
 */

/** The same time tomorrow, in local time. */
export function tomorrow(now: Date): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  return date;
}

/** The same time next month; the month's last day when it is shorter (31 Jan -> 28 Feb). */
export function nextMonth(now: Date): Date {
  const date = new Date(now);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return date;
}

/** `YYYY-MM-DD` of a date in local time, the value of an `<input type="date">`. */
export function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The start of a picked day (`YYYY-MM-DD`) in local time, or undefined for anything that
 * isn't a real date.
 */
export function startOfDay(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return undefined;
  }
  return date;
}
