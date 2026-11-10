import { readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CardDetailDto,
  CardListResponse,
  CardResponse,
  HubEvent,
  ProjectDto,
} from "../src/core/api.ts";
import { createApp } from "../src/server/app.ts";
import { Registry } from "../src/server/registry.ts";
import { EventBus } from "../src/server/watcher.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

async function setup() {
  const registry = new Registry(join(await tempDir(), "config"));
  const demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const app = createApp({ registry, bus, staticDir: undefined });
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.request(`http://127.0.0.1:4747${path}`, init);
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { app, registry, demo, events, request, post };
}

async function json<T = { error: string; code?: string; details: string[] }>(
  response: Response | Promise<Response>,
): Promise<T> {
  return (await response).json() as Promise<T>;
}

describe("projects API", () => {
  it("lists projects with counts", async () => {
    const { request, demo } = await setup();
    const { projects } = await json<{ projects: ProjectDto[] }>(request("/api/projects"));
    expect(projects).toEqual([
      {
        name: "demo",
        path: demo,
        decisionsDir: join(demo, "decisions"),
        counts: { open: 2, deferred: 1, resolved: 1, broken: 0 },
      },
    ]);
  });

  it("adds and removes projects and announces the change", async () => {
    const { request, post, events } = await setup();
    const dir = await tempDir();
    const missing = await post("/api/projects", { path: dir });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "no_decisions_dir" });

    const added = await post("/api/projects", { path: dir, name: "fresh", createDecisions: true });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({
      project: { name: "fresh" },
      alreadyRegistered: false,
    });
    expect(events).toContainEqual({ type: "projects" });

    expect((await request("/api/projects/fresh", { method: "DELETE" })).status).toBe(200);
    expect((await request("/api/projects/fresh", { method: "DELETE" })).status).toBe(404);
  });

  it("validates the request body", async () => {
    const { post } = await setup();
    const res = await post("/api/projects", { path: 42 });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "invalid request",
      details: [expect.stringMatching(/^path:/)],
    });
  });
});

describe("cards API", () => {
  it("lists cards across projects with filters", async () => {
    const { request } = await setup();
    const all = await json<CardListResponse>(request("/api/cards"));
    expect(all.cards.map((c) => c.id).sort()).toEqual(["0001", "0002", "0003", "0004"]);
    expect(all.cards[0]).not.toHaveProperty("body");

    const open = await json<CardListResponse>(request("/api/cards?status=open"));
    expect(open.cards.map((c) => c.id).sort()).toEqual(["0001", "0002"]);
    const tagged = await json<CardListResponse>(request("/api/cards?tag=maps"));
    expect(tagged.cards.map((c) => c.id)).toEqual(["0004"]);
    const byProject = await json<CardListResponse>(
      request("/api/cards?project=demo&status=deferred"),
    );
    expect(byProject.cards.map((c) => c.id)).toEqual(["0003"]);
    expect((await request("/api/cards?project=nope")).status).toBe(404);
    expect((await request("/api/cards?status=done")).status).toBe(400);
  });

  it("returns a card with its body split into sections", async () => {
    const { request, demo } = await setup();
    const res = await json<CardResponse>(request("/api/cards/demo/0002"));
    if (!res.ok) throw new Error("expected a valid card");
    expect(res.card.path).toBe(join(demo, "decisions", "0002-api-errors.md"));
    expect(res.card.sections.options.map((o) => o.id)).toEqual(["throw", "result"]);
    expect(res.card.sections.context).toMatch(/^## Context/);
  });

  it("shows broken cards with the reason instead of failing", async () => {
    const { request, demo } = await setup();
    await writeFile(
      join(demo, "decisions", "0009-broken.md"),
      cardText({ id: '"0009"', kind: "ab", status: "maybe" }),
    );
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.cards).toHaveLength(4);
    expect(list.broken).toEqual([
      {
        project: "demo",
        fileName: "0009-broken.md",
        id: "0009",
        errors: [expect.stringMatching(/^status:/)],
      },
    ]);
    const one = await json<CardResponse>(request("/api/cards/demo/0009"));
    expect(one).toMatchObject({ ok: false, broken: { fileName: "0009-broken.md" } });
  });

  it("reports duplicate ids as broken", async () => {
    const { request, demo } = await setup();
    await writeFile(
      join(demo, "decisions", "0002-copy.md"),
      await readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"),
    );
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.cards.map((c) => c.id)).not.toContain("0002");
    expect(list.broken.map((b) => b.fileName)).toEqual(["0002-api-errors.md", "0002-copy.md"]);
  });

  it("ignores readme, hidden, underscore and non-markdown files, and symlinks", async () => {
    const { request, demo } = await setup();
    const dir = join(demo, "decisions");
    await writeFile(join(dir, "README.md"), "# About these cards\n");
    await writeFile(join(dir, "_template.md"), "draft");
    await writeFile(join(dir, ".0005-x.md.tmp"), "partial");
    await writeFile(join(dir, "notes.txt"), "x");
    const outside = join(await tempDir(), "0007-outside.md");
    await writeFile(outside, cardText({ id: '"0007"' }));
    await symlink(outside, join(dir, "0007-outside.md"));
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.cards).toHaveLength(4);
    expect(list.broken).toEqual([]);
  });

  it("refuses path traversal and odd ids", async () => {
    const { request } = await setup();
    for (const path of [
      "/api/cards/demo/..%2F..%2Fetc%2Fpasswd",
      "/api/cards/demo/0001-offline-storage.md",
      "/api/cards/demo/0001%00",
      "/api/cards/..%2Fdemo/0001",
      "/api/cards/demo/../../etc/passwd",
    ]) {
      const res = await request(path);
      expect([400, 404], path).toContain(res.status);
    }
  });
});

describe("card actions API", () => {
  async function card(request: (p: string) => Promise<Response>, id: string) {
    const res = await json<CardResponse>(request(`/api/cards/demo/${id}`));
    if (!res.ok) throw new Error("broken");
    return res.card;
  }

  it("resolves a card, writes the file and announces the change", async () => {
    const { request, post, demo, events } = await setup();
    const before = await card(request, "0002");
    const res = await post("/api/cards/demo/0002/actions", {
      type: "resolve",
      choice: "result",
      note: "Keep the codes few.",
      revision: before.revision,
    });
    expect(res.status).toBe(200);
    const { card: after } = (await res.json()) as { card: CardDetailDto };
    expect(after.frontmatter.status).toBe("resolved");
    expect(after.revision).not.toBe(before.revision);
    expect(events).toContainEqual({ type: "cards", project: "demo" });
    const text = await readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8");
    expect(text).toContain("choice: result");
    expect(text).toContain(before.body);
  });

  it("supports neither, note, defer and reopen", async () => {
    const { post } = await setup();
    const act = async (id: string, body: object) => {
      const res = await post(`/api/cards/demo/${id}/actions`, body);
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      return ((await res.json()) as { card: CardDetailDto }).card.frontmatter;
    };
    expect(await act("0001", { type: "neither", note: "Too heavy." })).toMatchObject({
      status: "open",
      needs_new_options: true,
    });
    expect((await act("0001", { type: "note", note: "Ask Sam." })).feedback).toHaveLength(3);
    expect((await act("0002", { type: "defer" })).status).toBe("deferred");
    expect((await act("0002", { type: "reopen" })).status).toBe("open");
    expect(
      (await act("0004", { type: "reopen", note: "Costs changed." })).resolution,
    ).toBeUndefined();
  });

  it("rejects invalid actions with a reason", async () => {
    const { post } = await setup();
    const cases: [string, object, number, RegExp][] = [
      ["0002", { type: "resolve", choice: "nope" }, 409, /not an option/],
      ["0002", { type: "neither" }, 400, /invalid request/],
      ["0002", { type: "explode" }, 400, /invalid request/],
      ["0004", { type: "defer" }, 409, /cannot defer a card while it is resolved/],
      ["9999", { type: "defer" }, 404, /no card "9999"/],
    ];
    for (const [id, body, status, message] of cases) {
      const res = await post(`/api/cards/demo/${id}/actions`, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect((await json(res)).error).toMatch(message);
    }
  });

  it("refuses to act on a card that changed on disk", async () => {
    const { request, post, demo } = await setup();
    const before = await card(request, "0002");
    const file = join(demo, "decisions", "0002-api-errors.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("priority: normal", "priority: high"),
    );
    const res = await post("/api/cards/demo/0002/actions", {
      type: "defer",
      revision: before.revision,
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict" });
  });

  it("refuses to act on a broken card", async () => {
    const { post, demo } = await setup();
    await writeFile(
      join(demo, "decisions", "0009-broken.md"),
      cardText({ id: '"0009"', kind: "ab", options: "[]" }),
    );
    const res = await post("/api/cards/demo/0009/actions", { type: "defer" });
    expect(res.status).toBe(422);
    expect((await json(res)).details[0]).toMatch(/exactly 2 options/);
  });

  it("serializes concurrent actions on one card", async () => {
    const { post, request } = await setup();
    const notes = ["one", "two", "three", "four", "five"];
    const results = await Promise.all(
      notes.map((note) => post("/api/cards/demo/0001/actions", { type: "note", note })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    const after = await card(request, "0001");
    expect(
      after.frontmatter.feedback
        .map((f) => f.note)
        .slice(1)
        .sort(),
    ).toEqual([...notes].sort());
  });
});

describe("local-only guard", () => {
  it("rejects requests addressed to other hosts (DNS rebinding)", async () => {
    const { app } = await setup();
    const res = await app.request("http://evil.example:4747/api/projects");
    expect(res.status).toBe(403);
    const viaHeader = await app.request("http://127.0.0.1:4747/api/projects", {
      headers: { host: "evil.example:4747" },
    });
    expect(viaHeader.status).toBe(403);
  });

  it("rejects cross-origin writes and non-JSON bodies", async () => {
    const { request } = await setup();
    const crossOrigin = await request("/api/cards/demo/0002/actions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ type: "defer" }),
    });
    expect(crossOrigin.status).toBe(403);
    const formPost = await request("/api/cards/demo/0002/actions", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ type: "defer" }),
    });
    expect(formPost.status).toBe(415);
    const sameOrigin = await request("/api/cards/demo/0002/actions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ type: "defer" }),
    });
    expect(sameOrigin.status).toBe(200);
  });
});

describe("unknown API routes", () => {
  it("answer 404 JSON", async () => {
    const { request } = await setup();
    const res = await request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
