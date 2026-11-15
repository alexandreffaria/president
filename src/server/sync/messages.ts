/**
 * What Sync says: its results, the sentences shared by several checks, and its commit
 * messages.
 */
import { hostname } from "node:os";
import { basename } from "node:path";
import type { SyncOutcome, SyncResultDto } from "../../core/api.ts";
import { parseCardFileName } from "../../core/card-file.ts";
import {
  type InProgress,
  type InProgressKind,
  type Repo,
  type StashEntry,
  unique,
} from "./repo.ts";

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

/** The subject git gives the entry it saves when it can't put an autostash back. */
export const AUTOSTASH_SUBJECT = "autostash";

export const listText = (paths: string[]) => paths.join(", ");
export const hasHave = (paths: string[]) => (paths.length === 1 ? "has" : "have");

/**
 * The sentence about stash entries that appeared during Sync. Git's own (subject
 * "autostash") is named exactly; any other may be an agent's, so it is left alone.
 */
export function stashText(entries: StashEntry[], dir: string): string {
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

export async function inProgressResult(
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
export async function setAsideNote(repo: Repo, started: InProgress): Promise<string | undefined> {
  if (started.kind !== "rebase" || !started.autostash) return undefined;
  const files = await repo.stashedFiles(started.autostash);
  const what =
    files.length > 0
      ? `the uncommitted changes to ${listText(files)}: until it is finished or aborted, ${files.length === 1 ? "that file shows its" : "those files show their"} last committed content`
      : "the checkout's uncommitted changes until it is finished or aborted";
  return `The rebase has set aside ${what}. If no agent is running this rebase (a Sync cut short by the hub stopping leaves one behind), git rebase --abort in ${repo.dir} puts everything back as it was.`;
}

/** "0003" for decisions/0003-name.md; the file name for anything else. */
export function cardLabel(path: string): string {
  const name = basename(path);
  return parseCardFileName(name)?.id ?? name;
}

export function cardLabels(paths: string[]): string[] {
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

export function result(
  outcome: SyncOutcome,
  message: string,
  extra: Partial<RepoSyncResult> = {},
): RepoSyncResult {
  return { outcome, message, sent: [], received: [], ...extra };
}
