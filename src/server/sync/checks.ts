/**
 * The steps of Sync's sequence in one project (sequence.ts runs them, in order). Each check
 * returns the result Sync stops with, or undefined to go on; a step that also finds
 * something the later ones need returns that instead.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { revisionOf } from "../cards.ts";
import { splitZ } from "../git.ts";
import {
  AUTOSTASH_SUBJECT,
  cardLabels,
  commitMessage,
  hasHave,
  IN_PROGRESS_TEXT,
  inProgressResult,
  listText,
  type RepoSyncResult,
  result,
  stashText,
} from "./messages.ts";
import { CARDS, gitErrorText, isCardPath, type Repo, type StashEntry } from "./repo.ts";

/** The project a Sync runs in: its repository and its name in messages. */
export interface Run {
  repo: Repo;
  name: string;
  dir: string;
}

/** The branch Sync works on, once check 1 has found it is the remote's main branch. */
export interface Target {
  branch: string;
  /** The remote main tracks, which is also where Sync pushes. */
  remoteName: string;
  /** The remote's default branch. */
  main: { name: string };
  /** The remote-tracking branch of `main` ("refs/remotes/origin/main"). */
  expected: string;
}

/** A card file (relative to its project's folder) at a revision. */
export interface CardRevision {
  path: string;
  revision: string;
}

/** Sync only runs in a folder that is the top of a git work tree, without submodules. */
export async function available({ repo, name }: Run): Promise<RepoSyncResult | undefined> {
  const unavailable = await repo.unavailable();
  if (unavailable) {
    return result("unavailable", `Not synced: ${name} is skipped because ${unavailable}`);
  }
  return undefined;
}

/** Check 1's "nothing in progress" part, and no unresolved conflicts. Changes nothing. */
export async function notInProgress(repo: Repo, name: string): Promise<RepoSyncResult | undefined> {
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

/** Check 1, no network: with a detached HEAD or no upstream, Sync stops (or has nothing). */
export async function noUpstream(
  { repo, name, dir }: Run,
  branch: string | undefined,
): Promise<RepoSyncResult> {
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

/** git fetch. */
export async function fetchRemote({ repo, name }: Run): Promise<RepoSyncResult | undefined> {
  const fetched = await repo.run(["fetch"]);
  if (fetched.code !== 0) {
    return result("not-synced", `Not synced: couldn't fetch from the remote of ${name}`, {
      gitError: gitErrorText(fetched),
      action: "Nothing was changed. Check the connection and the remote, then press Sync again.",
    });
  }
  return undefined;
}

/** No card changed here (`local`) or on the remote: nothing to do. */
export async function nothingToSync(
  { repo }: Run,
  local: string[],
): Promise<RepoSyncResult | undefined> {
  const remoteCards = await repo.remoteCardChanges();
  if (local.length === 0 && remoteCards.length === 0) return result("nothing", "Nothing to sync");
  return undefined;
}

/** Check 1: the remote's default branch is checked out and tracks it. */
export async function onMainBranch(
  { repo, name, dir }: Run,
  branch: string,
  upstream: string,
  remote: string | undefined,
): Promise<RepoSyncResult | Target> {
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
  return { branch, remoteName, main, expected };
}

/** Check 2: no unpushed commit that touches anything outside decisions/ (or nothing). */
export async function noUnpushedCode(
  { repo, name, dir }: Run,
  { expected }: Target,
): Promise<RepoSyncResult | undefined> {
  if (await repo.hasCodeCommits(`${expected}..HEAD`)) {
    return result("not-now", `Not now: an agent in ${name} has commits it hasn't pushed`, {
      action: `Sync changes nothing until they are pushed (git log @{u}..HEAD in ${dir} lists them); then press Sync again.`,
    });
  }
  return undefined;
}

/** Check 3: no file outside decisions/ that the remote changed has uncommitted edits here. */
export async function noEditsInPullsWay(
  { repo, name }: Run,
  { expected }: Target,
): Promise<RepoSyncResult | undefined> {
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
  return undefined;
}

/** Reads `git stash list` now; the function returned lists the entries added since. */
export async function watchStash(repo: Repo): Promise<() => Promise<StashEntry[]>> {
  const stashBefore = new Set((await repo.stashEntries()).map((entry) => entry.sha));
  return async () => (await repo.stashEntries()).filter((entry) => !stashBefore.has(entry.sha));
}

/** Commits the card changes in one commit, if there are any. */
export async function commitCards(
  { repo, name }: Run,
  machine: string,
): Promise<RepoSyncResult | undefined> {
  // `git add` first: commit --only alone leaves out cards git doesn't track yet.
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
  return undefined;
}

/** The commit HEAD points at now. */
export async function headCommit(repo: Repo): Promise<string> {
  return (await repo.out(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
}

/**
 * git pull --rebase --autostash. On failure, names the conflicted cards and aborts the
 * rebase. `kept` ends the "Nothing was pushed" sentences when the answers are in a local
 * commit.
 */
export async function pull(
  { repo, name, dir }: Run,
  kept: string,
  newStashEntries: () => Promise<StashEntry[]>,
): Promise<RepoSyncResult | undefined> {
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
  return undefined;
}

/**
 * The cards the pull changed here (from `before` to HEAD), and their revisions read at once:
 * an agent may rewrite one during the checks and the push, and that revision is the
 * agent's, not Sync's. Empty when git can't tell.
 */
export async function pulledCardChanges(
  { repo, dir }: Run,
  before: string,
): Promise<{ paths: string[]; broughtIn: CardRevision[] }> {
  const pulledHead = await repo.run(["rev-parse", "--verify", "HEAD^{commit}"]);
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
      const paths = splitZ(changed.stdout);
      return { paths, broughtIn: await cardRevisions(dir, paths) };
    }
  }
  return { paths: [], broughtIn: [] };
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

/**
 * Look before pushing: a file an agent wrote while the pull had it set aside leaves
 * conflict markers or an old copy in the stash, and git still exits 0.
 */
export async function cleanAfterPull(
  { repo, name, dir }: Run,
  newStashEntries: () => Promise<StashEntry[]>,
): Promise<RepoSyncResult | undefined> {
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
  return undefined;
}

/** The checkout is still on the same branch, tracking the same upstream of the same remote. */
export async function sameCheckout(
  { repo, name }: Run,
  { branch, expected, remoteName, main }: Target,
  kept: string,
): Promise<RepoSyncResult | undefined> {
  const now = await repo.branch();
  if (now.branch !== branch || now.upstream !== expected || now.remote !== remoteName) {
    return result("not-pushed", `Not pushed: the checkout in ${name} changed during Sync`, {
      action: `Nothing was pushed${kept}. ${
        now.branch ? `It is now on ${now.branch}` : "It now has no branch checked out"
      }; your answers wait until it is back on ${main.name} tracking ${remoteName}/${main.name}, then press Sync again.`,
    });
  }
  return undefined;
}

/** Nothing (a rebase, a merge, ...) started during Sync. */
export async function nothingStarted(
  { repo, name, dir }: Run,
  kept: string,
): Promise<RepoSyncResult | undefined> {
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
  return undefined;
}

/** Check 2 again, on the commit about to be pushed: no agent committed meanwhile. */
export async function noNewCode(
  { repo, name, dir }: Run,
  { expected }: Target,
  head: string,
  kept: string,
): Promise<RepoSyncResult | undefined> {
  if (await repo.hasCodeCommits(`${expected}..${head}`)) {
    return result(
      "not-pushed",
      `Not pushed: an agent in ${name} committed while Sync ran, and its commits aren't pushed`,
      {
        action: `Nothing was pushed${kept}. Sync pushes once the agent's commits are pushed (git log @{u}..HEAD in ${dir} lists them); then press Sync again.`,
      },
    );
  }
  return undefined;
}

/** The cards `head` sends: those it changed since the last commit in common with the remote. */
export async function sentCards({ repo }: Run, { expected }: Target, head: string) {
  return cardLabels(
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
}

/**
 * Pushes exactly `head`, unless the remote already has it, and checks that the push
 * arrived. `received` goes in the result when it didn't.
 */
export async function push(
  { repo, name, dir }: Run,
  { remoteName, main, expected }: Target,
  head: string,
  received: string[],
): Promise<RepoSyncResult | undefined> {
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
  return undefined;
}

/** The result of a Sync that went through. */
export function synced(sent: string[], received: string[]): RepoSyncResult {
  const parts = [
    sent.length > 0 ? `sent ${sent.join(", ")}` : "",
    received.length > 0 ? `received ${received.join(", ")}` : "",
  ].filter(Boolean);
  return result("synced", parts.length > 0 ? `Synced: ${parts.join("; ")}` : "Synced", {
    sent,
    received,
  });
}
