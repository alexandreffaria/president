import { randomBytes } from "node:crypto";
import { link, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
 * How long `<lock>.break` may exist before it is taken to be left by a process that died
 * holding it. It is held for two file operations, so this only happens after a crash.
 */
export const BREAKER_STALE_MS = 5000;

/**
 * Runs `task` while holding `lockPath`, a lock shared by every process (the CLI, each
 * agent's CLI, the server). The lock is a file holding the owner's pid and a random id. It
 * is created whole (written to a temp file, then hard-linked into place, which fails if the
 * lock exists), so its content never changes while it exists.
 *
 * A lock is broken when its owner process is gone (it crashed) or it is older than `stale`.
 * Every removal of the lock, a release or a break, goes through `removeLockIf`, which holds
 * a second lock (`<lock>.break`) while it checks the content and removes the file. So no
 * one removes a lock they didn't just see: one that replaced the stale lock is left alone.
 */
export async function withFileLock<T>(
  lockPath: string,
  task: () => Promise<T>,
  { timeout = 15_000, stale = 30_000 }: FileLockOptions = {},
): Promise<T> {
  const id = lockId();
  const deadline = Date.now() + timeout;
  for (let attempt = 0; !(await createExclusive(lockPath, id)); attempt++) {
    const holder = await readLock(lockPath);
    if (holder && (holder.age > stale || !isAlive(holder.pid))) {
      await removeLockIf(lockPath, holder.content);
      continue;
    }
    if (Date.now() > deadline) {
      throw new FileLockTimeout(lockPath, holder?.pid);
    }
    await sleep(backoff(attempt));
  }
  try {
    return await task();
  } finally {
    // Still ours, unless it was broken as stale meanwhile.
    await removeLockIf(lockPath, id).catch(() => {});
  }
}

export class FileLockTimeout extends Error {
  constructor(lockPath: string, pid: number | undefined) {
    super(
      `${lockPath} is held by ${pid === undefined ? "another process" : `process ${pid}`}. If no president command is running, delete that file.`,
    );
  }
}

function lockId(): string {
  return `${process.pid} ${randomBytes(8).toString("hex")}`;
}

/** Back off a little more each time, with jitter so waiting processes spread out. */
function backoff(attempt: number): number {
  return Math.min(5 + attempt * 5, 100) * (0.5 + Math.random());
}

/** Creates `path` holding `content`, unless it exists. True when it was created. */
async function createExclusive(path: string, content: string): Promise<boolean> {
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temp, content, { encoding: "utf8", flag: "wx" });
  try {
    await link(temp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await unlink(temp).catch(() => {});
  }
}

/**
 * Removes the lock if it still holds `content`, under `<lock>.break`. Every removal holds
 * that, and a lock can only be created where none exists, so between the check and the
 * removal the lock can't change. A breaker older than BREAKER_STALE_MS was left by a crash
 * and is removed by age alone.
 */
async function removeLockIf(lockPath: string, content: string): Promise<void> {
  const breaker = `${lockPath}.break`;
  for (let attempt = 0; !(await createExclusive(breaker, lockId())); attempt++) {
    const age = await stat(breaker).then(
      (info) => Date.now() - info.mtimeMs,
      () => undefined,
    );
    if (age !== undefined && age > BREAKER_STALE_MS) await unlink(breaker).catch(() => {});
    else await sleep(backoff(attempt));
  }
  try {
    const current = await readFile(lockPath, "utf8").catch((error: unknown) => {
      if (isNotFound(error)) return undefined;
      throw error;
    });
    if (current === content) await unlink(lockPath);
  } finally {
    await unlink(breaker).catch(() => {});
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
      // Not a pid (a lock written by something else): only its age can break it.
      pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
      age: Date.now() - info.mtimeMs,
    };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
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
