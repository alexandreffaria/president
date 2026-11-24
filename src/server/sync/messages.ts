/** What Sync says: its results, and the sentences shared by several checks. */
import { basename } from "node:path";
import type { SyncOutcome, SyncResultDto } from "../../core/api.ts";
import { parseCardFileName } from "../../core/card-file.ts";
import { type InProgressKind, type Repo, unique } from "./repo.ts";

/** A project's Sync result without the project name and time. */
export type RepoSyncResult = Omit<SyncResultDto, "project" | "at">;

export const IN_PROGRESS_TEXT: Record<InProgressKind, string> = {
  rebase: "a rebase",
  merge: "a merge",
  "cherry-pick": "a cherry-pick",
  revert: "a revert",
  sequence: "a series of cherry-picks or reverts",
  bisect: "a bisect",
};

export const listText = (paths: string[]) => paths.join(", ");
export const hasHave = (paths: string[]) => (paths.length === 1 ? "has" : "have");

export function inProgressResult(repo: Repo, name: string, kind: InProgressKind): RepoSyncResult {
  return result("not-now", `Not now: ${IN_PROGRESS_TEXT[kind]} is in progress in ${name}`, {
    action: `Press Sync again once it is finished or aborted (git status in ${repo.dir} shows it).`,
  });
}

/** "0003" for decisions/0003-name.md; the file name for anything else. */
export function cardLabel(path: string): string {
  const name = basename(path);
  return parseCardFileName(name)?.id ?? name;
}

export function cardLabels(paths: string[]): string[] {
  return unique(paths.map(cardLabel));
}

export function result(
  outcome: SyncOutcome,
  message: string,
  extra: Partial<RepoSyncResult> = {},
): RepoSyncResult {
  return { outcome, message, pulled: [], ...extra };
}
