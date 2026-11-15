/** The card conversation routes, /api/chats/:project/:id/... (app.ts lists the API). */
import type { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { CHAT_ASKS, type ChatStreamEvent, type StartNewOptionsResponse } from "../../core/api.ts";
import { cardId, parseBody, type RouteDeps, readJson, requireProject } from "./http.ts";

const ChatContextSchema = z.object({
  revealed: z.boolean().optional(),
  revision: z.string().optional(),
});

const ChatMessageSchema = ChatContextSchema.extend({
  text: z.string().trim().max(20_000).optional(),
  // A panel button (Teach me, More info) instead of text: the hub writes the request.
  ask: z.enum(CHAT_ASKS).optional(),
}).refine((body) => body.ask !== undefined || (body.text ?? "") !== "", {
  error: "a message is required",
  path: ["text"],
});

const ChatSummarySchema = ChatContextSchema;

const ReopenSchema = z.object({ closed: z.string().min(1).max(200) });

const NewOptionsSchema = ChatSummarySchema.extend({ note: z.string().min(1) });

export function registerChatRoutes(api: Hono, { registry, chat }: RouteDeps): void {
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

  api.post("/chats/:project/:id/new-options", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const input = parseBody(NewOptionsSchema, await readJson(c.req.raw));
    const body: StartNewOptionsResponse = await chat.startNewOptions(
      project,
      cardId(c.req.param("id")),
      input,
    );
    return c.json(body);
  });

  api.post("/chats/:project/:id/close", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    // A JSON body, like every write (security.ts); nothing in it is used.
    await readJson(c.req.raw);
    return c.json(await chat.closeWithoutSummary(project, cardId(c.req.param("id"))));
  });

  api.post("/chats/:project/:id/reopen", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const { closed } = parseBody(ReopenSchema, await readJson(c.req.raw));
    return c.json(await chat.reopen(project, cardId(c.req.param("id")), closed));
  });

  api.post("/chats/:project/:id/new-conversation", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    // A JSON body, like every write (security.ts); nothing in it is used.
    await readJson(c.req.raw);
    return c.json(await chat.newConversation(project, cardId(c.req.param("id"))));
  });
}
