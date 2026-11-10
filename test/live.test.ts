/**
 * The watcher and the running hub. File system events arrive whenever the OS delivers
 * them, so these tests never sleep a fixed time or count events exactly: they wait for a
 * condition (with a generous timeout) and, where a watch may not be attached yet, keep
 * poking the file system until the event shows up.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HubEvent } from "../src/core/api.ts";
import { Registry } from "../src/server/registry.ts";
import { type RunningHub, startHub } from "../src/server/server.ts";
import { Debouncer, EventBus, HubWatcher } from "../src/server/watcher.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/**
 * Resolves once `predicate` matches an item of `items`. `poke` (if given) runs right away
 * and then every 150 ms until then, for changes a watch that is still attaching could miss.
 */
async function until<T>(
  items: T[],
  predicate: (item: T) => boolean,
  poke?: () => Promise<unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastPoke = 0;
  for (;;) {
    const found = items.find(predicate);
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error("timed out waiting for an event");
    if (poke && Date.now() - lastPoke >= 150) {
      lastPoke = Date.now();
      await poke();
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Writes a fresh, valid card with id `n` into `dir`. */
function writeCard(dir: string, n: number): Promise<void> {
  const id = String(n).padStart(4, "0");
  return writeFile(join(dir, `${id}-x.md`), cardText({ id: `"${id}"` }));
}

async function watched() {
  const registry = new Registry(join(await tempDir(), "config"));
  await mkdir(join(registry.file, ".."), { recursive: true });
  const demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const fileEvents: { event: string; path: string }[] = [];
  const watcher = new HubWatcher(registry, bus, {
    debounceMs: 30,
    onFileEvent: (event, path) => fileEvents.push({ event, path }),
  });
  await watcher.start();
  closers.push(() => watcher.close());
  return { registry, demo, events, fileEvents, watcher };
}

describe("Debouncer", () => {
  it("runs only the last call for a key, once the key goes quiet", async () => {
    vi.useFakeTimers();
    try {
      const debouncer = new Debouncer(100);
      const calls: string[] = [];
      debouncer.run("a", () => void calls.push("a1"));
      await vi.advanceTimersByTimeAsync(60);
      debouncer.run("a", () => void calls.push("a2"));
      debouncer.run("b", () => void calls.push("b1"));
      await vi.advanceTimersByTimeAsync(60);
      expect(calls).toEqual([]);
      await vi.advanceTimersByTimeAsync(40);
      expect(calls).toEqual(["a2", "b1"]);
      debouncer.run("a", () => void calls.push("a3"));
      debouncer.cancelAll();
      await vi.advanceTimersByTimeAsync(1000);
      expect(calls).toEqual(["a2", "b1"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("HubWatcher", () => {
  it("reports new and edited cards for their project", async () => {
    const { demo, events } = await watched();
    const dir = join(demo, "decisions");
    await writeFile(join(dir, "0005-new.md"), cardText({ id: '"0005"' }));
    await writeFile(join(dir, "0005-new.md"), cardText({ id: '"0005"', title: "Edited" }));
    await until(events, (e) => e.type === "cards");
    expect(events.every((e) => e.type === "cards" && e.project === "demo")).toBe(true);
  });

  it("ignores everything but the registry, decisions/ and card files", async () => {
    const { demo, registry, watcher } = await watched();
    const dir = join(demo, "decisions");
    expect(watcher.ignores(registry.file)).toBe(false);
    expect(watcher.ignores(join(registry.file, "..", "other.json"))).toBe(true);
    expect(watcher.ignores(demo)).toBe(false);
    expect(watcher.ignores(dir)).toBe(false);
    expect(watcher.ignores(join(demo, "README.md"))).toBe(true);
    expect(watcher.ignores(join(demo, "src"))).toBe(true);
    expect(watcher.ignores(join(dir, "0005-new.md"))).toBe(false);
    for (const name of [".0005.md.123.tmp", "notes.txt", "README.md", "_template.md"]) {
      expect(watcher.ignores(join(dir, name)), name).toBe(true);
    }
  });

  it("raises no events for temp files and non-card files", async () => {
    const { demo, fileEvents } = await watched();
    const dir = join(demo, "decisions");
    const ignored = [
      join(dir, ".0005.md.123.tmp"),
      join(dir, "notes.txt"),
      join(demo, "README.md"),
    ];
    for (const path of ignored) await writeFile(path, "x");
    await mkdir(join(demo, "src"));
    // The OS reports events in order, so once a later card write shows up, the earlier
    // writes have been delivered too (and must have been filtered out).
    const sentinel = join(dir, "0006-sentinel.md");
    await writeFile(sentinel, cardText({ id: '"0006"' }));
    await until(fileEvents, (e) => e.path === sentinel);
    expect(fileEvents.map((e) => e.path)).toEqual([sentinel]);
  });

  it("follows registry changes made by another process", async () => {
    const { registry, events } = await watched();
    const other = await copyDemoProject();
    // A second Registry instance stands in for the CLI.
    await new Registry(join(registry.file, "..")).add({ path: other, name: "other" });
    await until(events, (e) => e.type === "projects");
    let n = 10;
    await until(
      events,
      (e) => e.type === "cards" && e.project === "other",
      () => writeCard(join(other, "decisions"), n++),
    );
  });

  it("keeps reporting changes after decisions/ is deleted and created again", async () => {
    const { demo, events } = await watched();
    const dir = join(demo, "decisions");
    await rm(dir, { recursive: true });
    await until(events, (e) => e.type === "cards");
    await mkdir(dir);
    events.length = 0;
    // The new folder is attached asynchronously; keep writing fresh cards until one is seen.
    let n = 10;
    await until(
      events,
      (e) => e.type === "cards" && e.project === "demo",
      () => writeCard(dir, n++),
    );
  });
});

describe("running hub", () => {
  async function hub(): Promise<{ hub: RunningHub; demo: string }> {
    const registry = new Registry(join(await tempDir(), "config"));
    const demo = await copyDemoProject();
    await registry.add({ path: demo, name: "demo" });
    const running = await startHub({ port: 0, registry, staticDir: join(await tempDir(), "none") });
    closers.push(() => running.close());
    return { hub: running, demo };
  }

  it("binds to 127.0.0.1 and serves the API", async () => {
    const { hub: running } = await hub();
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${running.url}/api/health`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("stops the watcher when the port is taken", async () => {
    const { hub: first } = await hub();
    const registry = new Registry(join(await tempDir(), "config"));
    const close = vi.spyOn(HubWatcher.prototype, "close");
    try {
      const port = Number(new URL(first.url).port);
      await expect(startHub({ port, registry })).rejects.toMatchObject({ code: "EADDRINUSE" });
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      close.mockRestore();
    }
  });

  it("streams card changes over server-sent events", async () => {
    const { hub: running, demo } = await hub();
    const controller = new AbortController();
    closers.push(async () => controller.abort());
    const res = await fetch(`${running.url}/api/events`, { signal: controller.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (needle: string) => {
      while (!received.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        received += decoder.decode(value);
      }
    };
    await readUntil("event: ready");
    const file = join(demo, "decisions", "0002-api-errors.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("priority: normal", "priority: high"),
    );
    await readUntil('data: {"type":"cards","project":"demo"}');
  });
});
