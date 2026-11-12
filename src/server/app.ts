/**
 * The HTTP API (and, in production, the built UI).
 *
 *   GET    /api/health
 *   GET    /api/projects
 *   POST   /api/projects                     { path, name?, createDecisions? }
 *   DELETE /api/projects/:name
 *   GET    /api/cards?project=&status=&tag=  cards, broken files and projects (with counts)
 *   GET    /api/cards/:project/:id?since=    since = a revision the client read (see
 *                                            CardDetailDto.writtenByPresident)
 *   POST   /api/cards/:project/:id/actions   { type, ..., revision }  (see core/actions.ts)
 *   POST   /api/cards/:project/:id/undo      { revision }  revision = what the action returned
 *   GET    /api/chats/:project/:id           the card's conversation on this machine (ChatDto)
 *   POST   /api/chats/:project/:id/messages  { text, revealed?, revision? }  sends a message to
 *                                            the card's session; the answer streams back as
 *                                            newline-delimited ChatStreamEvents (chat/)
 *   POST   /api/chats/:project/:id/summary   { revealed?, revision? }  the session's summary,
 *                                            for the human to edit; saving it is the "chat"
 *                                            card action (or "resolve" with `summary`)
 *   GET    /api/sync                         per project: answers not synced, card changes on
 *                                            the remote, the last Sync's result (sync.ts)
 *   POST   /api/sync                         {}  runs Sync in every project; answers when done
 *   GET    /api/events                       a WebSocket of live events (the route below;
 *                                            server.ts serves it, web/live.ts connects)
 *
 * Every card write carries the revision the client saw, so nobody decides on text they
 * didn't see: if the file changed since, the write is refused with 409 "conflict". While a
 * project's Sync runs, card writes there are refused with 409 "syncing".
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { upgradeWebSocket } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { stream } from "hono/streaming";
import { z } from "zod";
import { CardActionSchema } from "../core/actions.ts";
import type {
  AddProjectResponse,
  ApiError,
  CardListResponse,
  CardResponse,
  ChatStreamEvent,
  LiveMessage,
} from "../core/api.ts";
import { CARD_ID_PATTERN, CARD_STATUSES, formatIssues } from "../core/schema.ts";
import {
  actOnCard,
  describeProject,
  findCard,
  forgetUnregisteredCards,
  loadProjectCards,
  projectDto,
  toCardDetailDto,
  toCardDto,
  undoLastAction,
} from "./cards.ts";
import { ChatService } from "./chat/service.ts";
import { UserError } from "./errors.ts";
import type { Registry } from "./registry.ts";
import { localOnly } from "./security.ts";
import { SyncService } from "./sync.ts";
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

const AddProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
  createDecisions: z.boolean().optional(),
});

const RevisionSchema = z.object({
  revision: z
    .string({ error: "is required: send the revision of the card you are acting on" })
    .min(1, {
      error: "is required: send the revision of the card you are acting on",
    }),
});

/** Notes are at most 20 000 characters; anything much bigger is not a card action. */
const MAX_BODY_BYTES = 128 * 1024;

const ChatMessageSchema = z.object({
  text: z.string().trim().min(1, { error: "a message is required" }).max(20_000),
  revealed: z.boolean().optional(),
  revision: z.string().optional(),
});

const ChatSummarySchema = ChatMessageSchema.omit({ text: true });

const ListQuerySchema = z.object({
  project: z.string().optional(),
  status: z.enum(CARD_STATUSES).optional(),
  tag: z.string().optional(),
});

export function createApp(options: AppOptions): Hono {
  const { registry, bus } = options;
  const sync = options.sync ?? new SyncService(registry, bus);
  const chat = options.chat ?? new ChatService(registry, bus);
  const writes = new PresidentWrites();
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

  api.get("/health", (c) => c.json({ ok: true }));

  api.get("/projects", async (c) => {
    const projects = await registry.list();
    return c.json({ projects: await Promise.all(projects.map(describeProject)) });
  });

  api.post("/projects", async (c) => {
    const input = parseBody(AddProjectSchema, await readJson(c.req.raw));
    const result = await registry.add(input);
    bus.emit({ type: "projects" });
    const body: AddProjectResponse = {
      project: await describeProject(result.project),
      alreadyRegistered: result.alreadyRegistered,
    };
    return c.json(body, result.alreadyRegistered ? 200 : 201);
  });

  api.delete("/projects/:name", async (c) => {
    const removed = await registry.remove(c.req.param("name"));
    forgetUnregisteredCards(await registry.list());
    bus.emit({ type: "projects" });
    return c.json({ removed });
  });

  api.get("/cards", async (c) => {
    const query = parseBody(ListQuerySchema, c.req.query());
    const registered = await registry.list();
    // Also catches projects removed by the CLI, or by deleting their file in projects/.
    forgetUnregisteredCards(registered);
    const projects = registered.filter((p) => !query.project || p.name === query.project);
    if (query.project && projects.length === 0) {
      throw new UserError(`no project named "${query.project}"`, { status: 404 });
    }
    const loaded = await Promise.all(projects.map(loadProjectCards));
    const response: CardListResponse = { cards: [], broken: [], projectErrors: [], projects: [] };
    loaded.forEach((result, i) => {
      const project = projects[i];
      if (!project) return;
      response.projects.push(projectDto(project, result));
      if (result.error) response.projectErrors.push({ project: project.name, error: result.error });
      response.broken.push(...result.broken);
      for (const card of result.cards) {
        if (query.status && card.frontmatter.status !== query.status) continue;
        if (query.tag && !card.frontmatter.tags.includes(query.tag)) continue;
        response.cards.push(toCardDto(card));
      }
    });
    return c.json(response);
  });

  api.get("/cards/:project/:id", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const found = await findCard(project, c.req.param("id"));
    const since = c.req.query("since") || undefined;
    const body: CardResponse = found.ok
      ? {
          ok: true,
          card: toCardDetailDto(
            found.card,
            writes.explain(found.card.path, found.card.revision, since),
            sync.broughtIn(project, found.card.path, found.card.revision),
          ),
        }
      : { ok: false, broken: found.broken };
    return c.json(body);
  });

  api.post("/cards/:project/:id/actions", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const body = await readJson(c.req.raw);
    const action = parseBody(CardActionSchema, body);
    const { revision } = parseBody(RevisionSchema, body);
    const card = await sync.writeCard(project, () =>
      actOnCard(project, c.req.param("id"), action, { revision }),
    );
    writes.record(card.path, revision, card.revision);
    if (action.type === "chat" || (action.type === "resolve" && action.summary)) {
      // Bookkeeping: the card is already written, so a failure here is logged, never a 500
      // (the page would save the summary again).
      await chat
        .summarySaved(project, card.id, card.revision)
        .catch((error: unknown) => console.error("[chat] recording a saved summary:", error));
    }
    // The watcher will notice too; emitting now makes other tabs update immediately.
    bus.emit({ type: "cards", project: project.name });
    return c.json({ ok: true, card: toCardDetailDto(card, true) } satisfies CardResponse);
  });

  api.post("/cards/:project/:id/undo", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const { revision } = parseBody(RevisionSchema, await readJson(c.req.raw));
    const card = await sync.writeCard(project, () =>
      undoLastAction(project, c.req.param("id"), revision),
    );
    writes.record(card.path, revision, card.revision);
    // Bookkeeping, as for summarySaved: the undo itself is done.
    await chat
      .undone(revision)
      .catch((error: unknown) => console.error("[chat] recording an undone summary:", error));
    bus.emit({ type: "cards", project: project.name });
    return c.json({ ok: true, card: toCardDetailDto(card, true) } satisfies CardResponse);
  });

  api.get("/chats/:project/:id", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    return c.json(await chat.conversation(project, cardId(c.req.param("id"))));
  });

  api.post("/chats/:project/:id/messages", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const input = parseBody(ChatMessageSchema, await readJson(c.req.raw));
    const run = await chat.send(project, cardId(c.req.param("id")), input);
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header("cache-control", "no-store");
    // The run goes on if the page goes away: its reply is saved and shown next time.
    return stream(c, async (out) => {
      const lines: ChatStreamEvent[] = [];
      let wake = () => {};
      const unsubscribe = run.subscribe((event) => {
        lines.push(event);
        wake();
      });
      // Wake the loop too, so it sees the page went away and the handler ends.
      out.onAbort(() => {
        unsubscribe();
        wake();
      });
      try {
        while (!out.aborted) {
          const event = lines.shift();
          if (!event) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          await out.write(`${JSON.stringify(event)}
`);
          if (event.type === "done" || event.type === "error") break;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  api.post("/chats/:project/:id/summary", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const input = parseBody(ChatSummarySchema, await readJson(c.req.raw));
    return c.json(await chat.summarize(project, cardId(c.req.param("id")), input));
  });

  api.get("/sync", async (c) => c.json(await sync.status()));

  api.post("/sync", async (c) => {
    // A JSON body, like every write (security.ts); nothing in it is used.
    await readJson(c.req.raw);
    return c.json(await sync.sync());
  });

  // Live events. Each socket gets "ready" once it is subscribed, then every hub event.
  api.get(
    "/events",
    upgradeWebSocket(() => {
      let unsubscribe = () => {};
      return {
        onOpen(_event, ws) {
          const send = (message: LiveMessage) => ws.send(JSON.stringify(message));
          unsubscribe = bus.subscribe(send);
          send({ type: "ready" });
        },
        onClose() {
          unsubscribe();
        },
      };
    }),
    (c) =>
      c.json({ error: "/api/events is a WebSocket; connect with one" } satisfies ApiError, 426),
  );

  api.all("*", (c) => c.json({ error: "not found" } satisfies ApiError, 404));
  app.route("/api", api);

  const staticDir = options.staticDir;
  if (staticDir && existsSync(join(staticDir, "index.html"))) {
    app.use("/assets/*", serveStatic({ root: staticDir }));
    app.use("*", serveStatic({ root: staticDir }));
    // Client-side routes (/card/..., /log, /projects) all get the app shell.
    app.get("*", async (c) => c.html(await readFile(join(staticDir, "index.html"), "utf8")));
  } else {
    app.get("/", (c) =>
      c.text(
        "president API is running, but the UI is not built. Run `npm run build`, or use `npm run dev` and open the Vite URL.",
      ),
    );
  }

  return app;
}

/**
 * The card revisions this server wrote (actions and undos), so it can tell a page whether a
 * change it didn't see was the human's own (from another tab) or someone else's. Kept for
 * the 500 most recently written cards, 20 writes each; a restart forgets them, and a page
 * then takes the change for an agent's, which only shows one notice too many.
 */
class PresidentWrites {
  readonly #byPath = new Map<string, { from: string; to: string }[]>();

  record(path: string, from: string, to: string): void {
    const list = this.#byPath.get(path) ?? [];
    list.push({ from, to });
    if (list.length > 20) list.shift();
    this.#byPath.delete(path);
    this.#byPath.set(path, list);
    if (this.#byPath.size > 500) this.#byPath.delete(this.#byPath.keys().next().value as string);
  }

  /**
   * Whether this server's own writes alone lead from `since` to `revision` (without
   * `since`: whether its last write produced `revision`).
   */
  explain(path: string, revision: string, since: string | undefined): boolean {
    const list = this.#byPath.get(path) ?? [];
    if (since === undefined) return list.at(-1)?.to === revision;
    let current = revision;
    // Walk back from the newest write: each must have produced the revision the next one
    // started from. A gap means someone else changed the file in between.
    for (let i = list.length - 1; current !== since; i--) {
      const write = list[i];
      if (!write || write.to !== current) return false;
      current = write.from;
    }
    return true;
  }
}

async function requireProject(registry: Registry, name: string) {
  const project = await registry.get(name);
  if (!project) throw new UserError(`no project named "${name}"`, { status: 404 });
  return project;
}

function cardId(id: string): string {
  if (!CARD_ID_PATTERN.test(id)) throw new UserError(`"${id}" is not a valid card id`);
  return id;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserError("the request body must be JSON");
  }
}

function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UserError("invalid request", { details: formatIssues(result.error), status: 400 });
  }
  return result.data;
}
