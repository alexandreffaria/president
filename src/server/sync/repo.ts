/**
 * The git wrapper Sync works through: one project folder, the git commands Sync runs there
 * and what it reads from them.
 */
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type GitOptions, type GitResult, runGit, splitZ } from "../git.ts";
import { DECISIONS_DIR } from "../registry.ts";

export interface SyncOptions extends GitOptions {
  /** The machine's name in commit messages ("decisions from laptop: ..."). */
  hostname?: string;
}

export const CARDS = `${DECISIONS_DIR}/`;
const MAX_GIT_ERROR = 1200;
const SUBMODULES = "it has git submodules, which Sync doesn't handle";
const TOO_MANY_HERE =
  "This project has more changed files than Sync can check. Commit and push the work there by hand, or put it away, then press Sync again.";

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
    // Checked first, so this costs no git process in such a folder (the top bar's count of
    // a skipped project's answers, skippedCardChanges, runs one there).
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
   * For a project Sync skips, its card changes all the same (20261112l9vh, count-apart):
   * inside a bigger repository they are counted against that repository's upstream (the
   * pathspec is relative to the project folder, so only this project's cards count). 0 for a
   * folder outside git, which keeps no record of what was sent, or one git can't read.
   */
  async skippedCardChanges(): Promise<number> {
    if ((await this.run(["rev-parse", "--show-toplevel"])).code !== 0) return 0;
    try {
      const { upstream } = await this.branch();
      return (await this.localCardChanges(upstream !== undefined)).length;
    } catch (error) {
      // Output cut at the limit, or a timeout, gives 0 too, and the line goes. The pathspec
      // keeps the lists to decisions/, so that would take tens of thousands of changed cards.
      if (error instanceof GitFailed) return 0;
      throw error;
    }
  }

  /**
   * A rebase, merge, cherry-pick, revert, sequence of those, or bisect that someone started
   * and hasn't finished. For a rebase, also the autostash it holds (the commit with the
   * uncommitted changes it set aside), if any.
   */
  async inProgress(): Promise<InProgress | undefined> {
    const lines = (
      await this.out(["rev-parse", ...IN_PROGRESS.flatMap(({ path }) => ["--git-path", path])])
    )
      .split("\n")
      .filter(Boolean);
    for (const [i, { path, kind }] of IN_PROGRESS.entries()) {
      const found = lines[i];
      if (found === undefined) throw new Error(`git rev-parse --git-path ${path} printed nothing`);
      const full = resolve(this.dir, found);
      if (!existsSync(full)) continue;
      if (kind !== "rebase") return { kind };
      const autostash = await readFile(join(full, "autostash"), "utf8").then(
        (text) => (/^[0-9a-f]{40,64}$/.test(text.trim()) ? text.trim() : undefined),
        () => undefined,
      );
      return autostash ? { kind, autostash } : { kind };
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

  /** The files whose uncommitted changes the stash commit `sha` holds. */
  async stashedFiles(sha: string): Promise<string[]> {
    const result = await this.run(["diff", "--name-only", "-z", "--no-renames", `${sha}^1`, sha]);
    return result.code === 0 ? unique(splitZ(result.stdout)) : [];
  }

  /**
   * Whether the commits in `range` include one that changes something outside decisions/,
   * or one that changes nothing at all (an empty commit: Sync's own commits always have
   * cards in them). Check 2.
   */
  async hasCodeCommits(range: string): Promise<boolean> {
    // Each commit is "\x01<sha>", then its paths, all NUL-separated.
    const output = await this.out([
      "log",
      "--format=%x01%H",
      "--name-only",
      "-z",
      "--no-renames",
      "--diff-merges=first-parent",
      range,
    ]);
    let paths: number | undefined;
    for (const token of output.split("\0")) {
      if (token.startsWith("\x01")) {
        if (paths === 0) return true;
        paths = 0;
        continue;
      }
      const path = token.replace(/^\n+/, "");
      if (!path) continue;
      if (paths === undefined || !isCardPath(path)) return true;
      paths++;
    }
    return paths === 0;
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

  /** Changed and new files under decisions/, plus those changed by unpushed commits. */
  async localCardChanges(hasUpstream: boolean): Promise<string[]> {
    const status = splitZ(
      await this.out([
        "status",
        "--porcelain=v1",
        "-z",
        "--no-renames",
        "--untracked-files=all",
        "--",
        CARDS,
      ]),
    ).map((entry) => entry.slice(3));
    const committed = hasUpstream
      ? await this.paths(["diff", "--name-only", "-z", "--no-renames", "@{u}...HEAD", "--", CARDS])
      : [];
    return unique([...status, ...committed]);
  }

  /** Cards the remote changed since this checkout's last common commit with it. */
  remoteCardChanges(): Promise<string[]> {
    return this.paths(["diff", "--name-only", "-z", "--no-renames", "HEAD...@{u}", "--", CARDS]);
  }

  /** `git stash list`: each entry's commit, its name now (stash@{n}) and its subject. */
  async stashEntries(): Promise<StashEntry[]> {
    // The stash is shared by every worktree of the repository, and agents use it too.
    return (await this.out(["stash", "list", "--format=%H%x00%gd%x00%gs"]))
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", ref = "", subject = ""] = line.split("\0");
        return { sha, ref, subject };
      });
  }

  conflicted(): Promise<string[]> {
    return this.paths(["diff", "--name-only", "-z", "--diff-filter=U"]);
  }
}

export type InProgressKind = "rebase" | "merge" | "cherry-pick" | "revert" | "sequence" | "bisect";

export interface InProgress {
  kind: InProgressKind;
  /** A rebase's autostash: the commit holding the uncommitted changes it set aside. */
  autostash?: string;
}

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

export interface StashEntry {
  sha: string;
  /** Its name when it was listed ("stash@{2}"); it changes as entries come and go. */
  ref: string;
  subject: string;
}

export function unique(list: string[]): string[] {
  return [...new Set(list)].sort();
}

export const isCardPath = (path: string) => path.startsWith(CARDS);
