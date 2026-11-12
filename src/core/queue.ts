/**
 * Ordering and grouping of cards for the UI. Pure and shared so it can be tested.
 */
import type { CardDto } from "./api.ts";
import { type Priority, sameCardId, type Withdrawal, withdrawalOf } from "./model.ts";

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/** High priority first, then oldest first; ties broken by project and id for stability. */
export function compareQueue(a: CardDto, b: CardDto): number {
  const priority = PRIORITY_RANK[a.frontmatter.priority] - PRIORITY_RANK[b.frontmatter.priority];
  if (priority !== 0) return priority;
  const created = Date.parse(a.frontmatter.created) - Date.parse(b.frontmatter.created);
  if (created !== 0) return created;
  return a.project.localeCompare(b.project) || a.id.localeCompare(b.id);
}

/**
 * The agent's withdrawal of a card that is still undecided (open or deferred), or undefined
 * (#0014). Such a card leaves the queue for the collapsed "Withdrawn by agents" list. A
 * decided card may keep its `withdrawn` field (the decision keeps it), but it is decided: it
 * is in the Log, not in that list.
 */
export function activeWithdrawal(card: CardDto): Withdrawal | undefined {
  if (card.frontmatter.status === "resolved") return undefined;
  return withdrawalOf(card.frontmatter);
}

/** An undecided card an agent withdrew (#0014); see {@link activeWithdrawal}. */
export function isWithdrawn(card: CardDto): boolean {
  return activeWithdrawal(card) !== undefined;
}

/**
 * True when an agent still has to come back with new options (the human said "neither"):
 * an open card, or a deferred one back from deferral (it counts as open again). A snoozed
 * card stays in the Deferred list until its date, and a withdrawn one in the Withdrawn list
 * (#0014: the queue lists every undecided card with a `withdrawn` field there).
 */
export function isWaitingOnAgent(card: CardDto, now: number = Date.now()): boolean {
  const { status, needs_new_options } = card.frontmatter;
  if (needs_new_options !== true || isWithdrawn(card)) return false;
  return status === "open" || isBackFromDeferral(card, now);
}

/**
 * True for a deferred card whose snooze is over (#0017): its `defer_until` has passed, or it
 * has none (deferred before snooze, or by hand), which counts as passed (202611112hzh). The
 * card file isn't rewritten when the date passes; the queue works it out. A withdrawn card's
 * date, missing or not, is ignored while it is withdrawn (202611116ff6, "the agent's later
 * word wins"): it never comes back on its own.
 */
export function isBackFromDeferral(card: CardDto, now: number = Date.now()): boolean {
  const { status, defer_until } = card.frontmatter;
  if (status !== "deferred" || isWithdrawn(card)) return false;
  if (defer_until === undefined) return true;
  return Date.parse(defer_until) <= now;
}

/**
 * A deferred card still snoozed: it stays in the collapsed Deferred list. A withdrawn
 * deferred card is listed under Withdrawn instead (202611116ff6).
 */
export function isSnoozed(card: CardDto, now: number = Date.now()): boolean {
  return (
    card.frontmatter.status === "deferred" && !isWithdrawn(card) && !isBackFromDeferral(card, now)
  );
}

/**
 * Cards the human should look at now: open cards that aren't waiting on an agent or
 * withdrawn by one (#0014), and deferred cards back from deferral. Ready cards come first, then the cards with an
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
    const due = card.frontmatter.status === "open" || isBackFromDeferral(card, now);
    if (!due || isWithdrawn(card) || isWaitingOnAgent(card, now)) continue;
    (openDependencies(card, cards).length > 0 ? sunk : ready).push(card);
  }
  return [...ready.sort(compareQueue), ...sunk.sort(compareQueue)];
}

/**
 * The earliest `defer_until` still ahead of `now`: when the queue next changes on its own.
 * Undefined when no deferred card is waiting for its date (a withdrawn card's date doesn't
 * count: it is ignored while the card is withdrawn).
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

/**
 * Undecided cards an agent withdrew (#0014), for the collapsed "Withdrawn by agents" list,
 * deferred ones included (their date is ignored meanwhile, 202611116ff6). Sorted like the
 * queue; `project` filters the result.
 */
export function buildWithdrawn(cards: CardDto[], project?: string): CardDto[] {
  return cards
    .filter((c) => isWithdrawn(c) && (!project || c.project === project))
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

/**
 * Dependencies of `card` (same project) that exist and are not resolved yet. A withdrawn
 * dependency still counts (202611116ff6, labelled): its dependents stay sunk until the human
 * decides it; only their mark says it was withdrawn (see {@link describeDependencies}).
 */
export function openDependencies(card: CardDto, all: CardDto[]): string[] {
  return card.frontmatter.depends_on
    .filter((dep) => {
      if (sameCardId(dep, card.id)) return false;
      const target = findDependency(card, dep, all);
      return target !== undefined && target.frontmatter.status !== "resolved";
    })
    .map(String);
}

function findDependency(card: CardDto, dep: string | number, all: CardDto[]): CardDto | undefined {
  return all.find((c) => c.project === card.project && sameCardId(c.id, dep));
}

/**
 * How the dependency marks name `deps` (ids from {@link openDependencies}): `#0042`, or
 * `#0042, withdrawn` for one an agent withdrew (202611116ff6). When one of them is
 * withdrawn they are joined with "; ", since its own label has a comma.
 */
export function describeDependencies(card: CardDto, deps: string[], all: CardDto[]): string {
  const labels = deps.map((dep) => {
    const target = findDependency(card, dep, all);
    return { label: `#${dep}`, withdrawn: target !== undefined && isWithdrawn(target) };
  });
  const anyWithdrawn = labels.some((l) => l.withdrawn);
  return labels
    .map((l) => (l.withdrawn ? `${l.label}, withdrawn` : l.label))
    .join(anyWithdrawn ? "; " : ", ");
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
