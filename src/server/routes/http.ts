/**
 * What the route files (routes/) share: the hub's services, handed in by createApp
 * (app.ts), and the helpers that read a request.
 */
import type { z } from "zod";
import { CARD_ID_PATTERN, formatIssues } from "../../core/schema.ts";
import type { ChatService } from "../chat/service.ts";
import { UserError } from "../errors.ts";
import type { Registry } from "../registry.ts";
import type { SyncService } from "../sync/service.ts";
import type { EventBus } from "../watcher.ts";
import type { PresidentWrites } from "./writes.ts";

export interface RouteDeps {
  registry: Registry;
  bus: EventBus;
  sync: SyncService;
  chat: ChatService;
  writes: PresidentWrites;
}

export async function requireProject(registry: Registry, name: string) {
  const project = await registry.get(name);
  if (!project) throw new UserError(`no project named "${name}"`, { status: 404 });
  return project;
}

export function cardId(id: string): string {
  if (!CARD_ID_PATTERN.test(id)) throw new UserError(`"${id}" is not a valid card id`);
  return id;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new UserError("the request body must be JSON");
  }
}

export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new UserError("invalid request", { details: formatIssues(result.error), status: 400 });
  }
  return result.data;
}
