/**
 * Sync (card #0001, docs/archive/roadmap-2026-11.md "Sync"): commits the human's card
 * changes in a project, pulls the other machines' changes and pushes, only when the human
 * presses Sync. When the hub starts it only fetches.
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
 * The steps themselves are in checks.ts. Only one git sequence runs per project at a time,
 * and the hub refuses card actions in a project while its Sync runs (see
 * SyncService.writeCard in service.ts).
 */
import {
  available,
  type CardRevision,
  cleanAfterPull,
  commitCards,
  fetchRemote,
  headCommit,
  noEditsInPullsWay,
  noNewCode,
  nothingStarted,
  nothingToSync,
  notInProgress,
  noUnpushedCode,
  noUpstream,
  onMainBranch,
  pull,
  pulledCardChanges,
  push,
  type Run,
  sameCheckout,
  sentCards,
  synced,
  watchStash,
} from "./checks.ts";
import { cardLabels, machineName, type RepoSyncResult, result } from "./messages.ts";
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
    return await runSequence(repo, name, options.hostname ?? machineName(), report);
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

/** The sequence above, step by step: the first check that fails ends it with its result. */
async function runSequence(
  repo: Repo,
  name: string,
  machine: string,
  report: SequenceReport,
): Promise<RepoSyncResult> {
  const run: Run = { repo, name, dir: repo.dir };
  const skipped = await available(run);
  if (skipped) return skipped;

  // Check 1, the parts that need no network: a rebase, merge, cherry-pick, ... someone
  // started, unresolved conflicts, a detached HEAD, no upstream.
  const busy = await notInProgress(repo, name);
  if (busy) return busy;
  const { branch, upstream, remote } = await repo.branch();
  if (!branch || !upstream) return noUpstream(run, branch);

  report.fetched = true;
  const notFetched = await fetchRemote(run);
  if (notFetched) return notFetched;

  const local = await repo.localCardChanges(true);
  const nothing = await nothingToSync(run, local);
  if (nothing) return nothing;

  const target = await onMainBranch(run, branch, upstream, remote);
  if ("outcome" in target) return target;
  const unpushed = await noUnpushedCode(run, target);
  if (unpushed) return unpushed;
  const clash = await noEditsInPullsWay(run, target);
  if (clash) return clash;

  // Once more right before the first change: an agent may have started a cherry-pick (or
  // hit a conflict) during the fetch, and Sync's commit would then end it.
  const busyNow = await notInProgress(repo, name);
  if (busyNow) return busyNow;

  const newStashEntries = await watchStash(repo);
  const notCommitted = await commitCards(run, machine);
  if (notCommitted) return notCommitted;
  const kept = local.length > 0 ? "; your answers are kept in a local commit" : "";

  const before = await headCommit(repo);
  const notPulled = await pull(run, kept, newStashEntries);
  if (notPulled) return notPulled;
  // Whatever happens next, the cards the pull changed are in the checkout now.
  const pulledCards = await pulledCardChanges(run, before);
  report.broughtIn = pulledCards.broughtIn;
  const leftovers = await cleanAfterPull(run, newStashEntries);
  if (leftovers) return leftovers;

  // Check again what is about to be pushed: the commit and the pull ran hooks and took a
  // while, and an agent may have committed or switched branches meanwhile. HEAD is read
  // once, and exactly that commit is what gets pushed, once it passes the checks.
  const head = await headCommit(repo);
  const moved = await sameCheckout(run, target, kept);
  if (moved) return moved;
  const started = await nothingStarted(run, kept);
  if (started) return started;
  const committed = await noNewCode(run, target, head, kept);
  if (committed) return committed;

  const sent = await sentCards(run, target, head);
  // What the pull brought into the checkout, not what the remote has now (a later fetch).
  const received = cardLabels(pulledCards.paths);
  const notPushed = await push(run, target, head, received);
  if (notPushed) return notPushed;
  return synced(sent, received);
}
