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

/** Cards the human should look at now: open and not waiting on an agent. */
export function buildQueue(cards: CardDto[], project?: string): CardDto[] {
  return cards
    .filter((c) => c.frontmatter.status === "open" && !isWaitingOnAgent(c))
    .filter((c) => !project || c.project === project)
    .sort(compareQueue);
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
