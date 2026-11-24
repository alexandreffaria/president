/**
 * When git can't answer for a moment (a timeout, or it can't start), the hub keeps the
 * checkouts git last listed for the folder instead of falling back to the folder alone.
 */
import { realpath, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutsOf, forgetCheckouts } from "../src/server/checkouts.ts";
import type { GitResult } from "../src/server/git.ts";
import { tempDir } from "./helpers.ts";

const git = vi.hoisted(() => ({ next: [] as GitResult[] }));
vi.mock("../src/server/git.ts", () => ({
  runGit: async () =>
    git.next.shift() ?? { code: 128, stdout: "", stderr: "", timedOut: false, truncated: false },
}));

const ok = (stdout: string): GitResult => ({
  code: 0,
  stdout,
  stderr: "",
  timedOut: false,
  truncated: false,
});
const down: GitResult = {
  code: null,
  stdout: "",
  stderr: "timed out",
  timedOut: true,
  truncated: false,
};

afterEach(() => forgetCheckouts());

describe("checkoutsOf when git is down", () => {
  const listOf = (root: string) =>
    [
      `worktree ${root}`,
      "HEAD 1",
      "branch refs/heads/main",
      "",
      `worktree ${root}-feat`,
      "HEAD 2",
      "branch refs/heads/feat",
      "",
    ].join("\n");

  it("keeps the last answer, and is the folder alone with none", async () => {
    const root = await realpath(await tempDir());
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    try {
      expect(await checkoutsOf({ path: root })).toEqual([{ path: root, branch: null }]);
      vi.setSystemTime(5000);
      git.next.push(ok(listOf(root)));
      const good = await checkoutsOf({ path: root });
      expect(good).toEqual([
        { path: root, branch: "main" },
        { path: `${root}-feat`, branch: "feat" },
      ]);
      vi.setSystemTime(10_000);
      git.next.push(down);
      expect(await checkoutsOf({ path: root })).toEqual(good);
      // Not a repository any more (an exit code): just the folder.
      vi.setSystemTime(15_000);
      expect(await checkoutsOf({ path: root })).toEqual([{ path: root, branch: null }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets the last answer once the folder itself is gone", async () => {
    const root = await realpath(await tempDir());
    vi.useFakeTimers({ now: 0, toFake: ["Date"] });
    try {
      git.next.push(ok(listOf(root)));
      expect(await checkoutsOf({ path: root })).toHaveLength(2);
      await rm(root, { recursive: true });
      vi.setSystemTime(5000);
      git.next.push(down);
      expect(await checkoutsOf({ path: root })).toEqual([{ path: root, branch: null }]);
    } finally {
      vi.useRealTimers();
    }
  });
});
