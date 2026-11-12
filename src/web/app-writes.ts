/**
 * Card revisions this tab wrote (its actions and undos). A card view that loads one of
 * these knows the human just made the change here, so it says nothing about it. Changes
 * made in other tabs are told apart by the server (CardDetailDto.writtenByPresident).
 */
const writes = new Map<string, Set<string>>();
const PER_CARD = 50;

const key = (project: string, id: string) => `${project}\0${id}`;

export function recordWrite(project: string, id: string, revision: string): void {
  const card = writes.get(key(project, id)) ?? new Set<string>();
  card.delete(revision);
  card.add(revision);
  if (card.size > PER_CARD) card.delete(card.values().next().value as string);
  writes.set(key(project, id), card);
}

/** Whether this tab wrote this revision of the card. */
export function wroteHere(project: string, id: string, revision: string): boolean {
  return writes.get(key(project, id))?.has(revision) ?? false;
}

/** For tests: forget every recorded write. */
export function clearWrites(): void {
  writes.clear();
  decisions.clear();
}

/**
 * Cards this tab decided whose decision is the latest thing done to them here: while the
 * decision's Undo notice is shown, nothing else may write the card from this page (#0006,
 * #0020). Forgotten when the decision is undone or another action follows it.
 */
const decisions = new Set<string>();

export function recordDecision(project: string, id: string): void {
  decisions.add(key(project, id));
}

export function forgetDecision(project: string, id: string): void {
  decisions.delete(key(project, id));
}

/** Whether the latest action this tab took on the card was a decision. */
export function decidedHere(project: string, id: string): boolean {
  return decisions.has(key(project, id));
}
