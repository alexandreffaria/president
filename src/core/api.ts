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
 * finished (refetch /api/sync); or a card's conversation changed on this machine (a message
 * was saved, a run started or ended, a summary was saved: refetch /api/chats/:project/:id).
 */
export type HubEvent =
  | { type: "cards"; project: string }
  | { type: "projects" }
  | { type: "sync" }
  | { type: "chat"; project: string; id: string };

/**
 * One message of a card's conversation, as the hub showed it (#0018: the hub's own copy, in
 * `$XDG_STATE_HOME/president/chats/`, never in the project).
 *
 * - "you": what the human sent;
 * - "agent": the card's Claude Code session's reply (its text, without tool calls);
 * - "hub": a line from president itself, such as "The earlier conversation on this card
 *   isn't available on this machine".
 */
export interface ChatMessageDto {
  at: string;
  from: "you" | "agent" | "hub";
  text: string;
}

export interface ChatDto {
  messages: ChatMessageDto[];
  /**
   * The conversation has messages no saved summary covers yet, on this machine (#0024): the
   * page offers Write summary, and Decide offers the summary first (#0019).
   */
  unsummarized: boolean;
  /**
   * False when this machine has a session for the card but Claude Code has deleted it (after
   * `cleanupPeriodDays`): "The agent no longer remembers this conversation; your next message
   * starts from the summaries." (#0018). True otherwise, also when there is no conversation.
   */
  remembers: boolean;
  /** The run of the card's session going on now: a reply, a summary, or none (false). */
  running: false | "reply" | "summary";
}

/** `POST /api/chats/:project/:id/close`: the conversation now, and what undoes the close. */
export interface ChatCloseResponse {
  chat: ChatDto;
  /** Sent back to `POST /api/chats/:project/:id/reopen` by the notice's Undo. */
  closed: string;
}

/**
 * A request from one of the panel's buttons instead of typed text: "teach" is Teach me (#0005,
 * 20261111fauj), "research" is More info.
 */
export const CHAT_ASKS = ["teach", "research"] as const;
export type ChatAsk = (typeof CHAT_ASKS)[number];

/**
 * The lines of `POST /api/chats/:project/:id/messages` (newline-delimited JSON), in order:
 * the messages saved before the run ("you", and "hub" notices), then what the session does
 * as it does it, then exactly one "done" or "error". The run goes on if the page goes away;
 * its reply is saved all the same.
 */
export type ChatStreamEvent =
  | { type: "message"; message: ChatMessageDto }
  /** What the session is doing, for example "Reading src/http.ts". Not saved. */
  | { type: "activity"; text: string }
  /** A part of the agent's reply, as it arrives; the parts make up the saved reply. */
  | { type: "text"; text: string }
  /** The reply as saved (none when the session answered nothing). */
  | { type: "done"; message: ChatMessageDto | undefined }
  /** The run failed; what it had answered so far is saved, then this line saved too. */
  | { type: "error"; error: string; message: ChatMessageDto };

export interface ChatSummaryResponse {
  /** The session's summary, for the human to edit; nothing is saved until they save it. */
  summary: string;
  /**
   * Claude Code had deleted the session, so a fresh one wrote the summary from the hub's
   * copy of the messages (20261111paot).
   */
  fromCopy: boolean;
}

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
   * Why Sync can't work on this project (not a repository's top folder, or submodules);
   * `unsynced` and `remoteChanges` are 0 then.
   */
  unavailable?: string;
  /**
   * Changed and new files under decisions/, plus files there changed by local commits that
   * aren't pushed yet ("3 answers not synced").
   */
  unsynced: number;
  /**
   * Set when Sync skips the project (`unavailable`): its card changes all the same, counted
   * like `unsynced` (inside a bigger repository, against that repository's upstream, or only
   * uncommitted changes where its branch tracks nothing or HEAD is detached; 0 for a folder
   * outside git). Shown on a line of its own, never in the Sync button's number
   * (20261112l9vh, count-apart).
   */
  skippedUnsynced?: number;
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
