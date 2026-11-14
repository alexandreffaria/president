/**
 * Sync through the hub: the /api/sync endpoints (with the hub's Host and Origin checks),
 * one Sync per project at a time, card actions refused while a project's Sync runs, and
 * the fetch at hub start. On scratch repositories only (git-sandbox.ts).
 */
import { chmod, cp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  CardResponse,
  HubEvent,
  SyncRunResponse,
  SyncStatusResponse,
} from "../src/core/api.ts";
import { createApp } from "../src/server/app.ts";
import { revisionOf } from "../src/server/cards.ts";
import { Registry } from "../src/server/registry.ts";
import { startHub } from "../src/server/server.ts";
import { SyncService } from "../src/server/sync.ts";
import { EventBus } from "../src/server/watcher.ts";
import { gitSandbox, type Sandbox } from "./git-sandbox.ts";
import { DEMO_PROJECT, tempDir, until } from "./helpers.ts";

// Each test runs a few dozen git commands; with several suites at once on a busy machine that
// can take a while.
vi.setConfig({ testTimeout: 90_000 });

const ORIGIN = "http://127.0.0.1:4747";

/** A sandbox whose laptop holds the demo cards (real cards the API can act on). */
async function cardsSandbox(): Promise<Sandbox> {
  const s = await gitSandbox();
  await rm(join(s.laptop, "decisions"), { recursive: true });
  await cp(join(DEMO_PROJECT, "decisions"), join(s.laptop, "decisions"), { recursive: true });
  s.push(s.laptop, "demo cards");
  s.git(s.desktop, "pull", "--quiet");
  return s;
}

async function setup(s: Sandbox) {
  const registry = new Registry(join(await tempDir(), "config"));
  await registry.add({ path: s.laptop, name: "shop" });
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const sync = new SyncService(registry, bus, s.options);
  const app = createApp({ registry, bus, sync, staticDir: undefined });
  const request = (path: string, init: RequestInit = {}) =>
    Promise.resolve(app.request(`${ORIGIN}${path}`, init));
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    });
  const status = async () => (await (await request("/api/sync")).json()) as SyncStatusResponse;
  const act = async (id: string, body: object) => {
    const card = (await (await request(`/api/cards/shop/${id}`)).json()) as CardResponse;
    if (!card.ok) throw new Error("broken card");
    return post(`/api/cards/shop/${id}/actions`, { revision: card.card.revision, ...body });
  };
  return { registry, bus, events, sync, request, post, status, act };
}

/** A pre-commit hook that holds Sync's commit until `release()`. */
async function holdTheCommit(s: Sandbox): Promise<() => Promise<void>> {
  const hooks = join(s.root, "hooks");
  const go = join(s.root, "go");
  await s.write(
    s.root,
    "hooks/pre-commit",
    `#!/bin/sh\ni=0\nwhile [ ! -e "${go}" ] && [ $i -lt 400 ]; do sleep 0.05; i=$((i+1)); done\n`,
  );
  await chmod(join(hooks, "pre-commit"), 0o755);
  s.git(s.laptop, "config", "core.hooksPath", hooks);
  return () => writeFile(go, "");
}

/** How long a wait on git work gets: it's slow on a busy machine. */
const GIT_WAIT = { timeoutMs: 30_000, everyMs: 25 };

describe("the Sync API", () => {
  it("counts answers not synced, syncs, and keeps the result for every tab", async () => {
    const s = await cardsSandbox();
    const { status, post, act, events } = await setup(s);
    expect((await status()).projects).toEqual([
      { project: "shop", unsynced: 0, remoteChanges: 0, fetchRetrying: false, running: false },
    ]);

    expect((await act("0001", { type: "resolve", choice: "dexie" })).status).toBe(200);
    expect((await act("0002", { type: "defer" })).status).toBe(200);
    expect((await status()).projects[0]).toMatchObject({ unsynced: 2 });

    const response = await post("/api/sync", {});
    expect(response.status).toBe(200);
    const { results } = (await response.json()) as SyncRunResponse;
    expect(results).toEqual([
      expect.objectContaining({
        project: "shop",
        outcome: "synced",
        message: "Synced: sent 0001, 0002",
      }),
    ]);
    expect(s.remoteLog()[0]).toBe("decisions from laptop: 0001, 0002");
    const after = (await status()).projects[0];
    expect(after).toMatchObject({ unsynced: 0, running: false, last: { outcome: "synced" } });
    expect(events).toContainEqual({ type: "sync" });
    expect(events).toContainEqual({ type: "cards", project: "shop" });
  });

  it("reports a skipped project's answers apart from the ones Sync moves (B2)", async () => {
    const s = await gitSandbox();
    const web = join(s.laptop, "web");
    await s.write(web, "decisions/0001-a.md", "status: open\n");
    const { registry, status } = await setup(s);
    await registry.add({ path: web, name: "web" });
    expect((await status()).projects).toEqual([
      { project: "shop", unsynced: 0, remoteChanges: 0, fetchRetrying: false, running: false },
      {
        project: "web",
        unavailable: "it isn't the top folder of a git repository",
        unsynced: 0,
        skippedUnsynced: 1,
        remoteChanges: 0,
        fetchRetrying: false,
        running: false,
      },
    ]);
  });

  it("applies the hub's Host and Origin checks", async () => {
    const s = await cardsSandbox();
    const { request } = await setup(s);
    const noOrigin = await request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(noOrigin.status).toBe(403);
    const otherSite = await request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: "{}",
    });
    expect(otherSite.status).toBe(403);
    const form = await request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: "a=1",
    });
    expect(form.status).toBe(415);
    const rebound = await request("/api/sync", { headers: { host: "evil.example" } });
    expect(rebound.status).toBe(403);
    // Nothing ran.
    expect(s.remoteLog()).toEqual(["demo cards", "init"]);
  });

  it("refuses card actions in a project while its Sync runs", async () => {
    const s = await cardsSandbox();
    const { status, post, act } = await setup(s);
    expect((await act("0001", { type: "resolve", choice: "dexie" })).status).toBe(200);
    const release = await holdTheCommit(s);

    const syncing = post("/api/sync", {});
    await until(async () => (await status()).running, "the Sync to start", GIT_WAIT);
    const refused = await act("0002", { type: "defer" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      code: "syncing",
      error: "Sync is running in shop, so nothing was changed; try again when it finishes.",
    });

    await release();
    const { results } = (await (await syncing).json()) as SyncRunResponse;
    expect(results[0]).toMatchObject({ outcome: "synced", sent: ["0001"] });
    expect((await act("0002", { type: "defer" })).status).toBe(200);
  });

  it("waits for a card write in progress before it starts", async () => {
    const s = await cardsSandbox();
    const { registry, sync } = await setup(s);
    const project = (await registry.get("shop")) ?? expect.fail("no project");
    let finishWrite = () => {};
    const write = sync.writeCard(
      project,
      () =>
        new Promise<void>((done) => {
          finishWrite = done;
        }),
    );
    await s.write(s.laptop, "decisions/0001-offline-storage.md", "changed\n");
    const before = s.head(s.laptop);

    const syncing = sync.sync();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(s.head(s.laptop)).toBe(before); // still waiting for the write
    // New writes are refused from the moment Sync is waiting.
    await expect(sync.writeCard(project, async () => {})).rejects.toMatchObject({
      code: "syncing",
    });

    finishWrite();
    await write;
    const { results } = await syncing;
    expect(results[0]).toMatchObject({ outcome: "synced", sent: ["0001"] });
  });

  it("runs one Sync per project at a time", async () => {
    const s = await cardsSandbox();
    const { post, act } = await setup(s);
    expect((await act("0001", { type: "resolve", choice: "dexie" })).status).toBe(200);

    const [first, second] = await Promise.all([post("/api/sync", {}), post("/api/sync", {})]);

    const outcomes = [
      ((await first.json()) as SyncRunResponse).results[0]?.outcome,
      ((await second.json()) as SyncRunResponse).results[0]?.outcome,
    ];
    expect(outcomes.sort()).toEqual(["nothing", "synced"]);
    expect(s.remoteLog()).toEqual(["decisions from laptop: 0001", "demo cards", "init"]);
  });
});

describe("cards a Sync brought in (card 20261112xp4s, from-sync)", () => {
  it("marks the revision the pull brought in, before the cards event, and nothing else", async () => {
    const s = await cardsSandbox();
    const file = "decisions/0003-first-run-copy.md";
    const original = await s.read(s.desktop, file);
    const changed = original.replace(
      "title: What should the app say the first time someone opens it?",
      "title: What should the app say on first run?",
    );
    expect(changed).not.toBe(original);
    await s.write(s.desktop, file, changed);
    s.push(s.desktop, "desktop edits a card");

    const { registry, bus, sync, request } = await setup(s);
    const [project] = await registry.list();
    if (!project) throw new Error("no project");
    const detail = async (id: string, since?: string) => {
      const res = (await (
        await request(`/api/cards/shop/${id}${since ? `?since=${since}` : ""}`)
      ).json()) as CardResponse;
      if (!res.ok) throw new Error("broken card");
      return res.card;
    };
    const before = await detail("0003");
    expect(before.changedBySync).toBe(false);
    // What the Sync knows when it tells open card views to reload.
    const atCardsEvent: boolean[] = [];
    bus.subscribe((event) => {
      if (event.type === "cards") {
        atCardsEvent.push(sync.broughtIn(project, join(s.laptop, file), revisionOf(changed)));
      }
    });

    expect((await sync.sync()).results[0]).toMatchObject({ outcome: "synced", received: ["0003"] });

    expect(atCardsEvent).toEqual([true]);
    const after = await detail("0003", before.revision);
    expect(after.revision).toBe(revisionOf(changed));
    expect(after).toMatchObject({ changedBySync: true, writtenByPresident: false });
    expect((await detail("0001")).changedBySync).toBe(false);

    // An agent here changes the card afterwards: that is no longer what Sync brought in.
    await s.write(s.laptop, file, `${changed}\nMore from an agent.\n`);
    expect((await detail("0003", after.revision)).changedBySync).toBe(false);
  });
});

describe("the hub at start", () => {
  it("only fetches, then shows the card changes on the remote and fetch failures", async () => {
    const s = await cardsSandbox();
    await s.write(s.desktop, "decisions/0003-first-run-copy.md", "changed on the desktop\n");
    await s.write(s.desktop, "app.js", "x = desktop\n");
    s.push(s.desktop, "desktop");
    await s.write(s.laptop, "lib.js", "y = wip\n");
    const before = { head: s.head(s.laptop), status: s.status(s.laptop) };

    const broken = await gitSandbox();
    broken.git(broken.laptop, "remote", "set-url", "origin", join(broken.root, "gone.git"));

    const registry = new Registry(join(await tempDir(), "config"));
    await registry.add({ path: s.laptop, name: "shop" });
    await registry.add({ path: broken.laptop, name: "offline" });
    const hub = await startHub({
      port: 0,
      registry,
      staticDir: join(await tempDir(), "none"),
      sync: s.options,
    });
    try {
      const status = async () =>
        (await (await fetch(`${hub.url}/api/sync`)).json()) as SyncStatusResponse;
      // Each project's fetch ends on its own: wait for both, not for whichever ends first.
      await until(
        async () => {
          const projects = (await status()).projects;
          return (
            !!projects.find((p) => p.project === "offline")?.fetchError &&
            projects.find((p) => p.project === "shop")?.remoteChanges === 1
          );
        },
        "both fetches to finish",
        GIT_WAIT,
      );
      const projects = (await status()).projects;
      expect(projects.find((p) => p.project === "shop")).toEqual({
        project: "shop",
        unsynced: 0,
        remoteChanges: 1,
        fetchRetrying: false,
        running: false,
      });
      expect(projects.find((p) => p.project === "offline")?.fetchError).toMatch(/gone\.git/);
      // The fetch changed no file and no branch.
      expect({ head: s.head(s.laptop), status: s.status(s.laptop) }).toEqual(before);
    } finally {
      await hub.close();
    }
  });

  /** A project whose remote is out of reach, and a SyncService that retries after `waits`. */
  async function unreachable(waits: number[]) {
    const s = await gitSandbox();
    s.git(s.laptop, "remote", "set-url", "origin", join(s.root, "gone.git"));
    const registry = new Registry(join(await tempDir(), "config"));
    await registry.add({ path: s.laptop, name: "shop" });
    const bus = new EventBus();
    const events: HubEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const sync = new SyncService(registry, bus, { ...s.options, fetchRetryMs: waits });
    const shop = async () => (await sync.status()).projects[0];
    await sync.fetchAll();
    expect(await shop()).toMatchObject({ fetchError: expect.stringMatching(/gone\.git/) });
    const reachable = () => s.git(s.laptop, "remote", "set-url", "origin", "../remote.git");
    return { s, registry, sync, events, shop, reachable };
  }

  /** Long enough for several retries 100 ms apart (each a fetch from a missing folder). */
  const severalRetries = () => new Promise((resolve) => setTimeout(resolve, 500));

  it("retries a failed fetch until it works, then clears the error", async () => {
    // More retries than the test could ever use up.
    const { sync, events, shop, reachable } = await unreachable(Array(50).fill(100));
    try {
      // The warning stays while the hub retries.
      expect(await shop()).toMatchObject({ fetchError: expect.any(String), fetchRetrying: true });
      events.length = 0;
      reachable();
      await until(
        async () => (await shop())?.fetchError === undefined,
        "a retry to fetch",
        GIT_WAIT,
      );
      expect((await shop())?.fetchRetrying).toBe(false);
      expect(events).toContainEqual({ type: "sync" });
    } finally {
      await sync.close();
    }
  });

  it("keeps the error once the retries run out", async () => {
    const { sync, shop } = await unreachable([50, 50]);
    try {
      await until(
        async () => (await shop())?.fetchRetrying === false,
        "the retries to end",
        GIT_WAIT,
      );
      expect((await shop())?.fetchError).toMatch(/gone\.git/);
    } finally {
      await sync.close();
    }
  });

  it("stops retrying once a Sync ran in the project", async () => {
    const { sync, shop } = await unreachable([100, 100, 100, 100, 100]);
    try {
      expect((await sync.sync()).results[0]?.outcome).not.toBe("synced");
      expect(await shop()).toMatchObject({ fetchRetrying: false });
      expect((await shop())?.fetchError).toBeUndefined();
      // A retry would fail again and bring the error back.
      await severalRetries();
      expect((await shop())?.fetchError).toBeUndefined();
    } finally {
      await sync.close();
    }
  });

  it("keeps retrying after a Sync that stopped before it fetched", async () => {
    const { s, sync, shop, reachable } = await unreachable(Array(50).fill(100));
    try {
      s.git(s.laptop, "checkout", "--quiet", "--detach");
      await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
      const { results } = await sync.sync();
      expect(results[0]).toMatchObject({ outcome: "not-now" });
      expect(results[0]?.message).toMatch(/detached HEAD/);
      // Nothing was fetched: the warning stays, and so do the retries.
      expect(await shop()).toMatchObject({
        fetchError: expect.stringMatching(/gone\.git/),
        fetchRetrying: true,
      });
      reachable();
      await until(
        async () => (await shop())?.fetchError === undefined,
        "a retry to fetch",
        GIT_WAIT,
      );
    } finally {
      await sync.close();
    }
  });

  it("stops retrying for a project that was removed", async () => {
    const { s, registry, sync, events, shop, reachable } = await unreachable(Array(50).fill(100));
    // Counts the registry reads that started once the project was gone.
    const list = registry.list.bind(registry);
    let removed = false;
    let readsSinceRemoved = 0;
    vi.spyOn(registry, "list").mockImplementation(async () => {
      const after = removed;
      const projects = await list();
      if (after) readsSinceRemoved++;
      return projects;
    });
    try {
      await registry.remove("shop");
      removed = true;
      // A retry that read the registry before the removal finishes first (the lock), then
      // the next one reads it and stops.
      await until(async () => readsSinceRemoved > 0, "a retry to read the registry", GIT_WAIT);
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.length = 0;
      // Were it still retried, this fetch would work and say so.
      reachable();
      await severalRetries();
      expect(events).toEqual([]);
      // The retry noticed the removal and dropped the project: added again, it starts with
      // no error and no retry.
      await registry.add({ path: s.laptop, name: "shop" });
      expect(await shop()).toMatchObject({ fetchRetrying: false });
      expect((await shop())?.fetchError).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
      await sync.close();
    }
  });

  it("cancels the waiting retries on close", async () => {
    const { sync, shop, reachable } = await unreachable([100, 100, 100]);
    await sync.close();
    reachable();
    // A retry would now work and clear the error.
    await severalRetries();
    expect((await shop())?.fetchError).toMatch(/gone\.git/);
  });

  it("shows a rebase a Sync cut short left behind, with the files it set aside (S-8)", async () => {
    const s = await gitSandbox();
    await s.write(s.desktop, "decisions/0001-colour.md", "status: resolved\nnote: desktop\n");
    s.push(s.desktop, "desktop");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\nnote: laptop\n");
    await s.write(s.laptop, "lib.js", "y = wip\n");
    // Sync's commit, then its pull stopped on the card's conflict when the hub went away.
    s.git(s.laptop, "commit", "--quiet", "-m", "decisions from laptop: 0001", "--", "decisions/");
    expect(() => s.git(s.laptop, "pull", "--quiet", "--rebase", "--autostash")).toThrow();

    const registry = new Registry(join(await tempDir(), "config"));
    await registry.add({ path: s.laptop, name: "shop" });
    const hub = await startHub({
      port: 0,
      registry,
      staticDir: join(await tempDir(), "none"),
      sync: s.options,
    });
    try {
      const status = (await (await fetch(`${hub.url}/api/sync`)).json()) as SyncStatusResponse;
      const shop = status.projects.find((p) => p.project === "shop");
      expect(shop?.rebase?.message).toBe(
        "A rebase is in progress in shop, and Sync waits until it is finished or aborted",
      );
      expect(shop?.rebase?.action).toMatch(/uncommitted changes to lib\.js/);
      expect(shop?.rebase?.action).toContain(`git rebase --abort in ${s.laptop}`);
    } finally {
      await hub.close();
    }
  });
});
