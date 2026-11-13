import { randomBytes } from "node:crypto";
import { link, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * Writes a file atomically: the content goes to a temp file in the same directory, is
 * flushed to disk, and then renamed over the target. Readers never see a half-written file,
 * and a crash can't leave an empty one.
 *
 * The temp file gets the target's permission bits, so a private (0600) card stays private.
 * Temp files start with a dot so the card watcher and loader ignore them.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const mode = await stat(path).then(
    (info) => info.mode & 0o7777,
    (error: unknown) => {
      if (isNotFound(error)) return 0o666; // a new file: the umask applies as usual
      throw error;
    },
  );
  const temp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(temp, "wx", mode);
    try {
      await handle.writeFile(content, "utf8");
      // open() applies the umask; set the exact bits the original had.
      if (mode !== 0o666) await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  await syncDirectory(dirname(path));
}

/** Flushes a rename to disk. Best effort: some platforms can't open a directory. */
async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Not supported here (e.g. Windows); the rename itself is still atomic.
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

/**
 * Creates `path` holding `content`, unless it exists; true when it was created. The content
 * goes to a temp file first (flushed to disk), which is then hard-linked into place: the link
 * fails if `path` exists, so of several processes creating the same file at once exactly one
 * succeeds, and readers never see a half-written file. The temp file starts with a dot and
 * ends in `.tmp`; one left by a crash is removed by {@link removeStaleTempFiles}.
 */
export async function createFileExclusive(path: string, content: string): Promise<boolean> {
  const temp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await retryTransientWindows(() => link(temp, path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await retryTransientWindows(() => unlink(temp)).catch(() => {});
  }
  await syncDirectory(dirname(path));
  return true;
}

/** How old a temp file must be before {@link removeStaleTempFiles} takes it as left by a crash. */
export const STALE_TEMP_MS = 60_000;

/** Removes temp files (`.<name>.tmp`) in `dir` that are older than STALE_TEMP_MS. */
export async function removeStaleTempFiles(dir: string): Promise<void> {
  const now = Date.now();
  for (const name of await readdir(dir)) {
    if (!name.startsWith(".") || !name.endsWith(".tmp")) continue;
    const path = join(dir, name);
    const info = await stat(path).catch(() => undefined);
    if (info?.isFile() && now - info.mtimeMs > STALE_TEMP_MS) await unlink(path).catch(() => {});
  }
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

const TRANSIENT_WINDOWS_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Runs a file operation, retrying it briefly on Windows when it fails with EPERM, EBUSY or
 * EACCES. There a file another process has open, or one another process just deleted (it
 * stays "delete pending" until every handle on it is closed), refuses to be deleted, renamed,
 * linked or read for a moment: two `preside add`s of one folder at once hit this when one
 * deletes the entry the other is reading or deleting. graceful-fs and rimraf retry the same
 * way. Elsewhere, and after about a second and a half, the error is thrown as it is.
 */
export async function retryTransientWindows<T>(
  operation: () => Promise<T>,
  platform: NodeJS.Platform = process.platform,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (platform !== "win32" || !code || !TRANSIENT_WINDOWS_CODES.has(code) || attempt >= 10) {
        throw error;
      }
      await new Promise((done) => setTimeout(done, Math.min(10 * 2 ** attempt, 200)));
    }
  }
}
