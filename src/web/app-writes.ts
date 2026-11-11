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
}
