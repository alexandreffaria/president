/** What the top bar shows for a project, and the fetch at hub start. Both read-only. */
import { basename } from "node:path";
import { setAsideNote } from "./messages.ts";
import { GitFailed, gitErrorText, Repo, type SyncOptions } from "./repo.ts";

/** What the top bar shows for one project. */
export interface RepoStatus {
  unavailable?: string;
  unsynced: number;
  /** Set when Sync skips the project: its card changes, never counted in `unsynced`. */
  skippedUnsynced?: number;
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
    if (unavailable) {
      const skippedUnsynced = await repo.skippedCardChanges();
      return { unavailable, unsynced: 0, skippedUnsynced, remoteChanges: 0 };
    }
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
