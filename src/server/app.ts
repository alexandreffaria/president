/**
 * The HTTP API (and, in production, the built UI).
 *
 *   GET    /api/health
 *   GET    /api/projects
 *   POST   /api/projects                     { path, name?, createDecisions? }
 *   DELETE /api/projects/:name
 *   GET    /api/cards?project=&status=&tag=  cards, broken files and projects (with counts)
 *   GET    /api/queue-count                  { count }: the cards in the Queue, all projects
 *                                            (the tray icon's number, 20261112vzn8)
 *   GET    /api/cards/:project/:id?since=    since = a revision the client read (see
 *                                            CardDetailDto.writtenByPresident)
 *   POST   /api/cards/:project/:id/actions   { type, ..., revision, closeChat? }  (see
 *                                            core/actions.ts); closeChat on a decision
 *                                            without summary also closes the card's
 *                                            conversation, and its undo reopens it (20261112hq3k)
 *   POST   /api/cards/:project/:id/undo      { revision }  revision = what the action returned
 *   GET    /api/chats/:project/:id           the card's conversation on this machine (ChatDto)
 *   POST   /api/chats/:project/:id/messages  { text | ask, revealed?, revision? }  sends a
 *                                            message (or a panel button's request, ask =
 *                                            "teach" | "research") to the card's session;
 *                                            the answer streams back as newline-delimited
 *                                            ChatStreamEvents (chat/)
 *   POST   /api/chats/:project/:id/summary   { revealed?, revision? }  the session's summary,
 *                                            for the human to edit; saving it is the "chat"
 *                                            card action (or "resolve" with `summary`)
 *   POST   /api/chats/:project/:id/new-options  { note, revealed?, revision? }  Try again: starts
 *                                            again the run that writes new options from the
 *                                            "neither" note recorded at `note` (#0007; it
 *                                            starts by itself when the note is recorded)
 *   POST   /api/chats/:project/:id/close     {}  ends the conversation without a summary: the
 *                                            "not summarized" reminder goes; the card isn't
 *                                            written (202611111ky9). Answers { chat, closed }
 *   POST   /api/chats/:project/:id/reopen    { closed }  undoes that close (its notice's Undo)
 *   POST   /api/chats/:project/:id/new-conversation  {}  New conversation (20261112lvbu): ends
 *                                            the card's session; the next message starts a
 *                                            new one from the card and its summaries.
 *                                            Answers the conversation (ChatDto)
 *   GET    /api/sync                         per project: card changes on the remote, the
 *                                            last Sync's result (sync/)
 *   POST   /api/sync                         {}  runs Sync (pulls main) in every project;
 *                                            answers when done
 *   GET    /api/events                       a WebSocket of live events (routes/events.ts;
 *                                            server.ts serves it, web/live.ts connects)
 *
 * Every card write carries the revision the client saw, so nobody decides on text they
 * didn't see: if the file changed since, the write is refused with 409 "conflict". While a
 * project's Sync runs, card writes there are refused with 409 "syncing".
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiError } from "../core/api.ts";
import { ChatService } from "./chat/service.ts";
import { UserError } from "./errors.ts";
import type { Registry } from "./registry.ts";
import { registerCardRoutes } from "./routes/cards.ts";
import { registerChatRoutes } from "./routes/chats.ts";
import { registerEventRoutes } from "./routes/events.ts";
import type { RouteDeps } from "./routes/http.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerStaticRoutes } from "./routes/static.ts";
import { registerSyncRoutes } from "./routes/sync.ts";
import { PresidentWrites } from "./routes/writes.ts";
import { localOnly } from "./security.ts";
import { SyncService } from "./sync/service.ts";
import type { EventBus } from "./watcher.ts";

export interface AppOptions {
  registry: Registry;
  bus: EventBus;
  /** Folder with the built UI (dist/web). When missing, only the API is served. */
  staticDir?: string | undefined;
  /** Runs Sync; one is made for the registry when not given. */
  sync?: SyncService | undefined;
  /** Card conversations; one is made for the registry when not given. */
  chat?: ChatService | undefined;
}

/** Notes are at most 20 000 characters; anything much bigger is not a card action. */
const MAX_BODY_BYTES = 128 * 1024;

/**
 * The hub's app: the middleware and error handler here, then the routes (routes/), in this
 * order: Hono runs middleware and matches routes in the order they are registered.
 */
export function createApp(options: AppOptions): Hono {
  const { registry, bus } = options;
  const sync = options.sync ?? new SyncService(registry, bus);
  const chat = options.chat ?? new ChatService(registry, bus);
  const writes = new PresidentWrites();
  // The new-options run writes the card like any write: never while Sync runs there.
  chat.setCardWriter((project, write) => sync.writeCard(project, write));
  const app = new Hono();

  app.use("*", localOnly());
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) =>
        c.json({ error: `the request body is larger than ${MAX_BODY_BYTES / 1024} kB` }, 413),
    }),
  );

  app.onError((error, c) => {
    if (error instanceof UserError) {
      const body: ApiError = { error: error.message };
      if (error.code) body.code = error.code;
      if (error.details) body.details = error.details;
      return c.json(body, error.status);
    }
    console.error(error);
    return c.json({ error: "internal error; see the server log" } satisfies ApiError, 500);
  });

  const api = new Hono();
  const deps: RouteDeps = { registry, bus, sync, chat, writes };

  // The pid lets the tray helper tell the hub it started from another program on the port.
  api.get("/health", (c) => c.json({ ok: true, pid: process.pid }));

  registerProjectRoutes(api, deps);
  registerCardRoutes(api, deps);
  registerChatRoutes(api, deps);
  registerSyncRoutes(api, deps);
  registerEventRoutes(api, deps);

  api.all("*", (c) => c.json({ error: "not found" } satisfies ApiError, 404));
  app.route("/api", api);

  registerStaticRoutes(app, options.staticDir);

  return app;
}
