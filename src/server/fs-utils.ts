import { randomBytes } from "node:crypto";
import { rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes a file atomically: the content goes to a temp file in the same directory,
 * which is then renamed over the target. Readers never see a half-written file.
 * Temp files start with a dot so the card watcher and loader ignore them.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** Runs tasks for the same key one after another. */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => {});
    this.#tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
