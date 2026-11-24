/** What the top bar shows for a project, and the fetch at hub start. Both read-only. */
import { GitFailed, gitErrorText, Repo, type SyncOptions } from "./repo.ts";

/** What the top bar shows for one project. */
export interface RepoStatus {
  unavailable?: string;
  remoteChanges: number;
}

/** The count of card changes on the remote the top bar shows for one project. Read-only. */
export async function repoStatus(dir: string, options: SyncOptions = {}): Promise<RepoStatus> {
  const repo = new Repo(dir, options);
  try {
    const unavailable = await repo.unavailable();
    if (unavailable) return { unavailable, remoteChanges: 0 };
    const { upstream } = await repo.branch();
    return { remoteChanges: upstream ? (await repo.remoteCardChanges()).length : 0 };
  } catch (error) {
    if (error instanceof GitFailed) {
      return { unavailable: `git can't read it: ${gitErrorText(error.result)}`, remoteChanges: 0 };
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
