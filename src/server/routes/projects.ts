/** GET, POST /api/projects and DELETE /api/projects/:name (app.ts lists the API). */
import type { Hono } from "hono";
import { z } from "zod";
import type { AddProjectResponse } from "../../core/api.ts";
import { describeProject, forgetUnregisteredCards } from "../cards.ts";
import { allWithCheckouts, withCheckouts } from "../checkouts.ts";
import { parseBody, type RouteDeps, readJson } from "./http.ts";

const AddProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
  createDecisions: z.boolean().optional(),
});

export function registerProjectRoutes(api: Hono, { registry, bus }: RouteDeps): void {
  api.get("/projects", async (c) => {
    const projects = await allWithCheckouts(await registry.list());
    return c.json({ projects: await Promise.all(projects.map(describeProject)) });
  });

  api.post("/projects", async (c) => {
    const input = parseBody(AddProjectSchema, await readJson(c.req.raw));
    const result = await registry.add(input);
    bus.emit({ type: "projects" });
    const body: AddProjectResponse = {
      project: await describeProject(await withCheckouts(result.project)),
      alreadyRegistered: result.alreadyRegistered,
    };
    return c.json(body, result.alreadyRegistered ? 200 : 201);
  });

  api.delete("/projects/:name", async (c) => {
    const removed = await registry.remove(c.req.param("name"));
    forgetUnregisteredCards(await allWithCheckouts(await registry.list()));
    bus.emit({ type: "projects" });
    return c.json({ removed });
  });
}
