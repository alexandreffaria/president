/**
 * Telling an agent it is in a git worktree: there, `decisions/` is the worktree's own copy,
 * without the human's uncommitted answers, so `pending` misses them and `applied`, `seen`
 * and `update` mark that copy (#0022).
 */
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

/**
 * Whether `dir` is inside a linked git worktree (one made by `git worktree add`), and if so
 * the same folder in the repository's main checkout when that can be told. Undefined when it
 * isn't in one, or when git can't say (not installed, not a repository): this is only a hint.
 */
export async function linkedWorktree(dir: string): Promise<{ main?: string } | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir", "--show-toplevel"],
      // GIT_DIR and the like (set in a git hook) would make git answer about another folder.
      { cwd: dir, env: withoutGitVariables(), timeout: 5_000 },
    ));
  } catch {
    return undefined;
  }
  const [gitDir, commonDir, top] = stdout.split("\n");
  // In the main checkout (and in a submodule) both are the same folder.
  if (!gitDir || !commonDir || !top || gitDir === commonDir) return undefined;
  // The main checkout is the folder that holds the common .git folder (not so for a bare one).
  if (basename(commonDir) !== ".git") return {};
  const inside = relative(top, await realpath(dir).catch(() => dir));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return {};
  return { main: join(dirname(commonDir), inside) };
}

function withoutGitVariables(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}
