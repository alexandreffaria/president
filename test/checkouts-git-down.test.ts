/**
 * When git can't answer for a moment (a timeout, or it can't start), the hub keeps the
 * checkouts git last listed for the folder instead of falling back to the folder alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutsOf, forgetCheckouts } from "../src/server/checkouts.ts";
import type { GitResult } from "../src/server/git.ts";

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
  const root = process.platform === "win32" ? "C:\\r" : "/r";
  const list = [
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
    vi.useFakeTimers({ now: 0 });
    try {
      expect(await checkoutsOf({ path: root })).toEqual([{ path: root, branch: null }]);
      vi.setSystemTime(5000);
      git.next.push(ok(list));
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
});
