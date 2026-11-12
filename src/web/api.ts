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
  ChatDto,
  ChatStreamEvent,
  ChatSummaryResponse,
  SyncRunResponse,
  SyncStatusResponse,
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

/** What a chat request says about the card the page shows (20261111mby8). */
export interface ChatContext {
  /** The page has revealed the card's pick (#0008's r) on `revision`. */
  revealed: boolean;
  revision: string;
}

/**
 * The reply stopped arriving after the hub accepted the message (the connection dropped, a
 * line didn't parse): the message is saved, and the reply will be in the hub's copy.
 */
export class StreamError extends Error {}

/**
 * Sends a message to the card's session and yields the reply's events as they arrive
 * (newline-delimited JSON, see ChatStreamEvent). A refused send (the agent is still
 * answering, the hub unreachable) throws a RequestError before anything is yielded: the
 * message wasn't sent. Once the hub has accepted it, a broken stream throws a StreamError.
 */
async function* sendChat(
  project: string,
  id: string,
  body: ChatContext & { text: string },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  let response: Response;
  try {
    response = await fetch(`/api/chats/${segment(project)}/${segment(id)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new RequestError(0, { error: "can't reach the president server; is it running?" });
  }
  if (!response.ok || !response.body) {
    const error = (await response.json().catch(() => ({}))) as Partial<ApiError>;
    throw new RequestError(response.status, error);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const events: ChatStreamEvent[] = [];
    let finished: boolean;
    try {
      const { done, value } = await reader.read();
      finished = done;
      if (value) buffer += value;
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) events.push(JSON.parse(line) as ChatStreamEvent);
        newline = buffer.indexOf("\n");
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      await reader.cancel().catch(() => {});
      throw new StreamError((error as Error).message);
    }
    yield* events;
    if (finished) break;
  }
}

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
  /** The card's conversation on this machine (the hub's copy, #0018). */
  chat: (project: string, id: string) =>
    call<ChatDto>(`/api/chats/${segment(project)}/${segment(id)}`),
  sendChat,
  /** The session's summary of the conversation, to edit; nothing is saved (#0003). */
  summarize: (project: string, id: string, context: ChatContext) =>
    call<ChatSummaryResponse>(`/api/chats/${segment(project)}/${segment(id)}/summary`, {
      method: "POST",
      body: JSON.stringify(context),
    }),
  addProject: (input: AddProjectRequest) =>
    call<AddProjectResponse>("/api/projects", { method: "POST", body: JSON.stringify(input) }),
  syncStatus: () => call<SyncStatusResponse>("/api/sync"),
  /** Runs Sync in every project; answers when all are done. */
  sync: () => call<SyncRunResponse>("/api/sync", { method: "POST", body: "{}" }),
  removeProject: (name: string) =>
    call<{ removed: { name: string; path: string } }>(`/api/projects/${segment(name)}`, {
      method: "DELETE",
    }),
};
