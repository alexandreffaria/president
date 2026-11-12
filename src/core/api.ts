/**
 * Shapes exchanged between the server and the web UI. Types only.
 */
import type { Frontmatter } from "./schema.ts";
import type { BodySections } from "./sections.ts";

export interface CardDto {
  project: string;
  /** Canonical id (from the file name). */
  id: string;
  fileName: string;
  /** Content hash of the file; send it back with actions to detect concurrent edits. */
  revision: string;
  frontmatter: Frontmatter;
}

export interface CardDetailDto extends CardDto {
  body: string;
  sections: BodySections;
  /** Absolute path of the card file, so the human can open it in an editor. */
  path: string;
  /**
   * Whether president itself (the human's actions and undos, from any tab) made every change
   * between the revision the request gave as `since` and this one; without `since`, whether
   * president wrote this revision. A view uses it to tell the human's own changes from an
   * agent's, even after a reload or with live events missed.
   */
  writtenByPresident: boolean;
  /**
   * Whether this revision is one a pull of this hub's Sync brought in (SyncService.broughtIn):
   * the view then says the change came with Sync rather than from an agent.
   */
  changedBySync: boolean;
}

export interface BrokenCardDto {
  project: string;
  fileName: string;
  id: string | undefined;
  errors: string[];
}

export interface ProjectCounts {
  open: number;
  deferred: number;
  resolved: number;
  broken: number;
}

export interface ProjectDto {
  name: string;
  path: string;
  decisionsDir: string;
  /** Set when the project folder or its decisions/ folder can't be read. */
  error: string | undefined;
  counts: ProjectCounts;
}

export interface CardListResponse {
  cards: CardDto[];
  broken: BrokenCardDto[];
  /** Projects that could not be read, with the reason. */
  projectErrors: { project: string; error: string }[];
  /** Every registered project (or the one asked for), with counts. */
  projects: ProjectDto[];
}

export type CardResponse = { ok: true; card: CardDetailDto } | { ok: false; broken: BrokenCardDto };

export interface ApiError {
  error: string;
  /** Machine-readable reason, e.g. "conflict" when the card changed on disk. */
  code?: string;
  details?: string[];
}

export interface AddProjectRequest {
  path: string;
  name?: string;
  createDecisions?: boolean;
}

export interface AddProjectResponse {
  project: ProjectDto;
  alreadyRegistered: boolean;
}

/**
 * Something in a project's cards, or the project list, changed; or a Sync started or
 * finished (refetch /api/sync).
 */
export type HubEvent = { type: "cards"; project: string } | { type: "projects" } | { type: "sync" };

/**
 * A message on the /api/events WebSocket: "ready" once it is connected (anything may have
 * changed before, so refetch), then hub events, and a "ping" with each heartbeat so the page
 * can tell a hub that stopped answering from a quiet one.
 */
export type LiveMessage = HubEvent | { type: "ready" } | { type: "ping" };

/** How often the hub pings each live socket (ms). */
export const HEARTBEAT_MS = 25_000;

/**
 * How one project's Sync ended (see server/sync.ts):
 *
 * - "synced": committed, pulled and pushed.
 * - "nothing": no card changes here or on the remote, so nothing was changed.
 * - "not-now": a check failed before anything changed (another branch checked out, an
 *   agent's unpushed commits, ...).
 * - "not-synced": the fetch, the commit or the pull failed; nothing was pushed.
 * - "not-pushed": the pull worked but Sync stopped before pushing, or the push failed.
 * - "unavailable": the project folder isn't the top folder of a git repository, or it has
 *   git submodules.
 */
export type SyncOutcome =
  | "synced"
  | "nothing"
  | "not-now"
  | "not-synced"
  | "not-pushed"
  | "unavailable";

export interface SyncResultDto {
  project: string;
  outcome: SyncOutcome;
  /** One sentence saying what happened, or why not ("Not now: ..."). */
  message: string;
  /** What the human can do about it, when something is left to do. */
  action?: string;
  /** git's own error output, when a git command failed. */
  gitError?: string;
  /** Cards (ids; file names for other files) this Sync sent and received. */
  sent: string[];
  received: string[];
  /** When this project's Sync ended (ISO time). */
  at: string;
}

export interface ProjectSyncStatus {
  project: string;
  /**
   * Why Sync can't work on this project (not a repository's top folder, or submodules); the
   * counts are 0 then.
   */
  unavailable?: string;
  /**
   * Changed and new files under decisions/, plus files there changed by local commits that
   * aren't pushed yet ("3 answers not synced").
   */
  unsynced: number;
  /**
   * Cards the remote changed as of the last fetch (`git diff --name-only HEAD...@{u} --
   * decisions/`), for "3 card changes on the remote, press Sync".
   */
  remoteChanges: number;
  /**
   * A rebase is in progress in the checkout (one a Sync cut short by the hub stopping left
   * behind, say): what it set aside and how to get it back. Sync waits until it is done.
   */
  rebase?: { message: string; action: string };
  /** Set when the fetch at hub start failed (offline, no remote). Not fatal. */
  fetchError?: string;
  /** A Sync is running in this project right now. */
  running: boolean;
  /** How the last Sync of this project ended (since the hub started). */
  last?: SyncResultDto;
}

export interface SyncStatusResponse {
  projects: ProjectSyncStatus[];
  /** A Sync is running in some project. */
  running: boolean;
}

export interface SyncRunResponse {
  results: SyncResultDto[];
}
