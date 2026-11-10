import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKER_STALE_MS, FileLockTimeout, withFileLock } from "../src/server/fs-utils.ts";
import { tempDir } from "./helpers.ts";

/**
 * Lets a test run code just before a file operation of one contender (named with
 * `contender.run`), to force an interleaving of several lock holders.
 */
const hooks = vi.hoisted(() => ({
  before: undefined as
    | ((op: string, path: string, who: string | undefined) => Promise<void> | void)
    | undefined,
  contender: undefined as unknown as { getStore(): string | undefined },
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const wrap =
    <A extends unknown[], R>(op: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await hooks.before?.(
        op,
        String(args[1] && op === "link" ? args[1] : args[0]),
        hooks.contender?.getStore(),
      );
      return fn(...args);
    };
  return {
    ...real,
    readFile: wrap("readFile", real.readFile),
    link: wrap("link", real.link),
    unlink: wrap("unlink", real.unlink),
  };
});
const contender = new AsyncLocalStorage<string>();
hooks.contender = contender;

afterEach(() => {
  hooks.before = undefined;
});

/** The pid of a process that has exited. */
async function deadPid(): Promise<number> {
  const child = execFile(process.execPath, ["-e", ""]);
  await new Promise((done) => child.on("exit", done));
  return child.pid as number;
}

describe("withFileLock", () => {
  it("runs one task at a time and removes the lock after", async () => {
    const lock = join(await tempDir(), "x.lock");
    let running = 0;
    let most = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        withFileLock(lock, async () => {
          running += 1;
          most = Math.max(most, running);
          await new Promise((done) => setTimeout(done, 5));
          order.push(i);
          running -= 1;
        }),
      ),
    );
    expect(most).toBe(1);
    expect(order.sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(await readdir(join(lock, ".."))).toEqual([]);
  });

  it("removes the lock when the task fails", async () => {
    const lock = join(await tempDir(), "x.lock");
    await expect(
      withFileLock(lock, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await withFileLock(lock, async () => "free")).toBe("free");
  });

  it("breaks a lock whose process is gone", async () => {
    const lock = join(await tempDir(), "x.lock");
    await writeFile(lock, `${await deadPid()} abc`);
    expect(await withFileLock(lock, async () => "ran", { timeout: 1000 })).toBe("ran");
    expect(await readdir(join(lock, ".."))).toEqual([]);
  });

  it("breaks a lock older than `stale`, even if its process is alive", async () => {
    const lock = join(await tempDir(), "x.lock");
    await writeFile(lock, `${process.pid} abc`);
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    expect(await withFileLock(lock, async () => "ran", { timeout: 1000 })).toBe("ran");
  });

  it("gives up on a live lock after `timeout`, naming the file and the process", async () => {
    const lock = join(await tempDir(), "x.lock");
    await writeFile(lock, `${process.pid} abc`);
    const error = await withFileLock(lock, async () => "ran", { timeout: 50 }).catch((e) => e);
    expect(error).toBeInstanceOf(FileLockTimeout);
    expect(error.message).toBe(
      `${lock} is held by process ${process.pid}. If no president command is running, delete that file.`,
    );
  });

  it("waits while another process is breaking the lock", async () => {
    const lock = join(await tempDir(), "x.lock");
    await writeFile(lock, `${await deadPid()} abc`);
    await writeFile(`${lock}.break`, "someone");
    const run = withFileLock(lock, async () => "ran", { timeout: 2000 });
    await new Promise((done) => setTimeout(done, 100));
    expect(await readFile(lock, "utf8")).toMatch(/ abc$/);
    await rm(`${lock}.break`);
    expect(await run).toBe("ran");
  });

  it("removes a breaker lock left by a crash, by its age", async () => {
    const lock = join(await tempDir(), "x.lock");
    await writeFile(lock, `${await deadPid()} abc`);
    await writeFile(`${lock}.break`, "crashed");
    const old = new Date(Date.now() - BREAKER_STALE_MS - 1000);
    await utimes(`${lock}.break`, old, old);
    expect(await withFileLock(lock, async () => "ran", { timeout: 1000 })).toBe("ran");
    expect(await readdir(join(lock, ".."))).toEqual([]);
  });

  it("never removes a lock that replaced the stale one it saw (R4-2)", async () => {
    // The interleaving from the round-4 review: A and B both see the stale lock X. A breaks
    // it and takes the lock. B, slower, then tries to break X too, and C tries to take the
    // lock in the middle of that. B must leave A's lock in place, and only one of them may
    // be inside at a time.
    const lock = join(await tempDir(), "x.lock");
    const breaker = `${lock}.break`;
    await writeFile(lock, `${await deadPid()} stale`);
    const signal = () => {
      let done!: () => void;
      const promise = new Promise<void>((resolve) => {
        done = resolve;
      });
      return { promise, done };
    };
    const bSawX = signal();
    const aIn = signal();
    const cTried = signal();
    const release = signal();
    const inside = new Set<string>();
    const overlaps: string[] = [];
    let aLock = "";
    const task = (name: string) => async () => {
      inside.add(name);
      if (inside.size > 1) overlaps.push([...inside].sort().join("+"));
      if (name === "A") {
        aLock = await readFile(lock, "utf8");
        aIn.done();
      }
      await release.promise;
      inside.delete(name);
    };
    const run = (name: string) =>
      contender.run(name, () => withFileLock(lock, task(name), { timeout: 5000 }));

    let c: Promise<void> | undefined;
    let bBreaks = 0;
    let bReadsUnderBreaker = 0;
    hooks.before = async (op, path, who) => {
      // C has tried to create the lock (and failed, or it would be inside) and now reads it.
      if (who === "C" && op === "readFile" && path === lock) cTried.done();
      if (who !== "B") return;
      if (op === "link" && path === breaker && bBreaks++ === 0) {
        // B has read X and is about to break it: hold B until A has broken X and is inside.
        bSawX.done();
        await aIn.promise;
      }
      if (op === "readFile" && path === lock && bBreaks > 0 && bReadsUnderBreaker++ === 0) {
        // B holds the breaker and checks the lock: C tries to take the lock right now.
        c = run("C");
        await cTried.promise;
      }
    };
    const b = run("B");
    await bSawX.promise;
    const a = run("A");
    await aIn.promise;
    // Wait until B's attempt to break X is over: it gives the breaker back.
    while (bReadsUnderBreaker === 0 || (await readdir(join(lock, ".."))).includes("x.lock.break")) {
      await new Promise((done) => setTimeout(done, 5));
    }
    expect(await readFile(lock, "utf8")).toBe(aLock);
    expect([...inside]).toEqual(["A"]);
    release.done();
    await Promise.all([a, b, c]);
    expect(overlaps).toEqual([]);
    expect(await readdir(join(lock, ".."))).toEqual([]);
  });
});
