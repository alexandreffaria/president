/**
 * The card routes (app.ts lists the API): the list, the Queue's count, one card, its
 * actions and their undo.
 */
import type { Hono } from "hono";
import { z } from "zod";
import { CardActionSchema } from "../../core/actions.ts";
import type {
  CardActionResponse,
  CardListResponse,
  CardResponse,
  QueueCountResponse,
} from "../../core/api.ts";
import { buildQueue } from "../../core/queue.ts";
import { CARD_STATUSES } from "../../core/schema.ts";
import {
  actOnCard,
  findCard,
  forgetUnregisteredCards,
  loadProjectCards,
  projectDto,
  toCardDetailDto,
  toCardDto,
  undoLastAction,
} from "../cards.ts";
import { UserError } from "../errors.ts";
import { parseBody, type RouteDeps, readJson, requireProject } from "./http.ts";

const RevisionSchema = z.object({
  revision: z
    .string({ error: "is required: send the revision of the card you are acting on" })
    .min(1, {
      error: "is required: send the revision of the card you are acting on",
    }),
});

/** Hub-only extras of a card action, next to it in the body. */
const ActionExtrasSchema = z.object({ closeChat: z.boolean().optional() });

const ListQuerySchema = z.object({
  project: z.string().optional(),
  status: z.enum(CARD_STATUSES).optional(),
  tag: z.string().optional(),
});

export function registerCardRoutes(
  api: Hono,
  { registry, bus, sync, chat, writes }: RouteDeps,
): void {
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

  // The number on the tray icon (Windows and Linux): the Queue's "All" count, worked out by
  // the same buildQueue the page uses, so the two can't disagree.
  api.get("/queue-count", async (c) => {
    const registered = await registry.list();
    forgetUnregisteredCards(registered);
    const loaded = await Promise.all(registered.map(loadProjectCards));
    const cards = loaded.flatMap((result) => result.cards.map(toCardDto));
    return c.json({ count: buildQueue(cards).length } satisfies QueueCountResponse);
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
    const { closeChat } = parseBody(ActionExtrasSchema, body);
    if (closeChat && (action.type !== "resolve" || action.summary)) {
      throw new UserError("closeChat goes with a decision that carries no summary", {
        status: 400,
      });
    }
    const id = c.req.param("id");
    const write = () => sync.writeCard(project, () => actOnCard(project, id, action, { revision }));
    // Ask for new options (#0007): refused while the card's run goes on, before the card is
    // written; otherwise the run starts now, and an Undo stops it (2026111459oa).
    const asked =
      action.type === "neither" ? await chat.newOptionsAsked(project, id, write) : undefined;
    const card = asked?.card ?? (await write());
    writes.record(card.path, revision, card.revision);
    if (asked && !asked.started) {
      // The note is written: say so, rather than a bare 500 the page would read as unsaved.
      bus.emit({ type: "cards", project: project.name });
      throw new UserError(
        "your note is saved and the card waits for the project's agent, but president couldn't ask for new options right away (see the server log)",
        { status: 500, code: "new_options_unrecorded" },
      );
    }
    const savesSummary =
      action.type === "chat" || (action.type === "resolve" && Boolean(action.summary));
    if (savesSummary) {
      // Bookkeeping: the card is already written, so a failure here is logged, never a 500
      // (the page would save the summary again).
      await chat
        .summarySaved(project, card.id, card.revision)
        .catch((error: unknown) => console.error("[chat] recording a saved summary:", error));
    }
    if (closeChat) {
      // "Decide without summary" (20261112hq3k): bookkeeping too, never a failed write.
      await chat
        .closeWithoutSummary(project, card.id, { decision: card.revision })
        .catch((error: unknown) => console.error("[chat] closing the conversation:", error));
    }
    // What the conversation is now, so the page knows whether its reminder is still due.
    const unsummarized =
      savesSummary || closeChat
        ? await chat
            .conversation(project, card.id)
            .then((copy) => copy.unsummarized)
            .catch(() => undefined)
        : undefined;
    // The watcher will notice too; emitting now makes other tabs update immediately.
    bus.emit({ type: "cards", project: project.name });
    return c.json({
      ok: true,
      card: toCardDetailDto(card, true),
      ...(unsummarized === undefined ? {} : { unsummarized }),
    } satisfies CardActionResponse);
  });

  api.post("/cards/:project/:id/undo", async (c) => {
    const project = await requireProject(registry, c.req.param("project"));
    const { revision } = parseBody(RevisionSchema, await readJson(c.req.raw));
    const id = c.req.param("id");
    const card = await chat.undoing(project, id, () =>
      sync.writeCard(project, () => undoLastAction(project, id, revision)),
    );
    writes.record(card.path, revision, card.revision);
    // Bookkeeping, as for summarySaved: the undo itself is done.
    await chat
      .undone(revision)
      .catch((error: unknown) => console.error("[chat] recording an undone summary:", error));
    bus.emit({ type: "cards", project: project.name });
    return c.json({ ok: true, card: toCardDetailDto(card, true) } satisfies CardResponse);
  });
}
