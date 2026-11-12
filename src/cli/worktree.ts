/**
 * Telling an agent it is in a git worktree: there, `decisions/` is the worktree's own copy,
 * without the human's uncommitted answers, so `pending` misses them and `applied`, `seen`
 * and `update` mark that copy (#0022).
 */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

/** A folder inside a linked git worktree, and the same folder in the repository's other checkouts. */
export interface LinkedWorktree {
  /** In the main checkout; undefined when that is bare, or when git can't say. */
  main?: string;
  /** The repository is bare: every checkout is a linked worktree. */
  bare: boolean;
  /** In every other checkout that isn't bare, the main one first. */
  checkouts: string[];
}

/**
 * Whether `dir` is inside a linked git worktree (one made by `git worktree add`), and if so
 * where the same folder is in the repository's other checkouts. Undefined when it isn't in
 * one, or when git can't say (not installed, too old, not a repository): this is only a hint.
 */
export async function linkedWorktree(dir: string): Promise<LinkedWorktree | undefined> {
  const dirs = await git(dir, [
    "rev-parse",
    "--path-format=absolute",
    "--git-dir",
    "--git-common-dir",
    "--show-toplevel",
  ]);
  // Before git 2.31, rev-parse prints the --path-format it doesn't know as a line of its own,
  // and the paths as they are (".git" in a main checkout): that is no answer.
  const lines = dirs?.split("\n") ?? [];
  if (lines.length !== 3 || !lines.every(isAbsolute)) return undefined;
  const [gitDir, commonDir, top] = lines as [string, string, string];
  // In the main checkout (and in a submodule) both are the same folder.
  if (gitDir === commonDir) return undefined;

  const inside = relative(top, await realpath(dir).catch(() => dir));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return { bare: false, checkouts: [] };
  }
  // One entry per checkout, the main one (or the bare repository) first.
  const entries = ((await git(dir, ["worktree", "list", "--porcelain"])) ?? "")
    .split("\n\n")
    .map((entry) => entry.split("\n"));
  const here = await realpath(top).catch(() => top);
  const bare = entries[0]?.includes("bare") ?? false;
  const checkouts: string[] = [];
  let main: string | undefined;
  for (const [index, [first, ...attributes]] of entries.entries()) {
    const path = first?.startsWith("worktree ") ? first.slice("worktree ".length) : undefined;
    // A path git had to quote (a newline in it) starts with a quote: left out.
    if (path === undefined || !isAbsolute(path) || attributes.includes("bare")) continue;
    if ((await realpath(path).catch(() => path)) === here) continue;
    const same = join(path, inside);
    if (index === 0) main = same;
    checkouts.push(same);
  }
  return main === undefined ? { bare, checkouts } : { main, bare, checkouts };
}

/** Git's output without its final newline, or undefined when it failed. */
async function git(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await promisify(execFile)("git", args, {
      cwd,
      env: withoutRepoVariables(),
      timeout: 5_000,
      windowsHide: true,
    });
    return stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
  } catch {
    return undefined;
  }
}

/**
 * The environment without the variables that make git answer about another repository than
 * the folder's (a git hook sets GIT_DIR, `git -c` passes GIT_CONFIG_PARAMETERS). The others,
 * GIT_CEILING_DIRECTORIES or GIT_CONFIG_GLOBAL for example, are the user's and stay.
 */
function withoutRepoVariables(): NodeJS.ProcessEnv {
  const repo = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|NAMESPACE|PREFIX)$/;
  const config = /^GIT_CONFIG(|_PARAMETERS|_COUNT|_KEY_\d+|_VALUE_\d+)$/;
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !repo.test(key) && !config.test(key)),
  );
}
