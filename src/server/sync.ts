/**
 * Sync (card #0001, docs/roadmap.md "Sync"): commits the human's card changes in a project,
 * pulls the other machines' changes and pushes, only when the human presses Sync. When the
 * hub starts it only fetches.
 *
 * Per project, exactly the card's sequence:
 *
 *   git fetch
 *   # checks; if one fails, stop, change nothing and say why:
 *   #  1. the remote's default branch is checked out (tracking it), no rebase or merge in progress
 *   #  2. git log @{u}..HEAD has no unpushed commit that changes files outside decisions/
 *   #  3. no file outside decisions/ that the remote changed (git diff HEAD...@{u}) has
 *   #     uncommitted edits here
 *   git add -- decisions/
 *   git commit --only -m "decisions from laptop: 0003, 0005" -- decisions/   # if anything is staged
 *   git pull --rebase --autostash   # on failure: name the conflicted cards, git rebase --abort, don't push
 *   # stop if any file is conflicted or git stash list has a new entry
 *   git push
 *
 * The card says what goes wrong without each step. Sync only runs in a project whose folder
 * is the top folder of its git repository (or worktree), so it never commits into a
 * repository that merely contains the project (a home folder kept in git, say).
 *
 * Only one git sequence runs per project at a time, and the hub refuses card actions in a
 * project while its Sync runs (see {@link SyncService.writeCard}).
 */
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, resolve } from "node:path";
import type {
  ProjectSyncStatus,
  SyncOutcome,
  SyncResultDto,
  SyncRunResponse,
  SyncStatusResponse,
} from "../core/api.ts";
import { parseCardFileName } from "../core/card-file.ts";
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

/** A git command that failed where the sequence can't go on. */
class GitFailed extends Error {
  readonly result: GitResult;
  constructor(args: string[], result: GitResult) {
    super(`git ${args.join(" ")} failed`);
    this.result = result;
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

  run(args: string[]): Promise<GitResult> {
    return runGit(this.dir, args, this.#options);
  }

  /** Runs git and returns its output; a failure throws GitFailed. */
  async out(args: string[]): Promise<string> {
    const result = await this.run(args);
    if (result.code !== 0) throw new GitFailed(args, result);
    return result.stdout;
  }

  /** NUL-separated paths from a `-z` command. */
  async paths(args: string[]): Promise<string[]> {
    return splitZ(await this.out(args));
  }

  /**
   * Why Sync can't work here, or undefined when the folder is the top of a git work tree.
   */
  async unavailable(): Promise<string | undefined> {
    const result = await this.run(["rev-parse", "--show-toplevel"]);
    if (result.code !== 0) {
      return /not a git repository/i.test(result.stderr)
        ? "it isn't a git repository"
        : `git can't read it: ${gitErrorText(result)}`;
    }
    const top = result.stdout.trim();
    const [realTop, realDir] = await Promise.all([
      realpath(top).catch(() => top),
      realpath(this.dir).catch(() => this.dir),
    ]);
    if (realTop !== realDir) {
      return `it is inside the git repository ${top} rather than its top folder, and Sync only works on a project that is a repository's top folder`;
    }
    return undefined;
  }

  /** A rebase or merge that someone started and hasn't finished. */
  async inProgress(): Promise<"rebase" | "merge" | undefined> {
    const lines = (
      await this.out([
        "rev-parse",
        "--git-path",
        "rebase-merge",
        "--git-path",
        "rebase-apply",
        "--git-path",
        "MERGE_HEAD",
      ])
    )
      .split("\n")
      .filter(Boolean);
    const exists = (i: number) => {
      const path = lines[i];
      return path !== undefined && existsSync(resolve(this.dir, path));
    };
    if (exists(0) || exists(1)) return "rebase";
    if (exists(2)) return "merge";
    return undefined;
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

  async stashEntries(): Promise<string[]> {
    return (await this.out(["stash", "list", "--format=%H"])).split("\n").filter(Boolean);
  }

  conflicted(): Promise<string[]> {
    return this.paths(["diff", "--name-only", "-z", "--diff-filter=U"]);
  }
}

function unique(list: string[]): string[] {
  return [...new Set(list)].sort();
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
  const repo = new Repo(dir, options);
  try {
    return await runSequence(repo, name, options.hostname ?? machineName());
  } catch (error) {
    if (error instanceof GitFailed) {
      return result("not-synced", `Not synced: git failed in ${name}`, {
        gitError: gitErrorText(error.result),
        action: "Fix what git reports, then press Sync again.",
      });
    }
    throw error;
  }
}

async function runSequence(repo: Repo, name: string, machine: string): Promise<RepoSyncResult> {
  const dir = repo.dir;
  const unavailable = await repo.unavailable();
  if (unavailable) {
    return result("unavailable", `Not synced: ${name} is skipped because ${unavailable}`);
  }

  // Check 1, the parts that need no network: a rebase or merge someone started, a detached
  // HEAD, no upstream.
  const started = await repo.inProgress();
  if (started) {
    return result("not-now", `Not now: a ${started} is in progress in ${name}`, {
      action: `Press Sync again once it is finished or aborted (git status in ${dir} shows it).`,
    });
  }
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
  const remoteName = remote ?? "";
  const main = remoteName && remoteName !== "." ? await repo.remoteDefault(remoteName) : undefined;
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

  // Check 2: no unpushed commit that touches anything outside decisions/.
  const unpushed = await repo.paths([
    "log",
    "--format=",
    "--name-only",
    "-z",
    "--no-renames",
    "--diff-merges=first-parent",
    "@{u}..HEAD",
  ]);
  if (unpushed.some((path) => !isCardPath(path))) {
    return result("not-now", `Not now: an agent in ${name} has commits it hasn't pushed`, {
      action: `Sync changes nothing until they are pushed (git log @{u}..HEAD in ${dir} lists them); then press Sync again.`,
    });
  }

  // Check 3: no file outside decisions/ that the remote changed has uncommitted edits here.
  const remoteFiles = (
    await repo.paths(["diff", "--name-only", "-z", "--no-renames", "HEAD...@{u}"])
  ).filter((path) => !isCardPath(path));
  if (remoteFiles.length > 0) {
    const edited = new Set([
      ...(await repo.paths(["diff", "--name-only", "-z", "--no-renames", "HEAD"])),
      ...(await repo.paths(["ls-files", "--others", "--exclude-standard", "-z"])),
    ]);
    const clash = remoteFiles.filter((path) => edited.has(path));
    if (clash.length > 0) {
      return result(
        "not-now",
        `Not now: an agent in ${name} has uncommitted edits to ${clash.join(", ")}, which also changed on the remote`,
        {
          action: "Press Sync again once those edits are committed and pushed, or put away.",
        },
      );
    }
  }

  const stashBefore = new Set(await repo.stashEntries());

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

  const before = (await repo.out(["rev-parse", "HEAD"])).trim();
  const pulled = await repo.run(["pull", "--rebase", "--autostash"]);
  if (pulled.code !== 0) {
    // Name the conflicted cards before the abort puts everything back.
    let conflicted: string[] = [];
    let abortError: string | undefined;
    if ((await repo.inProgress()) === "rebase") {
      conflicted = await repo.conflicted();
      const aborted = await repo.run(["rebase", "--abort"]);
      if (aborted.code !== 0) abortError = gitErrorText(aborted);
    }
    const leftover = (await repo.stashEntries()).some((entry) => !stashBefore.has(entry));
    const extra = [
      abortError
        ? `Undoing the failed pull failed too (${abortError}): run git rebase --abort in ${dir} by hand.`
        : "",
      leftover
        ? `Git also left an entry in its stash (git stash list in ${dir}) that needs clearing.`
        : "",
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
    return result("not-synced", `Not synced: the pull failed in ${name}`, {
      gitError: gitErrorText(pulled),
      action: `Nothing was pushed${kept}. Press Sync again to retry. ${extra}`.trim(),
    });
  }

  // Look before pushing: a file an agent wrote while the pull had it set aside leaves
  // conflict markers or an old copy in the stash, and git still exits 0.
  const conflicted = await repo.conflicted();
  const newStash = (await repo.stashEntries()).filter((entry) => !stashBefore.has(entry));
  if (conflicted.length > 0) {
    return result(
      "not-pushed",
      `Not pushed: ${conflicted.join(", ")} in ${name} ${conflicted.length === 1 ? "has" : "have"} conflicts after the pull`,
      {
        action: `Nothing was pushed. Fix ${conflicted.length === 1 ? "that file" : "those files"} by hand in ${dir}${
          newStash.length > 0 ? " and clear the entry git left in its stash (git stash list)" : ""
        }, then press Sync again.`,
      },
    );
  }
  if (newStash.length > 0) {
    return result(
      "not-pushed",
      `Not pushed: a file in ${name} changed while the pull had it set aside, and git kept the older copy in its stash`,
      {
        action: `Nothing was pushed. Check git stash list in ${dir} and clear that entry (git stash drop) once the agent's files are right, then press Sync again.`,
      },
    );
  }

  const sent = cardLabels(
    await repo.paths(["diff", "--name-only", "-z", "--no-renames", "@{u}...HEAD", "--", CARDS]),
  );
  const received = cardLabels(
    await repo.paths([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      `${before}...@{u}`,
      "--",
      CARDS,
    ]),
  );
  const pushed = await repo.run(["push"]);
  if (pushed.code !== 0) {
    return result("not-pushed", `Not pushed: git push failed in ${name}`, {
      gitError: gitErrorText(pushed),
      received,
      action: `Your answers are kept in a local commit and still count as not synced. Press Sync again to retry.`,
    });
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

/** The counts the top bar shows for one project. Read-only. */
export async function repoStatus(
  dir: string,
  options: SyncOptions = {},
): Promise<{ unavailable?: string; unsynced: number; remoteChanges: number }> {
  const repo = new Repo(dir, options);
  try {
    const unavailable = await repo.unavailable();
    if (unavailable) return { unavailable, unsynced: 0, remoteChanges: 0 };
    const { upstream } = await repo.branch();
    const unsynced = (await repo.localCardChanges(upstream !== undefined)).length;
    const remoteChanges = upstream ? (await repo.remoteCardChanges()).length : 0;
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

interface ProjectState {
  fetchError?: string;
  last?: SyncResultDto;
  /** The last counts computed, shown while a Sync runs. */
  counts?: { unavailable?: string; unsynced: number; remoteChanges: number };
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

  async status(): Promise<SyncStatusResponse> {
    const projects = await this.#registry.list();
    const statuses = await Promise.all(
      projects.map(async (project): Promise<ProjectSyncStatus> => {
        const state = this.#stateOf(project);
        const running = this.#running.has(project.path);
        // Mid-Sync the checkout is in flux; show the counts from before.
        const counts =
          running && state.counts ? state.counts : await repoStatus(project.path, this.#options);
        if (!running) state.counts = counts;
        return {
          project: project.name,
          ...(counts.unavailable ? { unavailable: counts.unavailable } : {}),
          unsynced: counts.unsynced,
          remoteChanges: counts.remoteChanges,
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
            return await syncRepo(project.path, project.name, this.#options);
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
