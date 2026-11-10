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
 * Server-sent event payloads on /api/events. A "cards" event from an action or undo taken
 * through the API names the card and the revision it wrote, so every tab knows the change
 * came from president (the human), not from an agent.
 */
export type HubEvent =
  | { type: "cards"; project: string; id?: string; revision?: string }
  | { type: "projects" };
