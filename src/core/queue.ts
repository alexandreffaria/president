/**
 * Ordering and grouping of cards for the UI. Pure and shared so it can be tested.
 */
import type { CardDto } from "./api.ts";
import { type Priority, sameCardId } from "./model.ts";

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/** High priority first, then oldest first; ties broken by project and id for stability. */
export function compareQueue(a: CardDto, b: CardDto): number {
  const priority = PRIORITY_RANK[a.frontmatter.priority] - PRIORITY_RANK[b.frontmatter.priority];
  if (priority !== 0) return priority;
  const created = Date.parse(a.frontmatter.created) - Date.parse(b.frontmatter.created);
  if (created !== 0) return created;
  return a.project.localeCompare(b.project) || a.id.localeCompare(b.id);
}

/** True when an agent still has to come back with new options (the human said "neither"). */
export function isWaitingOnAgent(card: CardDto): boolean {
  return card.frontmatter.status === "open" && card.frontmatter.needs_new_options === true;
}

/**
 * True for a deferred card whose snooze is over (#0017): its `defer_until` has passed, or it
 * has none (deferred before snooze, or by hand), which counts as passed (202611112hzh). The
 * card file isn't rewritten when the date passes; the queue works it out.
 */
export function isBackFromDeferral(card: CardDto, now: number = Date.now()): boolean {
  const { status, defer_until } = card.frontmatter;
  if (status !== "deferred") return false;
  if (defer_until === undefined) return true;
  return Date.parse(defer_until) <= now;
}

/** A deferred card still snoozed: it stays in the collapsed Deferred list. */
export function isSnoozed(card: CardDto, now: number = Date.now()): boolean {
  return card.frontmatter.status === "deferred" && !isBackFromDeferral(card, now);
}

/**
 * Cards the human should look at now: open cards that aren't waiting on an agent, and
 * deferred cards back from deferral. Ready cards come first, then the cards with an
 * undecided dependency (#0009, sink); each group by priority, then oldest first (#0015).
 * Dependencies are looked up in `cards`, so pass every card; `project` filters the result.
 */
export function buildQueue(
  cards: CardDto[],
  project?: string,
  now: number = Date.now(),
): CardDto[] {
  const ready: CardDto[] = [];
  const sunk: CardDto[] = [];
  for (const card of cards) {
    if (project && card.project !== project) continue;
    const open = card.frontmatter.status === "open" && !isWaitingOnAgent(card);
    if (!open && !isBackFromDeferral(card, now)) continue;
    (openDependencies(card, cards).length > 0 ? sunk : ready).push(card);
  }
  return [...ready.sort(compareQueue), ...sunk.sort(compareQueue)];
}

/**
 * The earliest `defer_until` still ahead of `now`: when the queue next changes on its own.
 * Undefined when no deferred card is waiting for its date.
 */
export function nextReturn(cards: CardDto[], now: number = Date.now()): number | undefined {
  let next: number | undefined;
  for (const card of cards) {
    if (!isSnoozed(card, now)) continue;
    const until = Date.parse(card.frontmatter.defer_until ?? "");
    if (next === undefined || until < next) next = until;
  }
  return next;
}

/** Resolved cards, most recently resolved first. */
export function buildLog(cards: CardDto[], project?: string): CardDto[] {
  const resolvedAt = (c: CardDto) => Date.parse(c.frontmatter.resolution?.resolved_at ?? "") || 0;
  return cards
    .filter((c) => c.frontmatter.status === "resolved")
    .filter((c) => !project || c.project === project)
    .sort((a, b) => resolvedAt(b) - resolvedAt(a));
}

/** Dependencies of `card` (same project) that exist and are not resolved yet. */
export function openDependencies(card: CardDto, all: CardDto[]): string[] {
  return card.frontmatter.depends_on
    .filter((dep) => {
      if (sameCardId(dep, card.id)) return false;
      const target = all.find((c) => c.project === card.project && sameCardId(c.id, dep));
      return target !== undefined && target.frontmatter.status !== "resolved";
    })
    .map(String);
}

/** Dependencies of `card` that don't name another card of its project (a typo, usually). */
export function unknownDependencies(card: CardDto, all: CardDto[]): string[] {
  return card.frontmatter.depends_on
    .filter(
      (dep) =>
        sameCardId(dep, card.id) ||
        !all.some((c) => c.project === card.project && sameCardId(c.id, dep)),
    )
    .map(String);
}
