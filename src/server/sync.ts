/**
 * Sync (card #0001, docs/roadmap.md "Sync"): commits the human's card changes in a project,
 * pulls the other machines' changes and pushes, only when the human presses Sync. When the
 * hub starts it only fetches.
 *
 * Per project, exactly the card's sequence:
 *
 *   git fetch
 *   # checks; if one fails, stop, change nothing and say why:
 *   #  1. the remote's default branch is checked out (tracking it); no rebase, merge,
 *   #     cherry-pick, revert, sequence of those or bisect in progress, and no unmerged file
 *   #  2. git log @{u}..HEAD has no unpushed commit that changes files outside decisions/
 *   #     (or no files at all: an empty commit)
 *   #  3. no file outside decisions/ that the remote changed (git diff HEAD...@{u}) has
 *   #     uncommitted edits here (git diff HEAD)
 *   # the "in progress" part of check 1 once more, right before the first change
 *   git add -- decisions/
 *   git commit --only -m "decisions from laptop: 0003, 0005" -- decisions/   # if anything is staged
 *   git pull --rebase --autostash   # on failure: name the conflicted cards, git rebase --abort, don't push
 *   # stop if any file is conflicted or git stash list has a new entry
 *   # read HEAD once; check again: same branch and upstream, nothing in progress, check 2
 *   git push <remote> <that commit>:refs/heads/<main>   # never a bare git push
 *
 * The card says what goes wrong without each step. The rest is from review round 1 of
 * PR #12: a bare `git push` follows push.default (matching pushes every branch with a
 * namesake on the remote) and remote.pushDefault; an agent can commit or switch branches
 * while the commit's hooks and the pull run; the stash is shared with agents, so only the
 * entry git names "autostash" is called git's. Sync only runs in a project whose folder
 * is the top folder of its git repository (or worktree), so it never commits into a
 * repository that merely contains the project (a home folder kept in git, say).
 *
 * Only one git sequence runs per project at a time, and the hub refuses card actions in a
 * project while its Sync runs (see {@link SyncService.writeCard}).
 */
import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, join, resolve } from "node:path";
import type {
  ProjectSyncStatus,
  SyncOutcome,
  SyncResultDto,
  SyncRunResponse,
  SyncStatusResponse,
} from "../core/api.ts";
import { parseCardFileName } from "../core/card-file.ts";
import { revisionOf } from "./cards.ts";
import { UserError } from "./errors.ts";
import { KeyedMutex } from "./fs-utils.ts";
import { type GitOptions, type GitResult, runGit, splitZ } from "./git.ts";
import { DECISIONS_DIR, type Project, type Registry } from "./registry.ts";
import type { EventBus } from "./watcher.ts";

export interface SyncOptions extends GitOptions {
  /** The machine's name in commit messages ("decisions from laptop: ..."). */
  hostname?: string;
}

/** A project's Sync result without the project name and time. */
export type RepoSyncResult = Omit<SyncResultDto, "project" | "at">;

const CARDS = `${DECISIONS_DIR}/`;
const MAX_GIT_ERROR = 1200;
const SUBMODULES = "it has git submodules, which Sync doesn't handle";
const TOO_MANY_HERE =
  "This project has more changed files than Sync can check. Commit and push the work there by hand, or put it away, then press Sync again.";

/** A git command that failed where the sequence can't go on. */
class GitFailed extends Error {
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

class Repo {
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
    // Checked first, so folders that aren't repositories cost no git process at all.
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

type InProgressKind = "rebase" | "merge" | "cherry-pick" | "revert" | "sequence" | "bisect";

interface InProgress {
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

const IN_PROGRESS_TEXT: Record<InProgressKind, string> = {
  rebase: "a rebase",
  merge: "a merge",
  "cherry-pick": "a cherry-pick",
  revert: "a revert",
  sequence: "a series of cherry-picks or reverts",
  bisect: "a bisect",
};

interface StashEntry {
  sha: string;
  /** Its name when it was listed ("stash@{2}"); it changes as entries come and go. */
  ref: string;
  subject: string;
}

/** The subject git gives the entry it saves when it can't put an autostash back. */
const AUTOSTASH_SUBJECT = "autostash";

function unique(list: string[]): string[] {
  return [...new Set(list)].sort();
}

const listText = (paths: string[]) => paths.join(", ");
const hasHave = (paths: string[]) => (paths.length === 1 ? "has" : "have");

/**
 * The sentence about stash entries that appeared during Sync. Git's own (subject
 * "autostash") is named exactly; any other may be an agent's, so it is left alone.
 */
function stashText(entries: StashEntry[], dir: string): string {
  const ours = entries.filter((entry) => entry.subject === AUTOSTASH_SUBJECT);
  const others = entries.filter((entry) => entry.subject !== AUTOSTASH_SUBJECT);
  const parts: string[] = [];
  for (const entry of ours) {
    parts.push(
      `Git kept a copy in its stash entry named autostash (${entry.ref} when Sync looked, commit ${entry.sha}; git stash show -p ${entry.sha} in ${dir} shows it). Once the agent's files are right, drop only that entry, by the stash@{n} that git stash list shows next to "autostash" (a bare git stash drop removes the newest entry, which may be an agent's).`,
    );
  }
  if (others.length > 0) {
    parts.push(
      `${others.length === 1 ? "A new entry" : `${others.length} new entries`} also appeared in git stash list in ${dir} (${others.map((entry) => `"${entry.subject}"`).join(", ")}); ${others.length === 1 ? "it isn't" : "they aren't"} git's autostash, so ${others.length === 1 ? "it is" : "they are"} probably an agent's: leave ${others.length === 1 ? "it" : "them"} alone.`,
    );
  }
  return parts.join(" ");
}

/** Check 1's "nothing in progress" part, and no unresolved conflicts. Changes nothing. */
async function notInProgress(repo: Repo, name: string): Promise<RepoSyncResult | undefined> {
  const started = await repo.inProgress();
  if (started) return inProgressResult(repo, name, started);
  const unmerged = await repo.unmerged();
  if (unmerged.length > 0) {
    return result(
      "not-now",
      `Not now: ${listText(unmerged)} in ${name} ${hasHave(unmerged)} unresolved conflicts`,
      {
        action: `Press Sync again once they are resolved (git status in ${repo.dir} lists them).`,
      },
    );
  }
  return undefined;
}

async function inProgressResult(
  repo: Repo,
  name: string,
  started: InProgress,
): Promise<RepoSyncResult> {
  const note = await setAsideNote(repo, started);
  return result("not-now", `Not now: ${IN_PROGRESS_TEXT[started.kind]} is in progress in ${name}`, {
    action: `${note ? `${note} ` : ""}Press Sync again once it is finished or aborted (git status in ${repo.dir} shows it).`,
  });
}

/**
 * For a rebase holding an autostash (one a Sync left when the hub stopped mid-pull, say):
 * which files it set aside, and how to get them back.
 */
async function setAsideNote(repo: Repo, started: InProgress): Promise<string | undefined> {
  if (started.kind !== "rebase" || !started.autostash) return undefined;
  const files = await repo.stashedFiles(started.autostash);
  const what =
    files.length > 0
      ? `the uncommitted changes to ${listText(files)}: until it is finished or aborted, ${files.length === 1 ? "that file shows its" : "those files show their"} last committed content`
      : "the checkout's uncommitted changes until it is finished or aborted";
  return `The rebase has set aside ${what}. If no agent is running this rebase (a Sync cut short by the hub stopping leaves one behind), git rebase --abort in ${repo.dir} puts everything back as it was.`;
}

const isCardPath = (path: string) => path.startsWith(CARDS);

/** "0003" for decisions/0003-name.md; the file name for anything else. */
export function cardLabel(path: string): string {
  const name = basename(path);
  return parseCardFileName(name)?.id ?? name;
}

function cardLabels(paths: string[]): string[] {
  return unique(paths.map(cardLabel));
}

/** The machine's short name, for commit messages. */
export function machineName(): string {
  return hostname().split(".")[0] || "this machine";
}

/** "decisions from laptop: 0003, 0005, 0009" */
export function commitMessage(machine: string, paths: string[]): string {
  const ids = cardLabels(paths);
  return ids.length > 0
    ? `decisions from ${machine}: ${ids.join(", ")}`
    : `decisions from ${machine}`;
}

function result(
  outcome: SyncOutcome,
  message: string,
  extra: Partial<RepoSyncResult> = {},
): RepoSyncResult {
  return { outcome, message, sent: [], received: [], ...extra };
}

/**
 * Runs Sync in one project folder (`name` is used in messages). Never throws for a git
 * failure; the result says what happened and what to do.
 */
export async function syncRepo(
  dir: string,
  name: string,
  options: SyncOptions = {},
): Promise<RepoSyncResult> {
  return (await syncRepoDetailed(dir, name, options)).result;
}

/**
 * {@link syncRepo}, plus the card files whose content the pull changed in the checkout, at
 * the revisions read right after the pull, for "Sync just brought in a newer version of
 * this card".
 */
export async function syncRepoDetailed(
  dir: string,
  name: string,
  options: SyncOptions = {},
): Promise<{ result: RepoSyncResult; broughtIn: CardRevision[] }> {
  const pulled = { broughtIn: [] as CardRevision[] };
  return { result: await guardedSequence(dir, name, options, pulled), broughtIn: pulled.broughtIn };
}

async function guardedSequence(
  dir: string,
  name: string,
  options: SyncOptions,
  pulled: { broughtIn: CardRevision[] },
): Promise<RepoSyncResult> {
  const repo = new Repo(dir, options);
  try {
    return await runSequence(repo, name, options.hostname ?? machineName(), pulled);
  } catch (error) {
    if (error instanceof GitFailed) {
      return result("not-synced", `Not synced: git failed in ${name}`, {
        gitError: gitErrorText(error.result),
        action: error.action ?? "Fix what git reports, then press Sync again.",
      });
    }
    throw error;
  }
}

/** A card file (relative to its project's folder) at a revision. */
export interface CardRevision {
  path: string;
  revision: string;
}

/** The revisions of the card files at `paths` in `dir` now; deleted or unreadable ones are left out. */
async function cardRevisions(dir: string, paths: string[]): Promise<CardRevision[]> {
  const found: CardRevision[] = [];
  for (const path of paths) {
    if (!isCardPath(path)) continue;
    try {
      found.push({ path, revision: revisionOf(await readFile(join(dir, path), "utf8")) });
    } catch {
      // Deleted by the pull, or unreadable: no card view shows it.
    }
  }
  return found;
}

async function runSequence(
  repo: Repo,
  name: string,
  machine: string,
  report: { broughtIn: CardRevision[] },
): Promise<RepoSyncResult> {
  const dir = repo.dir;
  const unavailable = await repo.unavailable();
  if (unavailable) {
    return result("unavailable", `Not synced: ${name} is skipped because ${unavailable}`);
  }

  // Check 1, the parts that need no network: a rebase, merge, cherry-pick, ... someone
  // started, unresolved conflicts, a detached HEAD, no upstream.
  const busy = await notInProgress(repo, name);
  if (busy) return busy;
  const { branch, upstream, remote } = await repo.branch();
  if (!branch || !upstream) {
    if ((await repo.localCardChanges(false)).length === 0)
      return result("nothing", "Nothing to sync");
    return branch
      ? result(
          "not-now",
          `Not now: the branch ${branch} in ${name} has no upstream branch to pull from and push to`,
          {
            action: `Set one (for example git push -u origin ${branch} in ${dir}), then press Sync again.`,
          },
        )
      : result("not-now", `Not now: ${name} has no branch checked out (a detached HEAD)`, {
          action: `Your answers wait until ${name} is back on its main branch; then press Sync again.`,
        });
  }

  const fetched = await repo.run(["fetch"]);
  if (fetched.code !== 0) {
    return result("not-synced", `Not synced: couldn't fetch from the remote of ${name}`, {
      gitError: gitErrorText(fetched),
      action: "Nothing was changed. Check the connection and the remote, then press Sync again.",
    });
  }

  const local = await repo.localCardChanges(true);
  const remoteCards = await repo.remoteCardChanges();
  if (local.length === 0 && remoteCards.length === 0) return result("nothing", "Nothing to sync");

  // Check 1: the remote's default branch is checked out and tracks it.
  // The remote is the one main tracks (branch.main.remote), which is also where Sync pushes;
  // remote.pushDefault and branch.main.pushRemote are not followed.
  const remoteName = remote ?? "";
  const main =
    remoteName && remoteName !== "." && !remoteName.startsWith("-")
      ? await repo.remoteDefault(remoteName)
      : undefined;
  if (!main || "error" in main) {
    return result(
      "not-now",
      `Not now: couldn't tell which branch is the main branch of the remote of ${name}`,
      {
        ...(main && "error" in main ? { gitError: main.error } : {}),
        action: `Check that ${branch} tracks a branch of a remote (git status in ${dir}), then press Sync again.`,
      },
    );
  }
  if (branch !== main.name) {
    return result(
      "not-now",
      `Not now: ${name} has the branch ${branch} checked out, not ${main.name}`,
      {
        action: `Your answers wait until the checkout is back on ${main.name}; then press Sync again.`,
      },
    );
  }
  const expected = `refs/remotes/${remoteName}/${main.name}`;
  if (upstream !== expected) {
    return result(
      "not-now",
      `Not now: ${branch} in ${name} tracks ${upstream.replace(/^refs\/(remotes|heads)\//, "")}, not ${remoteName}/${main.name}`,
      {
        action: `Point it at ${remoteName}/${main.name} (git branch -u ${remoteName}/${main.name} in ${dir}), then press Sync again.`,
      },
    );
  }

  // Check 2: no unpushed commit that touches anything outside decisions/ (or nothing).
  if (await repo.hasCodeCommits(`${expected}..HEAD`)) {
    return result("not-now", `Not now: an agent in ${name} has commits it hasn't pushed`, {
      action: `Sync changes nothing until they are pushed (git log @{u}..HEAD in ${dir} lists them); then press Sync again.`,
    });
  }

  // Check 3: no file outside decisions/ that the remote changed has uncommitted edits here.
  // Check 2 passed, so outside decisions/ HEAD is the last commit in common with the remote.
  // Untracked files in the pull's way are left to git, which refuses to overwrite them (the
  // pull fails and is undone); ignored files git replaces, as a plain git pull does.
  // The edits here are read first: with none, the remote's change list isn't needed.
  const edited = new Set(
    (await repo.paths(["diff", "--name-only", "-z", "--no-renames", "HEAD"])).filter(
      (path) => !isCardPath(path),
    ),
  );
  const clash =
    edited.size === 0
      ? []
      : (
          await repo.paths(
            ["diff", "--name-only", "-z", "--no-renames", `HEAD...${expected}`],
            `The online copy of ${name} changed too many files for Sync to compare with the uncommitted edits here. Press Sync again once those edits are committed and pushed, or put away.`,
          )
        ).filter((path) => edited.has(path));
  if (clash.length > 0) {
    return result(
      "not-now",
      `Not now: an agent in ${name} has uncommitted edits to ${listText(clash)}, which also changed on the remote`,
      {
        action: "Press Sync again once those edits are committed and pushed, or put away.",
      },
    );
  }

  // Once more right before the first change: an agent may have started a cherry-pick (or
  // hit a conflict) during the fetch, and Sync's commit would then end it.
  const busyNow = await notInProgress(repo, name);
  if (busyNow) return busyNow;

  const stashBefore = new Set((await repo.stashEntries()).map((entry) => entry.sha));
  const newStashEntries = async () =>
    (await repo.stashEntries()).filter((entry) => !stashBefore.has(entry.sha));

  // Commit the card changes in one commit. `git add` first: commit --only alone leaves out
  // cards git doesn't track yet.
  const added = await repo.run(["add", "--", CARDS]);
  if (added.code !== 0) {
    return result("not-synced", `Not synced: git add failed in ${name}`, {
      gitError: gitErrorText(added),
      action: "Nothing was committed. Fix what git reports, then press Sync again.",
    });
  }
  const staged = await repo.paths([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "--",
    CARDS,
  ]);
  if (staged.length > 0) {
    const committed = await repo.run([
      "commit",
      "--only",
      "-m",
      commitMessage(machine, staged),
      "--",
      CARDS,
    ]);
    if (committed.code !== 0) {
      return result("not-synced", `Not synced: the commit failed in ${name}`, {
        gitError: gitErrorText(committed),
        action:
          "Your answers are staged but not committed. Fix what git reports (git's user name and email, or a commit hook), then press Sync again.",
      });
    }
  }
  const kept = local.length > 0 ? "; your answers are kept in a local commit" : "";

  const before = (await repo.out(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  // English messages, which the untracked-file wording below is matched against. LANGUAGE
  // goes before LC_ALL and LANG for a localized git (and the C locale is English anyway).
  const pulled = await repo.run(["pull", "--rebase", "--autostash"], { LANGUAGE: "en" });
  if (pulled.code !== 0) {
    // Name the conflicted cards before the abort puts everything back.
    let conflicted: string[] = [];
    let abortError: string | undefined;
    if ((await repo.inProgress())?.kind === "rebase") {
      conflicted = await repo.conflicted();
      const aborted = await repo.run(["rebase", "--abort"]);
      if (aborted.code !== 0) abortError = gitErrorText(aborted);
    }
    const extra = [
      abortError
        ? `Undoing the failed pull failed too (${abortError}): run git rebase --abort in ${dir} by hand.`
        : "",
      stashText(await newStashEntries(), dir),
    ]
      .filter(Boolean)
      .join(" ");
    if (conflicted.length > 0) {
      return result(
        "not-synced",
        `Not synced: ${cardLabels(conflicted).join(", ")} changed on both machines`,
        {
          action:
            `Everything was put back as it was${kept}. Fixing the conflict is a manual git step in ${dir}; pressing Sync again retries. ${extra}`.trim(),
        },
      );
    }
    if (
      /untracked working tree files would be (overwritten|removed)|would lose untracked files/.test(
        pulled.stderr,
      )
    ) {
      return result(
        "not-synced",
        "Not synced: a file here that git doesn't track is where the online copy puts one (git names it below)",
        {
          gitError: gitErrorText(pulled),
          action:
            `Nothing was pushed${kept}. Move or commit that file (an agent's?), then press Sync again. ${extra}`.trim(),
        },
      );
    }
    return result("not-synced", `Not synced: the pull failed in ${name}`, {
      gitError: gitErrorText(pulled),
      action: `Nothing was pushed${kept}. Press Sync again to retry. ${extra}`.trim(),
    });
  }

  // The cards the pull changed here (whatever happens next, they are in the checkout now),
  // read at once: an agent may rewrite one during the checks and the push, and that
  // revision is the agent's, not Sync's.
  const pulledHead = await repo.run(["rev-parse", "--verify", "HEAD^{commit}"]);
  let pulledCards: string[] = [];
  if (pulledHead.code === 0) {
    const changed = await repo.run([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      before,
      pulledHead.stdout.trim(),
      "--",
      CARDS,
    ]);
    if (changed.code === 0) {
      pulledCards = splitZ(changed.stdout);
      report.broughtIn = await cardRevisions(dir, pulledCards);
    }
  }

  // Look before pushing: a file an agent wrote while the pull had it set aside leaves
  // conflict markers or an old copy in the stash, and git still exits 0.
  const conflicted = await repo.conflicted();
  const newStash = await newStashEntries();
  const autostash = newStash.some((entry) => entry.subject === AUTOSTASH_SUBJECT);
  if (conflicted.length > 0) {
    return result(
      "not-pushed",
      `Not pushed: ${listText(conflicted)} in ${name} ${hasHave(conflicted)} conflicts after the pull`,
      {
        action:
          `Nothing was pushed. Fix ${conflicted.length === 1 ? "that file" : "those files"} by hand in ${dir}, then press Sync again. ${stashText(newStash, dir)}`.trim(),
      },
    );
  }
  if (newStash.length > 0) {
    return result(
      "not-pushed",
      autostash
        ? `Not pushed: a file in ${name} changed while the pull had it set aside, and git kept the older copy in its stash entry named autostash`
        : `Not pushed: a new entry appeared in git stash list in ${name} while Sync ran`,
      {
        action: `Nothing was pushed. ${stashText(newStash, dir)} Then press Sync again.`.trim(),
      },
    );
  }

  // Check again what is about to be pushed: the commit and the pull ran hooks and took a
  // while, and an agent may have committed or switched branches meanwhile. HEAD is read
  // once, and exactly that commit is what gets pushed, once it passes the checks.
  const head = (await repo.out(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const now = await repo.branch();
  if (now.branch !== branch || now.upstream !== expected || now.remote !== remoteName) {
    return result("not-pushed", `Not pushed: the checkout in ${name} changed during Sync`, {
      action: `Nothing was pushed${kept}. ${
        now.branch ? `It is now on ${now.branch}` : "It now has no branch checked out"
      }; your answers wait until it is back on ${main.name} tracking ${remoteName}/${main.name}, then press Sync again.`,
    });
  }
  const startedNow = await repo.inProgress();
  if (startedNow) {
    return result(
      "not-pushed",
      `Not pushed: ${IN_PROGRESS_TEXT[startedNow.kind]} started in ${name} during Sync`,
      {
        action: `Nothing was pushed${kept}. Press Sync again once it is finished or aborted (git status in ${dir} shows it).`,
      },
    );
  }
  if (await repo.hasCodeCommits(`${expected}..${head}`)) {
    return result(
      "not-pushed",
      `Not pushed: an agent in ${name} committed while Sync ran, and its commits aren't pushed`,
      {
        action: `Nothing was pushed${kept}. Sync pushes once the agent's commits are pushed (git log @{u}..HEAD in ${dir} lists them); then press Sync again.`,
      },
    );
  }

  const sent = cardLabels(
    await repo.paths([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      `${expected}...${head}`,
      "--",
      CARDS,
    ]),
  );
  // What the pull brought into the checkout, not what the remote has now (a later fetch).
  const received = cardLabels(pulledCards);
  // Nothing to send when the remote already has HEAD: equal, or behind it when a fetch
  // (another hub's, an agent's) moved the remote-tracking branch since the pull.
  const remoteHas = (await repo.run(["merge-base", "--is-ancestor", head, expected])).code === 0;
  if (!remoteHas) {
    // Exactly the checked commit, to the branch main tracks on the remote main tracks. Not a
    // bare `git push`, which follows push.default (matching pushes every branch with a
    // namesake on the remote), remote.pushDefault and branch.main.pushRemote; no tags and no
    // submodules either.
    const pushed = await repo.run([
      "push",
      "--no-follow-tags",
      "--recurse-submodules=no",
      remoteName,
      `${head}:refs/heads/${main.name}`,
    ]);
    if (pushed.code !== 0) {
      return result("not-pushed", `Not pushed: git push failed in ${name}`, {
        gitError: gitErrorText(pushed),
        received,
        action: `Your answers are kept in a local commit and still count as not synced. Press Sync again to retry.`,
      });
    }
    // git updates the remote-tracking branch after a push; it must now be that commit.
    const after = await repo.run(["rev-parse", "--verify", `${expected}^{commit}`]);
    if (after.code !== 0 || after.stdout.trim() !== head) {
      return result(
        "not-pushed",
        `Not sure it synced: git push said it worked in ${name}, but ${remoteName}/${main.name} doesn't show the pushed commit`,
        {
          received,
          action: `Check git status in ${dir}, then press Sync again.`,
        },
      );
    }
  }
  const parts = [
    sent.length > 0 ? `sent ${sent.join(", ")}` : "",
    received.length > 0 ? `received ${received.join(", ")}` : "",
  ].filter(Boolean);
  return result("synced", parts.length > 0 ? `Synced: ${parts.join("; ")}` : "Synced", {
    sent,
    received,
  });
}

/** What the top bar shows for one project. */
export interface RepoStatus {
  unavailable?: string;
  unsynced: number;
  remoteChanges: number;
  /** A rebase in progress (one a Sync cut short left, say), shown until it is finished. */
  rebase?: { message: string; action: string };
}

/** The counts the top bar shows for one project, and a rebase in progress. Read-only. */
export async function repoStatus(
  dir: string,
  options: SyncOptions = {},
  name = basename(dir),
): Promise<RepoStatus> {
  const repo = new Repo(dir, options);
  try {
    const unavailable = await repo.unavailable();
    if (unavailable) return { unavailable, unsynced: 0, remoteChanges: 0 };
    const { upstream } = await repo.branch();
    const unsynced = (await repo.localCardChanges(upstream !== undefined)).length;
    const remoteChanges = upstream ? (await repo.remoteCardChanges()).length : 0;
    const started = await repo.inProgress();
    if (started?.kind === "rebase") {
      const note = await setAsideNote(repo, started);
      return {
        unsynced,
        remoteChanges,
        rebase: {
          message: `A rebase is in progress in ${name}, and Sync waits until it is finished or aborted`,
          action: note ?? `git status in ${dir} shows it.`,
        },
      };
    }
    return { unsynced, remoteChanges };
  } catch (error) {
    if (error instanceof GitFailed) {
      return {
        unavailable: `git can't read it: ${gitErrorText(error.result)}`,
        unsynced: 0,
        remoteChanges: 0,
      };
    }
    throw error;
  }
}

/** The fetch at hub start: changes no file and no branch. */
export async function fetchRepo(
  dir: string,
  options: SyncOptions = {},
): Promise<{ error?: string }> {
  const repo = new Repo(dir, options);
  if (await repo.unavailable()) return {};
  const fetched = await repo.run(["fetch"]);
  return fetched.code === 0 ? {} : { error: gitErrorText(fetched) };
}

/**
 * Card writes and Syncs per project: while a project's Sync runs (or waits for writes in
 * progress to finish), new card writes there are refused.
 */
class WriteGate {
  readonly #writers = new Map<string, number>();
  readonly #syncing = new Set<string>();
  readonly #drained = new Map<string, () => void>();

  async write<T>(key: string, refuse: () => Error, task: () => Promise<T>): Promise<T> {
    if (this.#syncing.has(key)) throw refuse();
    this.#writers.set(key, (this.#writers.get(key) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const left = (this.#writers.get(key) ?? 1) - 1;
      if (left > 0) this.#writers.set(key, left);
      else {
        this.#writers.delete(key);
        this.#drained.get(key)?.();
      }
    }
  }

  /** Runs `task` once the writes in progress are done; callers are already serialized. */
  async exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.#syncing.add(key);
    try {
      if (this.#writers.has(key)) {
        await new Promise<void>((done) => this.#drained.set(key, done));
        this.#drained.delete(key);
      }
      return await task();
    } finally {
      this.#syncing.delete(key);
    }
  }
}

/** A card file's key: its project's folder and its file name. */
function broughtInKey(project: Project, cardPath: string): string {
  return `${project.path}\0${basename(cardPath)}`;
}

interface ProjectState {
  fetchError?: string;
  last?: SyncResultDto;
  /** The last counts computed, shown while a Sync runs. */
  counts?: RepoStatus;
}

/** Sync for every registered project: what the API and the hub start call. */
export class SyncService {
  readonly #registry: Registry;
  readonly #bus: EventBus;
  readonly #options: SyncOptions;
  /** One git sequence (Sync or the start-up fetch) per project at a time. */
  readonly #lock = new KeyedMutex();
  readonly #gate = new WriteGate();
  readonly #state = new Map<string, ProjectState>();
  readonly #running = new Set<string>();
  readonly #inFlight = new Set<Promise<unknown>>();
  /**
   * The card revisions a pull of this hub's Sync brought in, by project folder and card
   * file name (the 500 most recent cards, 20 revisions each; a restart forgets them).
   */
  readonly #broughtIn = new Map<string, string[]>();

  constructor(registry: Registry, bus: EventBus, options: SyncOptions = {}) {
    this.#registry = registry;
    this.#bus = bus;
    this.#options = options;
  }

  #stateOf(project: Project): ProjectState {
    let state = this.#state.get(project.path);
    if (!state) {
      state = {};
      this.#state.set(project.path, state);
    }
    return state;
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#inFlight.add(promise);
    const done = () => this.#inFlight.delete(promise);
    promise.then(done, done);
    return promise;
  }

  /**
   * Runs a card write unless the project's Sync is running; then refuses it (409,
   * "syncing"). A Sync waits for writes already in progress.
   */
  writeCard<T>(project: Project, task: () => Promise<T>): Promise<T> {
    return this.#gate.write(
      project.path,
      () =>
        new UserError(
          `Sync is running in ${project.name}, so nothing was changed; try again when it finishes.`,
          { status: 409, code: "syncing" },
        ),
      task,
    );
  }

  /**
   * Whether the card file at `cardPath` in `project` is at a revision this hub's Sync
   * brought in with a pull: the card view then says "Sync just brought in a newer version
   * of this card from the online copy." rather than "An agent changed this card".
   */
  broughtIn(project: Project, cardPath: string, revision: string): boolean {
    return this.#broughtIn.get(broughtInKey(project, cardPath))?.includes(revision) ?? false;
  }

  #recordBroughtIn(project: Project, cards: CardRevision[]): void {
    for (const { path, revision } of cards) {
      const key = broughtInKey(project, path);
      const list = this.#broughtIn.get(key) ?? [];
      if (!list.includes(revision)) list.push(revision);
      if (list.length > 20) list.shift();
      this.#broughtIn.delete(key);
      this.#broughtIn.set(key, list);
      if (this.#broughtIn.size > 500) {
        this.#broughtIn.delete(this.#broughtIn.keys().next().value as string);
      }
    }
  }

  async status(): Promise<SyncStatusResponse> {
    const projects = await this.#registry.list();
    const statuses = await Promise.all(
      projects.map(async (project): Promise<ProjectSyncStatus> => {
        const state = this.#stateOf(project);
        const running = this.#running.has(project.path);
        // Mid-Sync the checkout is in flux; show the counts from before.
        const counts =
          running && state.counts
            ? state.counts
            : await repoStatus(project.path, this.#options, project.name);
        if (!running) state.counts = counts;
        return {
          project: project.name,
          ...(counts.unavailable ? { unavailable: counts.unavailable } : {}),
          unsynced: counts.unsynced,
          remoteChanges: counts.remoteChanges,
          ...(counts.rebase ? { rebase: counts.rebase } : {}),
          ...(state.fetchError ? { fetchError: state.fetchError } : {}),
          running,
          ...(state.last ? { last: state.last } : {}),
        };
      }),
    );
    return { projects: statuses, running: statuses.some((s) => s.running) };
  }

  /** Syncs every registered project, one after another, and reports each one. */
  sync(): Promise<SyncRunResponse> {
    return this.#track(this.#syncAll());
  }

  async #syncAll(): Promise<SyncRunResponse> {
    const projects = await this.#registry.list();
    const results: SyncResultDto[] = [];
    for (const project of projects) {
      const outcome = await this.#lock.run(project.path, () =>
        this.#gate.exclusive(project.path, async () => {
          this.#running.add(project.path);
          this.#bus.emit({ type: "sync" });
          try {
            const run = await syncRepoDetailed(project.path, project.name, this.#options);
            // Recorded before the `cards` event below, so a card view that reloaded while
            // the pull ran (and took the change for an agent's) gets it right on that event.
            this.#recordBroughtIn(project, run.broughtIn);
            return run.result;
          } catch (error) {
            console.error(error);
            return result("not-synced", `Not synced: something went wrong in ${project.name}`, {
              action: "See the president server's log.",
            });
          } finally {
            this.#running.delete(project.path);
          }
        }),
      );
      const done: SyncResultDto = {
        project: project.name,
        ...outcome,
        at: new Date().toISOString(),
      };
      const state = this.#stateOf(project);
      state.last = done;
      // This Sync fetched (or said why it couldn't): the start-up fetch's error is old news.
      delete state.fetchError;
      results.push(done);
      // A pull (or an abort) may have rewritten card files: open card views reload. The
      // watcher notices too, a moment later.
      if (!["nothing", "not-now", "unavailable"].includes(done.outcome)) {
        this.#bus.emit({ type: "cards", project: project.name });
      }
      this.#bus.emit({ type: "sync" });
    }
    return { results };
  }

  /** The fetch at hub start, for every project; failures are kept for the status. */
  fetchAll(): Promise<void> {
    return this.#track(
      (async () => {
        let projects: Project[];
        try {
          projects = await this.#registry.list();
        } catch {
          return; // A broken registry is reported wherever it is read; no fetch then.
        }
        await Promise.all(
          projects.map((project) =>
            this.#lock.run(project.path, async () => {
              const state = this.#stateOf(project);
              try {
                const fetched = await fetchRepo(project.path, this.#options);
                if (fetched.error) state.fetchError = fetched.error;
                else delete state.fetchError;
              } catch (error) {
                state.fetchError = (error as Error).message;
              }
            }),
          ),
        );
        this.#bus.emit({ type: "sync" });
      })(),
    );
  }

  /** Waits for every Sync and fetch in progress (each is bounded by its git timeouts). */
  async close(): Promise<void> {
    await Promise.allSettled([...this.#inFlight]);
  }
}
