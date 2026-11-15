/** GET and POST /api/sync (app.ts lists the API; sync/ runs it). */
import type { Hono } from "hono";
import { type RouteDeps, readJson } from "./http.ts";

export function registerSyncRoutes(api: Hono, { sync }: RouteDeps): void {
  api.get("/sync", async (c) => c.json(await sync.status()));

  api.post("/sync", async (c) => {
    // A JSON body, like every write (security.ts); nothing in it is used.
    await readJson(c.req.raw);
    return c.json(await sync.sync());
  });
}
