import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  CardDetailDto,
  CardListResponse,
  CardResponse,
  HubEvent,
  ProjectDto,
} from "../src/core/api.ts";
import { agentToken, unseenFeedback } from "../src/core/pending.ts";
import { createApp } from "../src/server/app.ts";
import { cachedCardPaths } from "../src/server/cards.ts";
import { Registry } from "../src/server/registry.ts";
import { EventBus } from "../src/server/watcher.ts";
import { cardText, copyDemoProject, diffLines, tempDir } from "./helpers.ts";

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
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const remove = (path: string) => request(path, { method: "DELETE", headers: { origin: ORIGIN } });
  /** Acts on a card with the revision it has right now, like the UI does. */
  const act = async (id: string, body: object) => {
    const card = await json<CardResponse>(request(`/api/cards/demo/${id}`));
    const revision = card.ok ? card.card.revision : "none";
    return post(`/api/cards/demo/${id}/actions`, { revision, ...body });
  };
  return { app, registry, demo, events, request, post, remove, act };
}

const ORIGIN = "http://127.0.0.1:4747";

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

  it("says when a project's folder is missing (R5-21)", async () => {
    const { request, demo } = await setup();
    await rm(join(demo, "decisions"), { recursive: true });
    const errorOf = async () =>
      (await json<{ projects: ProjectDto[] }>(request("/api/projects"))).projects[0]?.error;
    expect(await errorOf()).toBe(`${join(demo, "decisions")} does not exist`);
    await rm(demo, { recursive: true });
    expect(await errorOf()).toBe(
      `the project folder ${demo} is missing. If it moved, remove this project and add it again from its new place.`,
    );
  });

  it("adds and removes projects and announces the change", async () => {
    const { post, remove, events } = await setup();
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

    expect((await remove("/api/projects/fresh")).status).toBe(200);
    expect((await remove("/api/projects/fresh")).status).toBe(404);
  });

  // A typo through a file, or a link loop, is the user's to fix: a 422 that says so (R10-2).
  it("answers a path through a file or a link loop with what is wrong, not a 500", async () => {
    const { post } = await setup();
    const scratch = await tempDir();
    await writeFile(join(scratch, "file.txt"), "notes");
    await symlink("loop", join(scratch, "loop"));
    const project = join(scratch, "project");
    await mkdir(project);
    await symlink("decisions", join(project, "decisions"));
    const cases: [object, string][] = [
      [{ path: join(scratch, "file.txt", "x") }, "a part of the path is a file, not a folder"],
      [{ path: join(scratch, "loop") }, "the path goes through a loop of links"],
      [{ path: project, createDecisions: true }, "the path goes through a loop of links"],
    ];
    for (const [body, reason] of cases) {
      const res = await post("/api/projects", body);
      expect(res.status).toBe(422);
      expect((await json(res)).error).toMatch(`: ${reason}`);
    }
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
    // Two agents that picked the same id at once are told which of them renumbers (R5-18).
    expect(list.broken[1]?.errors).toEqual([
      'id "0002" is also used by 0002-api-errors.md; give each card its own id. If you wrote one of them, give yours (the newer one) the next free id: change its id and rename its file to match',
    ]);
  });

  it("ignores readme, hidden, underscore and non-markdown files", async () => {
    const { request, demo } = await setup();
    const dir = join(demo, "decisions");
    await writeFile(join(dir, "README.md"), "# About these cards\n");
    await writeFile(join(dir, "_template.md"), "draft");
    await writeFile(join(dir, ".0005-x.md.tmp"), "partial");
    await writeFile(join(dir, "notes.txt"), "x");
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.cards).toHaveLength(4);
    expect(list.broken).toEqual([]);
  });

  it("shows a symlinked card as broken instead of following it", async () => {
    const { request, demo } = await setup();
    const outside = join(await tempDir(), "0007-outside.md");
    await writeFile(outside, cardText({ id: '"0007"' }));
    await symlink(outside, join(demo, "decisions", "0007-outside.md"));
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.cards).toHaveLength(4);
    expect(list.broken).toEqual([
      {
        project: "demo",
        fileName: "0007-outside.md",
        id: "0007",
        errors: [expect.stringMatching(/symlink; president doesn't follow symlinks/)],
      },
    ]);
  });

  it("refuses a decisions folder that links outside the project", async () => {
    const { request, post, demo } = await setup();
    const outside = join(await tempDir(), "elsewhere");
    await rename(join(demo, "decisions"), outside);
    await symlink(outside, join(demo, "decisions"));
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.cards).toEqual([]);
    expect(list.projectErrors[0]?.error).toMatch(
      /outside the project; president doesn't follow it/,
    );
    const res = await post("/api/cards/demo/0002/actions", { type: "defer", revision: "x" });
    expect(res.status).toBe(404);
    expect((await readFile(join(outside, "0002-api-errors.md"), "utf8")).includes("deferred")).toBe(
      false,
    );
  });

  it("keeps serving the project when one card is hostile YAML", async () => {
    const { request, demo } = await setup();
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    const names = "abcdefgh";
    for (let i = 1; i < names.length; i++) {
      lines.push(
        `${names[i]}: &${names[i]} [${Array(10)
          .fill(`*${names[i - 1]}`)
          .join(",")}]`,
      );
    }
    await writeFile(join(demo, "decisions", "0009-aliases.md"), `---\n${lines.join("\n")}\n---\n`);
    const list = await request("/api/cards");
    expect(list.status).toBe(200);
    const body = (await list.json()) as CardListResponse;
    expect(body.cards).toHaveLength(4);
    expect(body.broken[0]?.errors[0]).toMatch(/Excessive alias count/);
    expect((await request("/api/projects")).status).toBe(200);
    expect((await request("/api/cards/demo/0001")).status).toBe(200);
  });

  it("returns the projects with their counts along with the cards", async () => {
    const { request, demo } = await setup();
    const list = await json<CardListResponse>(request("/api/cards"));
    expect(list.projects).toEqual([
      {
        name: "demo",
        path: demo,
        decisionsDir: join(demo, "decisions"),
        counts: { open: 2, deferred: 1, resolved: 1, broken: 0 },
      },
    ]);
  });

  it("reuses parsed cards in listings but never serves a changed file", async () => {
    const { request, demo } = await setup();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const old = new Date("2026-01-01T00:00:00Z");
    await utimes(file, old, old);
    const title = async () =>
      (await json<CardListResponse>(request("/api/cards"))).cards.find((c) => c.id === "0002")
        ?.frontmatter.title;
    // Pretend the file settled long ago, so the first listing caches it.
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
    try {
      expect(await title()).toBe("How should the API client report errors?");
      expect(cachedCardPaths()).toContain(file);
      // Same length, same (old) modification time: only the inode change time differs.
      const text = await readFile(file, "utf8");
      await writeFile(file, text.replace("How should the API", "How should the APP"));
      await utimes(file, old, old);
      expect((await stat(file)).size).toBe(Buffer.byteLength(text));
      expect(await title()).toBe("How should the APP client report errors?");
    } finally {
      now.mockRestore();
    }
  });

  it("serves a settled card from the cache until it changes", async () => {
    const { request, demo } = await setup();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const title = async () =>
      (await json<CardListResponse>(request("/api/cards"))).cards.find((c) => c.id === "0002")
        ?.frontmatter.title;
    const later = Date.now() + 3_600_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      expect(await title()).toBe("How should the API client report errors?");
      await writeFile(file, (await readFile(file, "utf8")).replace("the API client", "our client"));
      expect(await title()).toBe("How should our client report errors?");
    } finally {
      now.mockRestore();
    }
  });

  it("forgets the cached cards of a project once it is unregistered", async () => {
    const { request, remove, demo } = await setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_600_000);
    try {
      await request("/api/cards");
      const inDemo = () => cachedCardPaths().filter((p) => p.startsWith(join(demo, "decisions")));
      expect(inDemo()).toHaveLength(4);
      expect((await remove("/api/projects/demo")).status).toBe(200);
      expect(inDemo()).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("explains an invalid registry file instead of a bare 500", async () => {
    const { request, registry } = await setup();
    await writeFile(join(registry.dir, "demo.json"), JSON.stringify({ path: "relative" }));
    const res = await request("/api/cards");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      code: "invalid_config",
      error: expect.stringMatching(/demo\.json is invalid: path: must be an absolute path/),
    });
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
    expect(after.writtenByPresident).toBe(true);
    expect(events).toContainEqual({ type: "cards", project: "demo" });
    const text = await readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8");
    expect(text).toContain("choice: result");
    expect(text).toContain(before.body);
  });

  it("supports neither, note, defer and reopen", async () => {
    const { act } = await setup();
    const frontmatter = async (id: string, body: object) => {
      const res = await act(id, body);
      expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
      return ((await res.json()) as { card: CardDetailDto }).card.frontmatter;
    };
    expect(await frontmatter("0001", { type: "neither", note: "Too heavy." })).toMatchObject({
      status: "open",
      needs_new_options: true,
    });
    expect((await frontmatter("0001", { type: "note", note: "Ask Sam." })).feedback).toHaveLength(
      3,
    );
    expect((await frontmatter("0002", { type: "defer" })).status).toBe("deferred");
    expect((await frontmatter("0002", { type: "reopen" })).status).toBe("open");
    expect(
      (await frontmatter("0004", { type: "reopen", note: "Costs changed." })).resolution,
    ).toBeUndefined();
  });

  it("rejects invalid actions with a reason", async () => {
    const { act } = await setup();
    const cases: [string, object, number, RegExp][] = [
      ["0002", { type: "resolve", choice: "nope" }, 422, /not an option/],
      ["0001", { type: "resolve", choice: "custom" }, 422, /needs a note/],
      ["0002", { type: "resolve", choice: "x".repeat(41) }, 400, /invalid request/],
      ["0002", { type: "neither" }, 400, /invalid request/],
      ["0002", { type: "explode" }, 400, /invalid request/],
      ["0004", { type: "defer" }, 409, /cannot defer a card while it is resolved/],
      ["9999", { type: "defer" }, 404, /no card "9999"/],
      ["0002", { type: "seen" }, 400, /invalid request/],
      ["0004", { type: "applied", token: "0-aaaaaaaaaaa" }, 409, /president pending/],
    ];
    for (const [id, body, status, message] of cases) {
      const res = await act(id, body);
      expect(res.status, JSON.stringify(body)).toBe(status);
      expect((await json(res)).error).toMatch(message);
    }
  });

  it("requires the revision the client saw", async () => {
    const { post } = await setup();
    for (const revision of [undefined, ""]) {
      const res = await post("/api/cards/demo/0002/actions", { type: "note", note: "x", revision });
      expect(res.status).toBe(400);
      expect((await json(res)).details).toEqual([expect.stringMatching(/^revision: is required/)]);
    }
  });

  it("refuses an oversized request body", async () => {
    const { post } = await setup();
    const res = await post("/api/cards/demo/0002/actions", {
      type: "note",
      note: "x".repeat(200_000),
      revision: "x",
    });
    expect(res.status).toBe(413);
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
    const res = await post("/api/cards/demo/0009/actions", { type: "defer", revision: "x" });
    expect(res.status).toBe(422);
    expect((await json(res)).details[0]).toMatch(/exactly 2 options/);
  });

  it("lets exactly one of two concurrent actions on the same revision win", async () => {
    const { post, request } = await setup();
    const { revision } = await card(request, "0001");
    const notes = ["one", "two", "three", "four", "five"];
    const results = await Promise.all(
      notes.map((note) => post("/api/cards/demo/0001/actions", { type: "note", note, revision })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    const after = await card(request, "0001");
    expect(after.frontmatter.feedback).toHaveLength(2);
  });

  it("serializes concurrent actions that each saw the latest revision", async () => {
    const { act, request } = await setup();
    const results = await Promise.all(
      ["one", "two", "three"].map(async (note) => {
        // Retry on conflict, like a client that reloads and tries again.
        for (;;) {
          const res = await act("0001", { type: "note", note });
          if (res.status !== 409) return res.status;
        }
      }),
    );
    expect(results).toEqual([200, 200, 200]);
    const notes = (await card(request, "0001")).frontmatter.feedback.map((f) => f.note);
    expect(notes.slice(1).sort()).toEqual(["one", "three", "two"]);
  });

  it("keeps the file's permissions and line endings", async () => {
    const { act, demo } = await setup();
    const file = join(demo, "decisions", "0002-api-errors.md");
    await writeFile(file, (await readFile(file, "utf8")).replaceAll("\n", "\r\n"));
    await chmod(file, 0o600);
    expect((await act("0002", { type: "note", note: "Private." })).status).toBe(200);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const text = await readFile(file, "utf8");
    expect(text.replaceAll("\r\n", "")).not.toContain("\n");
    expect(text).toContain("note: Private.\r\n");
  });
});

describe("undo", () => {
  async function resolved() {
    const env = await setup();
    const file = join(env.demo, "decisions", "0002-api-errors.md");
    const original = await readFile(file, "utf8");
    const res = await env.act("0002", { type: "resolve", choice: "result" });
    const { card } = (await res.json()) as { card: CardDetailDto };
    return { ...env, file, original, revision: card.revision };
  }

  it("puts a decided card back as it was, plus an undo entry for agents", async () => {
    const { post, file, original, revision, events } = await resolved();
    events.length = 0;
    const res = await post("/api/cards/demo/0002/undo", { revision });
    expect(res.status).toBe(200);
    const { card } = (await res.json()) as { card: CardDetailDto };
    expect(card.frontmatter.status).toBe("open");
    expect(card.frontmatter.resolution).toBeUndefined();
    expect(card.frontmatter.feedback).toEqual([
      {
        at: expect.any(String),
        type: "undo",
        note: 'Took back the decision "result".',
        previous_resolution: { choice: "result", resolved_at: expect.any(String) },
      },
    ]);
    // An agent that was shown the decision learns it was taken back (R5-10).
    expect(unseenFeedback(card.frontmatter).map((f) => f.type)).toEqual(["undo"]);
    // Nothing else changed: the file is the original plus the feedback lines.
    const after = await readFile(file, "utf8");
    const { removed, added } = diffLines(original, after);
    expect(removed).toEqual([]);
    expect(added.join("\n")).toMatch(
      /^feedback:\n {2}- at: \S+\n {4}type: undo\n {4}note: Took back the decision "result"\.\n {4}previous_resolution:\n {6}choice: result\n {6}resolved_at: \S+$/,
    );
    expect(events).toContainEqual({ type: "cards", project: "demo" });
    // Once is enough: an undo can't be undone.
    expect((await post("/api/cards/demo/0002/undo", { revision })).status).toBe(409);
    const again = await post("/api/cards/demo/0002/undo", { revision: card.revision });
    expect(await again.json()).toMatchObject({ code: "undo_unavailable" });
  });

  it("keeps a decision's note in the undo entry", async () => {
    const { act, post } = await setup();
    const res = await act("0002", { type: "resolve", choice: "result", note: "Keep it short." });
    const { card } = (await res.json()) as { card: CardDetailDto };
    const undone = await json<CardResponse>(
      post("/api/cards/demo/0002/undo", { revision: card.revision }),
    );
    expect(undone.ok && undone.card.frontmatter.feedback.at(-1)).toMatchObject({
      type: "undo",
      note: 'Took back the decision "result" (Keep it short.).',
      previous_resolution: { choice: "result", note: "Keep it short." },
    });
  });

  it("puts the card back byte for byte after a note", async () => {
    const { act, post, demo } = await setup();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const original = await readFile(file, "utf8");
    const res = await act("0002", { type: "note", note: "Too early." });
    const { card } = (await res.json()) as { card: CardDetailDto };
    expect((await post("/api/cards/demo/0002/undo", { revision: card.revision })).status).toBe(200);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("has nothing to undo on a card no action changed", async () => {
    const { post, request } = await setup();
    const current = await json<CardResponse>(request("/api/cards/demo/0001"));
    const revision = current.ok ? current.card.revision : "";
    const res = await post("/api/cards/demo/0001/undo", { revision });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "undo_unavailable" });
  });

  it("refuses when the card changed after the action (an agent applied it)", async () => {
    const { post, act, file, revision, request } = await resolved();
    const shown = await json<CardResponse>(request("/api/cards/demo/0002"));
    if (!shown.ok) throw new Error("broken");
    expect((await act("0002", { type: "applied", token: agentToken(shown.card) })).status).toBe(
      200,
    );
    const res = await post("/api/cards/demo/0002/undo", { revision });
    expect(res.status).toBe(409);
    // Neutral: the change may have been the human's own (R2-12).
    expect(await res.json()).toMatchObject({
      code: "conflict",
      error: expect.stringMatching(/^the card changed after this action, so it can't be undone/),
    });
    expect(await readFile(file, "utf8")).toMatch(/^applied_at: /m);
  });

  it("refuses when an agent wrote the same bytes back after acting on it (R5-10)", async () => {
    const { post, file, revision } = await resolved();
    const decided = await readFile(file, "utf8");
    // The agent applies it (another process: `president applied`), then `git checkout`s its
    // own applied_at edit: the content is the decision's again, but the card was written since.
    await writeFile(
      file,
      decided.replace(/^status: resolved$/m, "$&\napplied_at: 2026-11-10T12:00:00Z"),
    );
    await writeFile(file, decided);
    const res = await post("/api/cards/demo/0002/undo", { revision });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "conflict" });
    expect(await readFile(file, "utf8")).toBe(decided);
  });

  it("words a refused undo for the action it was (R5-8)", async () => {
    const { act, post, demo } = await setup();
    /** Takes the action, lets an agent (another process) change the card, then undoes. */
    const refusal = async (id: string, fileName: string, action: object) => {
      const { card } = (await (await act(id, action)).json()) as { card: CardDetailDto };
      const file = join(demo, "decisions", fileName);
      await writeFile(file, `${await readFile(file, "utf8")}\nAn agent's answer.\n`);
      const res = await post(`/api/cards/demo/${id}/undo`, { revision: card.revision });
      expect(res.status).toBe(409);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await refusal("0002", "0002-api-errors.md", { type: "note", note: "Hm." })).toBe(
      "the card changed since (an agent may already have read your note), so it can't be taken back; add another note to correct it",
    );
    expect(await refusal("0001", "0001-offline-storage.md", { type: "defer" })).toMatch(
      /since you deferred it, so it can't be undone; reopen it if needed$/,
    );
    expect(await refusal("0004", "0004-map-tiles.md", { type: "reopen" })).toMatch(
      /since you reopened it \(an agent may already be acting on it\).*decide it again/,
    );
    expect(
      await refusal("0003", "0003-first-run-copy.md", {
        type: "resolve",
        choice: "custom",
        note: "Hi.",
      }),
    ).toMatch(/after this action, so it can't be undone; review it and reopen it if needed$/);
  });

  it("needs the revision the action returned", async () => {
    const { post, request } = await resolved();
    expect((await post("/api/cards/demo/0002/undo", {})).status).toBe(400);
    const wrong = await post("/api/cards/demo/0002/undo", { revision: "0000000000000000" });
    expect(wrong.status).toBe(409);
    const card = await json<CardResponse>(request("/api/cards/demo/0002"));
    expect(card.ok && card.card.frontmatter.status).toBe("resolved");
  });

  it("restores the state before a reopen, including applied_at", async () => {
    const { act, post, demo } = await setup();
    const file = join(demo, "decisions", "0004-map-tiles.md");
    const original = await readFile(file, "utf8");
    const res = await act("0004", { type: "reopen" });
    const { card } = (await res.json()) as { card: CardDetailDto };
    expect((await post("/api/cards/demo/0004/undo", { revision: card.revision })).status).toBe(200);
    expect(await readFile(file, "utf8")).toBe(original);
  });
});

describe("who wrote a card (R3-6)", () => {
  const detail = async (request: (path: string) => Promise<Response>, since?: string) => {
    const res = await json<CardResponse>(
      request(`/api/cards/demo/0002${since ? `?since=${since}` : ""}`),
    );
    if (!res.ok) throw new Error("broken");
    return res.card;
  };

  it("says president's own writes, from any tab, led to the card a page hasn't seen", async () => {
    const { act, request, post } = await setup();
    const read = await detail(request);
    expect(read.writtenByPresident).toBe(false);
    // Another tab adds a note, then decides and undoes: all the human's own.
    await act("0002", { type: "note", note: "one" });
    const decided = (await (await act("0002", { type: "resolve", choice: "result" })).json()) as {
      card: CardDetailDto;
    };
    await post("/api/cards/demo/0002/undo", { revision: decided.card.revision });
    expect((await detail(request, read.revision)).writtenByPresident).toBe(true);
    expect((await detail(request)).writtenByPresident).toBe(true);
    // Survives a reload: a new page asking with the revision it kept.
    expect((await detail(request, read.revision)).writtenByPresident).toBe(true);
  });

  it("says an agent's change, even when president wrote the card after it", async () => {
    const { act, request, demo } = await setup();
    const read = await detail(request);
    const file = join(demo, "decisions", "0002-api-errors.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "title: Throw typed errors",
        "title: Raise typed errors",
      ),
    );
    const agent = await detail(request, read.revision);
    expect(agent.writtenByPresident).toBe(false);
    // The human, in another tab, read the agent's change and added a note.
    await act("0002", { type: "note", note: "ok" });
    expect((await detail(request, read.revision)).writtenByPresident).toBe(false);
    expect((await detail(request, agent.revision)).writtenByPresident).toBe(true);
  });

  it("says an agent's change that sits between two of president's writes (R4-3)", async () => {
    const { act, request, demo } = await setup();
    const read = await detail(request);
    await act("0002", { type: "note", note: "first" });
    const afterNote = await detail(request);
    const file = join(demo, "decisions", "0002-api-errors.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("title: Throw typed errors", "title: Raise them"),
    );
    const agent = await detail(request);
    await act("0002", { type: "note", note: "second" });
    // Both notes are president's, but the chain from either earlier revision breaks at the
    // agent's edit.
    expect((await detail(request, read.revision)).writtenByPresident).toBe(false);
    expect((await detail(request, afterNote.revision)).writtenByPresident).toBe(false);
    expect((await detail(request, agent.revision)).writtenByPresident).toBe(true);
  });

  it("forgets its writes when the hub restarts, as the README says (R4-4)", async () => {
    const { act, request, registry } = await setup();
    const read = await detail(request);
    await act("0002", { type: "note", note: "before the restart" });
    expect((await detail(request, read.revision)).writtenByPresident).toBe(true);
    const restarted = createApp({ registry, bus: new EventBus(), staticDir: undefined });
    const again = async (path: string) => restarted.request(`http://127.0.0.1:4747${path}`);
    expect((await detail(again, read.revision)).writtenByPresident).toBe(false);
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

  it("only accepts writes from the hub's own origin", async () => {
    const { request } = await setup();
    const write = (headers: Record<string, string>, type = "application/json") =>
      request("/api/projects", {
        method: "POST",
        headers: { "content-type": type, ...headers },
        body: JSON.stringify({ path: 42 }),
      });
    // Reaching validation (400) means the guard let the request through.
    expect((await write({ origin: "https://evil.example" })).status).toBe(403);
    expect((await write({ origin: "http://localhost:3000" })).status).toBe(403);
    expect((await write({ origin: "http://127.0.0.1:5173" })).status).toBe(403);
    expect((await write({ origin: "null" })).status).toBe(403);
    expect((await write({})).status).toBe(403);
    expect((await write({ origin: ORIGIN, "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await write({ origin: ORIGIN }, "text/plain")).status).toBe(415);
    expect((await write({ origin: ORIGIN })).status).toBe(400);
    expect((await write({ "sec-fetch-site": "same-origin" })).status).toBe(400);
    // The Vite dev server proxies with the browser's Host, so its origin matches.
    expect((await write({ host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" })).status).toBe(
      400,
    );
    expect((await request("/api/projects/demo", { method: "DELETE" })).status).toBe(403);
  });
});

describe("unknown API routes", () => {
  it("answer /api/events without a WebSocket handshake with 426", async () => {
    const { request } = await setup();
    const res = await request("/api/events");
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({ error: "/api/events is a WebSocket; connect with one" });
  });

  it("answer 404 JSON", async () => {
    const { request } = await setup();
    const res = await request("/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });
});
