/**
 * Card revisions that president itself wrote: this tab's actions and undos, and other
 * tabs' (announced on the live stream). A card view that sees one of these knows the human
 * made the change, so it never says an agent did.
 */
export type Writer = "this-tab" | "other-tab";

const writes = new Map<string, Map<string, Writer>>();
const PER_CARD = 50;

const key = (project: string, id: string) => `${project}\0${id}`;

export function recordWrite(project: string, id: string, revision: string, writer: Writer): void {
  const card = writes.get(key(project, id)) ?? new Map<string, Writer>();
  // This tab's own record wins over the echo from the live stream.
  if (card.get(revision) === "this-tab") return;
  card.delete(revision);
  card.set(revision, writer);
  if (card.size > PER_CARD) card.delete(card.keys().next().value as string);
  writes.set(key(project, id), card);
}

/** Who in president wrote this revision of the card, if president did. */
export function writtenBy(project: string, id: string, revision: string): Writer | undefined {
  return writes.get(key(project, id))?.get(revision);
}

/** For tests: forget every recorded write. */
export function clearWrites(): void {
  writes.clear();
}
