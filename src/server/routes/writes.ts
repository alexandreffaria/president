/**
 * The card revisions this server wrote (actions and undos), so it can tell a page whether a
 * change it didn't see was the human's own (from another tab) or someone else's. Kept for
 * the 500 most recently written cards, 20 writes each; a restart forgets them, and a page
 * then takes the change for an agent's, which only shows one notice too many.
 */
export class PresidentWrites {
  readonly #byPath = new Map<string, { from: string; to: string }[]>();

  record(path: string, from: string, to: string): void {
    const list = this.#byPath.get(path) ?? [];
    list.push({ from, to });
    if (list.length > 20) list.shift();
    this.#byPath.delete(path);
    this.#byPath.set(path, list);
    if (this.#byPath.size > 500) this.#byPath.delete(this.#byPath.keys().next().value as string);
  }

  /**
   * Whether this server's own writes alone lead from `since` to `revision` (without
   * `since`: whether its last write produced `revision`).
   */
  explain(path: string, revision: string, since: string | undefined): boolean {
    const list = this.#byPath.get(path) ?? [];
    if (since === undefined) return list.at(-1)?.to === revision;
    let current = revision;
    // Walk back from the newest write: each must have produced the revision the next one
    // started from. A gap means someone else changed the file in between.
    for (let i = list.length - 1; current !== since; i--) {
      const write = list[i];
      if (!write || write.to !== current) return false;
      current = write.from;
    }
    return true;
  }
}
