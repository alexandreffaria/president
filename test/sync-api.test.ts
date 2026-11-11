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
import { Registry } from "../src/server/registry.ts";
import { startHub } from "../src/server/server.ts";
import { SyncService } from "../src/server/sync.ts";
import { EventBus } from "../src/server/watcher.ts";
import { gitSandbox, type Sandbox } from "./git-sandbox.ts";
import { DEMO_PROJECT, tempDir } from "./helpers.ts";

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

async function until(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the Sync API", () => {
  it("counts answers not synced, syncs, and keeps the result for every tab", async () => {
    const s = await cardsSandbox();
    const { status, post, act, events } = await setup(s);
    expect((await status()).projects).toEqual([
      { project: "shop", unsynced: 0, remoteChanges: 0, running: false },
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
    await until(async () => (await status()).running, "the Sync to start");
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
      await until(
        async () => (await status()).projects.some((p) => p.fetchError),
        "the fetch to finish",
      );
      const projects = (await status()).projects;
      expect(projects.find((p) => p.project === "shop")).toEqual({
        project: "shop",
        unsynced: 0,
        remoteChanges: 1,
        running: false,
      });
      expect(projects.find((p) => p.project === "offline")?.fetchError).toMatch(/gone\.git/);
      // The fetch changed no file and no branch.
      expect({ head: s.head(s.laptop), status: s.status(s.laptop) }).toEqual(before);
    } finally {
      await hub.close();
    }
  });
});
