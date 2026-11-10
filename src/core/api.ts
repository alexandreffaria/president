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

/** Something in a project's cards, or the project list, changed. */
export type HubEvent = { type: "cards"; project: string } | { type: "projects" };

/**
 * A message on the /api/events WebSocket: "ready" once it is connected (anything may have
 * changed before, so refetch), then hub events.
 */
export type LiveMessage = HubEvent | { type: "ready" };
