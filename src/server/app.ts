/**
 * The HTTP API (and, in production, the built UI).
 *
 *   GET    /api/health
 *   GET    /api/projects
 *   POST   /api/projects                     { path, name?, createDecisions? }
 *   DELETE /api/projects/:name
 *   GET    /api/cards?project=&status=&tag=
 *   GET    /api/cards/:project/:id
 *   POST   /api/cards/:project/:id/actions   { type, ..., revision? }  (see core/actions.ts)
 *   GET    /api/events                       server-sent events: "cards" and "projects"
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { CardActionSchema } from "../core/actions.ts";
import type {
  AddProjectResponse,
  ApiError,
  CardListResponse,
  CardResponse,
  HubEvent,
} from "../core/api.ts";
import { CARD_STATUSES, formatIssues } from "../core/schema.ts";
import {
  actOnCard,
  describeProject,
  findCard,
  loadProjectCards,
  toCardDetailDto,
  toCardDto,
} from "./cards.ts";
import { UserError } from "./errors.ts";
import type { Registry } from "./registry.ts";
import { localOnly } from "./security.ts";
import type { EventBus } from "./watcher.ts";

export interface AppOptions {
  registry: Registry;
  bus: EventBus;
  /** Folder with the built UI (dist/web). When missing, only the API is served. */
  staticDir?: string | undefined;
  /** Interval between SSE keep-alive pings. */
  heartbeatMs?: number;
}

const AddProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
  createDecisions: z.boolean().optional(),
});

const RevisionSchema = z.object({ revision: z.string().optional() });

const ListQuerySchema = z.object({
  project: z.string().optional(),
  status: z.enum(CARD_STATUSES).optional(),
  tag: z.string().optional(),
});

export function createApp(options: AppOptions): Hono {
  const { registry, bus } = options;
  const app = new Hono();

  app.use("*", localOnly());

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
    bus.emit({ type: "projects" });
    return c.json({ removed });
  });

  api.get("/cards", async (c) => {
    const query = parseBody(ListQuerySchema, c.req.query());
    const projects = (await registry.list()).filter(
      (p) => !query.project || p.name === query.project,
    );
    if (query.project && projects.length === 0) {
      throw new UserError(`no project named "${query.project}"`, { status: 404 });
    }
    const loaded = await Promise.all(projects.map(loadProjectCards));
    const response: CardListResponse = { cards: [], broken: [], projectErrors: [] };
    loaded.forEach((result, i) => {
      const project = projects[i];
      if (!project) return;
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
    const body: CardResponse = found.ok
      ? { ok: true, card: toCardDetailDto(found.card) }
      : { ok: false, broken: found.broken };
    return c.json(body);
  });

  api.post("/cards/:project/:id/actions", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const body = await readJson(c.req.raw);
    const action = parseBody(CardActionSchema, body);
    const { revision } = parseBody(RevisionSchema, body);
    const card = await actOnCard(project, c.req.param("id"), action, { revision });
    // The watcher will notice too; emitting now makes other tabs update immediately.
    bus.emit({ type: "cards", project: project.name });
    return c.json({ ok: true, card: toCardDetailDto(card) } satisfies CardResponse);
  });

  api.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      let closed = false;
      const send = (event: HubEvent) =>
        stream.writeSSE({ event: event.type, data: JSON.stringify(event) }).catch(() => {});
      const unsubscribe = bus.subscribe(send);
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });
      await stream.writeSSE({ event: "ready", data: "{}" });
      while (!closed) {
        await stream.sleep(options.heartbeatMs ?? 25_000);
        if (!closed) await stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
      }
    }),
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

async function requireProject(registry: Registry, name: string) {
  const project = await registry.get(name);
  if (!project) throw new UserError(`no project named "${name}"`, { status: 404 });
  return project;
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
