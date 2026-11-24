/**
 * The git wrapper Sync works through: one project folder, the git commands Sync runs there
 * and what it reads from them.
 */
import { existsSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type GitOptions, type GitResult, runGit, splitZ } from "../git.ts";
import { DECISIONS_DIR } from "../registry.ts";

export type SyncOptions = GitOptions;

export const CARDS = `${DECISIONS_DIR}/`;
const MAX_GIT_ERROR = 1200;
const SUBMODULES = "it has git submodules, which Sync doesn't handle";
const TOO_MANY_HERE =
  "This project has more changed files than Sync can check. Commit the work there or put it away, then press Sync again.";

/** A git command that failed where the sequence can't go on. */
export class GitFailed extends Error {
  readonly result: GitResult;
  /** What the human can do, when it isn't "fix what git reports". */
  readonly action?: string;
  constructor(args: string[], result: GitResult, action?: string) {
    super(`git ${args.join(" ")} failed`);
    this.result = result;
    this.action = action;
  }
}

/** git's error output, short enough to show. */
export function gitErrorText(result: GitResult): string {
  const text = (result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`).trim();
  return text.length > MAX_GIT_ERROR ? `…${text.slice(-MAX_GIT_ERROR)}` : text;
}

export class Repo {
  readonly dir: string;
  readonly #options: SyncOptions;

  constructor(dir: string, options: SyncOptions) {
    this.dir = dir;
    this.#options = options;
  }

  run(args: string[], env?: Record<string, string>): Promise<GitResult> {
    const options = env
      ? { ...this.#options, env: { ...this.#options.env, ...env } }
      : this.#options;
    return runGit(this.dir, args, options);
  }

  /**
   * Runs git and returns its output; a failure, or output cut at the limit, throws GitFailed.
   * `tooLarge` is the action shown when the output is cut.
   */
  async out(args: string[], tooLarge = TOO_MANY_HERE): Promise<string> {
    const result = await this.run(args);
    if (result.code !== 0) throw new GitFailed(args, result);
    if (result.truncated) {
      const stderr = `git output too large: git ${args[0]} printed more than Sync reads, so Sync stopped there.`;
      throw new GitFailed(args, { ...result, stderr }, tooLarge);
    }
    return result.stdout;
  }

  /** NUL-separated paths from a `-z` command. */
  async paths(args: string[], tooLarge?: string): Promise<string[]> {
    return splitZ(await this.out(args, tooLarge));
  }

  /**
   * Why Sync can't work here, or undefined when the folder is the top of a git work tree.
   */
  async unavailable(): Promise<string | undefined> {
    // The top folder of a work tree always holds .git (a folder, or a file in a worktree).
    // Checked first, so this costs no git process in any other folder.
    if (!(await lstat(join(this.dir, ".git")).then(Boolean, () => false))) {
      return "it isn't the top folder of a git repository";
    }
    const result = await this.run(["rev-parse", "--show-toplevel"]);
    if (result.code !== 0) return `git can't read it: ${gitErrorText(result)}`;
    const top = result.stdout.trim();
    const [realTop, realDir] = await Promise.all([
      realpath(top).catch(() => top),
      realpath(this.dir).catch(() => this.dir),
    ]);
    if (realTop !== realDir) {
      return `it is inside the git repository ${top} rather than its top folder, and Sync only works on a project that is a repository's top folder`;
    }
    // A pull can delete an agent's files inside a submodule without a word, so Sync leaves a
    // project with submodules (a .gitmodules file, or a gitlink in the index) alone.
    if (await lstat(join(this.dir, ".gitmodules")).then(Boolean, () => false)) {
      return SUBMODULES;
    }
    // Only each entry's mode (7 bytes), so the list fits for any real repository. A git
    // older than 2.38 doesn't know --format and gets the longer --stage list instead.
    let index = await this.run(["ls-files", "-z", "--format=%(objectmode)"]);
    if (index.code !== 0) index = await this.run(["ls-files", "--stage", "-z"]);
    if (index.code !== 0) return `git can't read it: ${gitErrorText(index)}`;
    // A cut list may miss a gitlink: refuse rather than guess.
    if (index.truncated) return "git's list of its files is too long to check for submodules";
    if (splitZ(index.stdout).some((entry) => entry.startsWith("160000"))) return SUBMODULES;
    return undefined;
  }

  /**
   * A rebase, merge, cherry-pick, revert, sequence of those, or bisect that someone started
   * and hasn't finished.
   */
  async inProgress(): Promise<InProgressKind | undefined> {
    const lines = (
      await this.out(["rev-parse", ...IN_PROGRESS.flatMap(({ path }) => ["--git-path", path])])
    )
      .split("\n")
      .filter(Boolean);
    for (const [i, { path, kind }] of IN_PROGRESS.entries()) {
      const found = lines[i];
      if (found === undefined) throw new Error(`git rev-parse --git-path ${path} printed nothing`);
      if (existsSync(resolve(this.dir, found))) return kind;
    }
    return undefined;
  }

  /** Files with unmerged entries in the index (a conflict nobody has resolved yet). */
  async unmerged(): Promise<string[]> {
    return unique(
      splitZ(await this.out(["ls-files", "--unmerged", "-z"])).map((entry) =>
        entry.slice(entry.indexOf("\t") + 1),
      ),
    );
  }

  /** The checked-out branch (undefined when HEAD is detached) and what it tracks. */
  async branch(): Promise<{ branch?: string; upstream?: string; remote?: string }> {
    const head = await this.run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (head.code !== 0) return {};
    const branch = head.stdout.trim();
    const upstream = await this.run(["rev-parse", "--symbolic-full-name", "@{u}"]);
    if (upstream.code !== 0 || !upstream.stdout.trim()) return { branch };
    const remote = await this.run(["config", "--get", `branch.${branch}.remote`]);
    return {
      branch,
      upstream: upstream.stdout.trim(),
      remote: remote.code === 0 ? remote.stdout.trim() : undefined,
    };
  }

  /** The remote's default branch ("main"), from refs/remotes/<remote>/HEAD or the remote. */
  async remoteDefault(remote: string): Promise<{ name: string } | { error: string }> {
    const local = await this.run(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]);
    const prefix = `refs/remotes/${remote}/`;
    if (local.code === 0 && local.stdout.trim().startsWith(prefix)) {
      return { name: local.stdout.trim().slice(prefix.length) };
    }
    // Not recorded locally (followRemoteHEAD=never, or an old git): ask the remote. Read-only.
    const asked = await this.run(["ls-remote", "--symref", remote, "HEAD"]);
    const match = /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(asked.stdout);
    if (asked.code === 0 && match?.[1]) return { name: match[1] };
    return { error: gitErrorText(asked) };
  }

  /** Whether the repository has any remote at all. */
  async hasRemote(): Promise<boolean> {
    return (await this.out(["remote"])).trim() !== "";
  }

  /**
   * Cards the right side of `range` ("a...b") changed since its last common commit with the
   * left: by default, the upstream's since HEAD's.
   */
  remoteCardChanges(range = "HEAD...@{u}", tooLarge?: string): Promise<string[]> {
    return this.paths(["diff", "--name-only", "-z", "--no-renames", range, "--", CARDS], tooLarge);
  }

  /** The commit `rev` names. */
  async commit(rev: string): Promise<string> {
    return (await this.out(["rev-parse", "--verify", `${rev}^{commit}`])).trim();
  }

  /** Whether the commit `ancestor` is `descendant` or one of its ancestors. */
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    const args = ["merge-base", "--is-ancestor", ancestor, descendant];
    const result = await this.run(args);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new GitFailed(args, result);
  }
}

export type InProgressKind = "rebase" | "merge" | "cherry-pick" | "revert" | "sequence" | "bisect";

/** What each kind of unfinished git operation leaves in the git folder, checked in order. */
const IN_PROGRESS: { path: string; kind: InProgressKind }[] = [
  { path: "rebase-merge", kind: "rebase" },
  { path: "rebase-apply", kind: "rebase" },
  { path: "MERGE_HEAD", kind: "merge" },
  { path: "CHERRY_PICK_HEAD", kind: "cherry-pick" },
  { path: "REVERT_HEAD", kind: "revert" },
  { path: "sequencer", kind: "sequence" },
  { path: "BISECT_LOG", kind: "bisect" },
];

export function unique(list: string[]): string[] {
  return [...new Set(list)].sort();
}

export const isCardPath = (path: string) => path.startsWith(CARDS);
