/**
 * Typed calls to the president API.
 */
import type { CardAction } from "../core/actions.ts";
import type {
  AddProjectRequest,
  AddProjectResponse,
  ApiError,
  CardDetailDto,
  CardListResponse,
  CardResponse,
} from "../core/api.ts";
import { recordWrite } from "./app-writes.ts";

export class RequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: string[];

  constructor(status: number, body: Partial<ApiError>) {
    super(body.error ?? `request failed (${status})`);
    this.status = status;
    this.code = body.code;
    this.details = body.details ?? [];
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { "content-type": "application/json" } : undefined,
    });
  } catch {
    throw new RequestError(0, { error: "can't reach the president server; is it running?" });
  }
  const body = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) throw new RequestError(response.status, body as Partial<ApiError>);
  return body as T;
}

const segment = encodeURIComponent;

/** Remembers every revision this tab writes, so no view mistakes it for an agent's change. */
async function recorded<T extends { card: CardDetailDto }>(
  project: string,
  id: string,
  request: Promise<T>,
): Promise<T> {
  const result = await request;
  recordWrite(project, id, result.card.revision);
  return result;
}

export const api = {
  cards: () => call<CardListResponse>("/api/cards"),
  /** `since`: the revision the human read, so the server can say who changed the card since. */
  card: (project: string, id: string, since?: string) =>
    call<CardResponse>(
      `/api/cards/${segment(project)}/${segment(id)}${since ? `?since=${segment(since)}` : ""}`,
    ),
  /** `revision` is the revision of the card the human read (see drafts.ts `seen`). */
  act: (project: string, id: string, action: CardAction, revision: string) =>
    recorded(
      project,
      id,
      call<{ ok: true; card: CardDetailDto }>(
        `/api/cards/${segment(project)}/${segment(id)}/actions`,
        { method: "POST", body: JSON.stringify({ ...action, revision }) },
      ),
    ),
  /** Reverts the action that returned `revision`, if nothing changed the card since. */
  undo: (project: string, id: string, revision: string) =>
    recorded(
      project,
      id,
      call<{ ok: true; card: CardDetailDto }>(
        `/api/cards/${segment(project)}/${segment(id)}/undo`,
        {
          method: "POST",
          body: JSON.stringify({ revision }),
        },
      ),
    ),
  addProject: (input: AddProjectRequest) =>
    call<AddProjectResponse>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  removeProject: (name: string) =>
    call<{ removed: { name: string; path: string } }>(`/api/projects/${segment(name)}`, {
      method: "DELETE",
    }),
};
