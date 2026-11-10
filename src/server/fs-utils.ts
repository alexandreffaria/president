import { randomBytes } from "node:crypto";
import { link, open, readFile, rename, stat, unlink } from "node:fs/promises";
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

export interface FileLockOptions {
  /** Give up after this long (ms). */
  timeout?: number;
  /** A lock older than this (ms) is taken to be left by a process that hung or crashed. */
  stale?: number;
}

/**
 * Runs `task` while holding `lockPath`, a lock shared by every process (the CLI, each
 * agent's CLI, the server). The lock is a file created with O_EXCL that holds the owner's
 * pid and a random id; it is removed when the task ends.
 *
 * A lock is broken when its owner process is gone (it crashed) or it is older than
 * `stale`. To break one, it is renamed away first, so of several processes that see the
 * same stale lock only one removes it, and a lock someone took in the meantime is put back.
 */
export async function withFileLock<T>(
  lockPath: string,
  task: () => Promise<T>,
  { timeout = 15_000, stale = 30_000 }: FileLockOptions = {},
): Promise<T> {
  const id = `${process.pid} ${randomBytes(8).toString("hex")}`;
  const deadline = Date.now() + timeout;
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(id, "utf8");
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const holder = await readLock(lockPath);
    if (holder && (holder.age > stale || !isAlive(holder.pid))) {
      await breakLock(lockPath, holder.content);
      continue;
    }
    if (Date.now() > deadline) {
      throw new FileLockTimeout(lockPath, holder?.pid);
    }
    // Back off a little more each time, with jitter so waiting processes spread out.
    await sleep(Math.min(5 + attempt * 5, 100) * (0.5 + Math.random()));
  }
  try {
    return await task();
  } finally {
    // Only remove the lock if it is still ours (it is, unless it was broken as stale).
    if ((await readLock(lockPath))?.content === id) await unlink(lockPath).catch(() => {});
  }
}

export class FileLockTimeout extends Error {
  constructor(lockPath: string, pid: number | undefined) {
    super(
      `${lockPath} is held by ${pid === undefined ? "another process" : `process ${pid}`}. If no president command is running, delete that file.`,
    );
  }
}

async function readLock(
  lockPath: string,
): Promise<{ content: string; pid: number | undefined; age: number } | undefined> {
  try {
    const [content, info] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    const pid = Number(content.split(" ")[0]);
    return {
      content,
      // An empty lock is one whose owner hasn't written its id yet: treat it as alive.
      pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
      age: Date.now() - info.mtimeMs,
    };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function breakLock(lockPath: string, staleContent: string): Promise<void> {
  const aside = `${lockPath}.${process.pid}.${randomBytes(4).toString("hex")}.stale`;
  try {
    await rename(lockPath, aside);
  } catch (error) {
    if (isNotFound(error)) return; // someone else broke it
    throw error;
  }
  const taken = await readFile(aside, "utf8").catch(() => staleContent);
  if (taken !== staleContent) {
    // Between our read and the rename, another process broke the stale lock and took a
    // new one: give it back (unless yet another lock exists by now).
    await link(aside, lockPath).catch(() => {});
  }
  await unlink(aside).catch(() => {});
}

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

export function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
