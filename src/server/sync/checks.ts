/**
 * The steps of Sync's sequence in one project (sequence.ts runs them, in order). Each check
 * returns the result Sync stops with, or undefined to go on; a step that also finds
 * something the later ones need returns that instead.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { revisionOf } from "../cards.ts";
import {
  cardLabels,
  hasHave,
  inProgressResult,
  listText,
  type RepoSyncResult,
  result,
} from "./messages.ts";
import { CARDS, gitErrorText, isCardPath, type Repo } from "./repo.ts";

/** The project a Sync runs in: its repository and its name in messages. */
export interface Run {
  repo: Repo;
  name: string;
  dir: string;
}

/** The branch Sync pulls into, once check 1 has found it is the remote's main branch. */
export interface Target {
  branch: string;
  /** The remote main tracks. */
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
    return result("unavailable", `Not pulled: ${name} is skipped because ${unavailable}`);
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

/** Check 1, no network: with a detached HEAD or no upstream, there is nothing to pull from. */
export async function noUpstream(
  { repo, name, dir }: Run,
  branch: string | undefined,
): Promise<RepoSyncResult> {
  if (!branch) {
    return result("not-now", `Not now: ${name} has no branch checked out (a detached HEAD)`, {
      action: `Sync pulls only while main is checked out; press Sync again once ${name} is back on it.`,
    });
  }
  // A repository kept only on this machine: nothing to pull, and nothing to fix.
  if (!(await repo.hasRemote())) return result("nothing", "Nothing to pull: it has no remote");
  return result(
    "not-now",
    `Not now: the branch ${branch} in ${name} has no upstream branch to pull from`,
    {
      action: `If ${branch} is the main branch, set its upstream (for example git branch -u origin/${branch} in ${dir}), then press Sync again. If it is a feature branch, Sync doesn't pull it: its cards travel with its pull request.`,
    },
  );
}

/** git fetch. */
export async function fetchRemote({ repo, name }: Run): Promise<RepoSyncResult | undefined> {
  const fetched = await repo.run(["fetch"]);
  if (fetched.code !== 0) {
    return result("failed", `Not pulled: couldn't fetch from the remote of ${name}`, {
      gitError: gitErrorText(fetched),
      action: "Nothing was changed. Check the connection and the remote, then press Sync again.",
    });
  }
  return undefined;
}

/** Check 1: the remote's default branch is checked out and tracks it. */
export async function onMainBranch(
  { repo, name, dir }: Run,
  branch: string,
  upstream: string,
  remote: string | undefined,
): Promise<RepoSyncResult | Target> {
  // The remote main tracks (branch.main.remote).
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
        action: `Sync pulls only while ${main.name} is checked out; press Sync again once it is. Cards on ${branch} travel with its pull request.`,
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

/**
 * The remote changed no card since the last commit in common with `head`: nothing to pull.
 * "Nothing to pull" when main already has everything, "No card changes to pull" when the
 * remote changed only other files (Sync leaves those for a pull with the next card).
 */
export async function nothingToPull(
  { repo, name, dir }: Run,
  head: string,
  upstream: string,
): Promise<RepoSyncResult | undefined> {
  const tooMany = `The online copy of ${name} changed too many cards for Sync to list. Pull by hand (git pull --ff-only in ${dir}).`;
  if ((await repo.remoteCardChanges(`${head}...${upstream}`, tooMany)).length > 0) {
    return undefined;
  }
  return (await repo.isAncestor(upstream, head))
    ? result("nothing", "Nothing to pull")
    : result("nothing", "No card changes to pull");
}

/** Check 2: main has no commit the remote's main lacks, so the pull is a fast-forward. */
export async function fastForward(
  { repo, name, dir }: Run,
  { branch, remoteName, main }: Target,
  head: string,
  upstream: string,
): Promise<RepoSyncResult | undefined> {
  if (!(await repo.isAncestor(head, upstream))) {
    return result(
      "not-now",
      `Not now: ${branch} in ${name} has commits that aren't on ${remoteName}/${main.name}`,
      {
        action: `Sync only fast-forwards, so it pulls once they are pushed (git log @{u}..HEAD in ${dir} lists them); then press Sync again.`,
      },
    );
  }
  return undefined;
}

/** Check 3: no file the pull changes has uncommitted changes here, cards included. */
export async function noEditsInPullsWay(
  { repo, name }: Run,
  head: string,
  upstream: string,
): Promise<RepoSyncResult | undefined> {
  // Untracked files in the pull's way are left to git, which refuses to overwrite them;
  // ignored files git replaces, as a plain git pull does. The edits here are read first:
  // with none, the remote's change list isn't needed.
  const edited = new Set(await repo.paths(["diff", "--name-only", "-z", "--no-renames", "HEAD"]));
  const clash =
    edited.size === 0
      ? []
      : (
          await repo.paths(
            ["diff", "--name-only", "-z", "--no-renames", head, upstream],
            `The online copy of ${name} changed too many files for Sync to compare with the uncommitted changes here. Press Sync again once those changes are committed or put away.`,
          )
        ).filter((path) => edited.has(path));
  if (clash.length > 0) {
    return result(
      "not-now",
      `Not now: ${listText(clash)} in ${name} ${hasHave(clash)} uncommitted changes here and changed on the remote`,
      {
        action:
          "Nothing was changed. Press Sync again once those changes are committed or put away.",
      },
    );
  }
  return undefined;
}

/** Right before the pull: still on the same branch, tracking the same upstream, at `head`. */
export async function sameCheckout(
  { repo, name }: Run,
  { branch, expected, remoteName }: Target,
  head: string,
): Promise<RepoSyncResult | undefined> {
  const now = await repo.branch();
  const moved =
    now.branch !== branch ||
    now.upstream !== expected ||
    now.remote !== remoteName ||
    (await repo.commit("HEAD")) !== head;
  if (moved) {
    return result("not-now", `Not now: the checkout in ${name} changed during Sync`, {
      action: "Nothing was changed. Press Sync again.",
    });
  }
  return undefined;
}

/**
 * git merge --ff-only of exactly the commit the checks looked at.
 *
 * Not atomic with the checks: an agent that commits or switches branches in the moment
 * between sameCheckout and this merge isn't seen. A new commit makes the fast-forward
 * impossible and git refuses; a new branch made from main (`git switch -c`) would be
 * fast-forwarded instead of main. git has no "merge only if HEAD is still <ref> at
 * <commit>", and updating the ref apart from the files (update-ref) would leave the tree
 * behind, so the window stays, a few milliseconds wide.
 */
export async function pull(
  { repo, name }: Run,
  upstream: string,
): Promise<RepoSyncResult | undefined> {
  // English messages, which the untracked-file wording below is matched against. LANGUAGE
  // goes before LC_ALL and LANG for a localized git (and the C locale is English anyway).
  // --no-autostash: with merge.autoStash set, git would stash a file edited since check 3,
  // put it back with conflict markers and still exit 0; without it, git refuses.
  const merged = await repo.run(["merge", "--ff-only", "--no-autostash", "--quiet", upstream], {
    LANGUAGE: "en",
  });
  if (merged.code === 0) return undefined;
  if (
    /untracked working tree files would be (overwritten|removed)|would lose untracked files/.test(
      merged.stderr,
    )
  ) {
    return result(
      "failed",
      "Not pulled: a file here that git doesn't track is where the online copy puts one (git names it below)",
      {
        gitError: gitErrorText(merged),
        action:
          "Nothing was changed. Move or commit that file (an agent's?), then press Sync again.",
      },
    );
  }
  return result("failed", `Not pulled: the pull failed in ${name}`, {
    gitError: gitErrorText(merged),
    action: "Fix what git reports, then press Sync again.",
  });
}

/**
 * The cards the pull changed here (from `before` to `after`), and their revisions read at
 * once: an agent may rewrite one right after, and that revision is the agent's, not Sync's.
 * Empty when git can't tell.
 */
export async function pulledCardChanges(
  { repo, dir }: Run,
  before: string,
  after: string,
): Promise<{ paths: string[]; broughtIn: CardRevision[] }> {
  try {
    const paths = await repo.paths([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      before,
      after,
      "--",
      CARDS,
    ]);
    return { paths, broughtIn: await cardRevisions(dir, paths) };
  } catch {
    return { paths: [], broughtIn: [] };
  }
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

/** The result of a pull that went through. */
export function pulled(paths: string[]): RepoSyncResult {
  const cards = cardLabels(paths);
  return result("pulled", cards.length > 0 ? `Pulled ${cards.join(", ")}` : "Pulled", {
    pulled: cards,
  });
}
