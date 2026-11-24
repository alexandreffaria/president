/**
 * Sync (card 20261116d34o, pull-only): pulls main into a project folder to bring in merged
 * cards and answers, only when the human presses Sync. It never commits or pushes; an
 * answer to a card already on main stays uncommitted until an agent commits it. When the
 * hub starts it only fetches.
 *
 * Per project:
 *
 *   git fetch
 *   # checks; if one fails, stop, change nothing and say why:
 *   #  1. the remote's default branch is checked out (tracking it); no rebase, merge,
 *   #     cherry-pick, revert, sequence of those or bisect in progress, and no unmerged file
 *   #  -  the remote changed a card since the last commit in common; otherwise nothing to do
 *   #  2. HEAD is an ancestor of the remote's main, as just fetched: a fast-forward
 *   #  3. no file the pull changes (git diff HEAD <that commit>) has uncommitted changes
 *   #     here (git diff HEAD), cards included
 *   # check 1 once more, and the same branch at the same commit, right before the pull
 *   git merge --ff-only <that commit>
 *
 * Only one git sequence runs per project at a time, and the hub refuses card actions in a
 * project while its Sync runs (see SyncService.writeCard in service.ts). Sync only runs in
 * a project whose folder is the top folder of its git repository (or worktree), without
 * submodules.
 */
import {
  available,
  type CardRevision,
  fastForward,
  fetchRemote,
  noEditsInPullsWay,
  nothingToPull,
  notInProgress,
  noUpstream,
  onMainBranch,
  pull,
  pulled,
  pulledCardChanges,
  type Run,
  sameCheckout,
} from "./checks.ts";
import { type RepoSyncResult, result } from "./messages.ts";
import { GitFailed, gitErrorText, Repo, type SyncOptions } from "./repo.ts";

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

/** What a Sync did beyond its result. */
interface SequenceReport {
  /**
   * The card files whose content the pull changed in the checkout, at the revisions read
   * right after the pull, for "Sync just brought in a newer version of this card".
   */
  broughtIn: CardRevision[];
  /** Sync ran `git fetch` (whether or not it worked); a "Not now" before it didn't. */
  fetched: boolean;
}

/** {@link syncRepo}, plus what it brought in and whether it fetched. */
export async function syncRepoDetailed(
  dir: string,
  name: string,
  options: SyncOptions = {},
): Promise<{ result: RepoSyncResult } & SequenceReport> {
  const report: SequenceReport = { broughtIn: [], fetched: false };
  return { result: await guardedSequence(dir, name, options, report), ...report };
}

async function guardedSequence(
  dir: string,
  name: string,
  options: SyncOptions,
  report: SequenceReport,
): Promise<RepoSyncResult> {
  const repo = new Repo(dir, options);
  try {
    return await runSequence(repo, name, report);
  } catch (error) {
    if (error instanceof GitFailed) {
      return result("failed", `Not pulled: git failed in ${name}`, {
        gitError: gitErrorText(error.result),
        action: error.action ?? "Fix what git reports, then press Sync again.",
      });
    }
    throw error;
  }
}

/** The sequence above, step by step: the first check that fails ends it with its result. */
async function runSequence(
  repo: Repo,
  name: string,
  report: SequenceReport,
): Promise<RepoSyncResult> {
  const run: Run = { repo, name, dir: repo.dir };
  const skipped = await available(run);
  if (skipped) return skipped;

  // Check 1, the parts that need no network.
  const busy = await notInProgress(repo, name);
  if (busy) return busy;
  const { branch, upstream, remote } = await repo.branch();
  if (!branch || !upstream) return noUpstream(run, branch);

  report.fetched = true;
  const notFetched = await fetchRemote(run);
  if (notFetched) return notFetched;

  const target = await onMainBranch(run, branch, upstream, remote);
  if ("outcome" in target) return target;
  // Read once: every check, and the pull, use exactly these two commits.
  const theirs = await repo.commit(target.expected);
  const head = await repo.commit("HEAD");
  const nothing = await nothingToPull(run, theirs);
  if (nothing) return nothing;
  const diverged = await fastForward(run, target, head, theirs);
  if (diverged) return diverged;
  const clash = await noEditsInPullsWay(run, head, theirs);
  if (clash) return clash;

  // Once more right before the pull: an agent may have started a cherry-pick, committed or
  // switched branches during the fetch.
  const busyNow = await notInProgress(repo, name);
  if (busyNow) return busyNow;
  const moved = await sameCheckout(run, target, head);
  if (moved) return moved;

  const notPulled = await pull(run, theirs);
  if (notPulled) return notPulled;
  const cards = await pulledCardChanges(run, head, theirs);
  report.broughtIn = cards.broughtIn;
  return pulled(cards.paths);
}
