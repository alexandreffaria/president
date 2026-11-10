import { execFile } from "node:child_process";
import { readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileLockTimeout, withFileLock } from "../src/server/fs-utils.ts";
import { tempDir } from "./helpers.ts";

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
});
