import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HubEvent } from "../src/core/api.ts";
import { Registry } from "../src/server/registry.ts";
import { type RunningHub, startHub } from "../src/server/server.ts";
import { EventBus, HubWatcher } from "../src/server/watcher.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function waitFor<T>(events: T[], predicate: (e: T) => boolean, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const found = events.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out waiting for event"));
      setTimeout(check, 20);
    };
    check();
  });
}

async function watched() {
  const registry = new Registry(join(await tempDir(), "config"));
  await mkdir(join(registry.file, ".."), { recursive: true });
  const demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const watcher = new HubWatcher(registry, bus, { debounceMs: 30 });
  await watcher.start();
  closers.push(() => watcher.close());
  return { registry, demo, events };
}

describe("HubWatcher", () => {
  it("reports new and edited cards, debounced per project", async () => {
    const { demo, events } = await watched();
    const dir = join(demo, "decisions");
    await writeFile(join(dir, "0005-new.md"), cardText({ id: '"0005"' }));
    await writeFile(join(dir, "0005-new.md"), cardText({ id: '"0005"', title: "Edited" }));
    await waitFor(events, (e) => e.type === "cards");
    await new Promise((r) => setTimeout(r, 150));
    expect(events.filter((e) => e.type === "cards")).toEqual([{ type: "cards", project: "demo" }]);
  });

  it("ignores temp files and non-card files", async () => {
    const { demo, events } = await watched();
    await writeFile(join(demo, "decisions", ".0005.md.123.tmp"), "x");
    await writeFile(join(demo, "decisions", "notes.txt"), "x");
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual([]);
  });

  it("follows registry changes made by another process", async () => {
    const { registry, events } = await watched();
    const other = await copyDemoProject();
    // A second Registry instance stands in for the CLI.
    await new Registry(join(registry.file, "..")).add({ path: other, name: "other" });
    await waitFor(events, (e) => e.type === "projects");
    await writeFile(join(other, "decisions", "0006-x.md"), cardText({ id: '"0006"' }));
    await waitFor(events, (e) => e.type === "cards" && e.project === "other");
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

describe("HubWatcher and a recreated decisions folder", () => {
  it("keeps reporting changes after decisions/ is deleted and created again", async () => {
    const { demo, events } = await watched();
    const dir = join(demo, "decisions");
    await rm(dir, { recursive: true });
    await waitFor(events, (e) => e.type === "cards");
    await new Promise((r) => setTimeout(r, 100));
    await mkdir(dir);
    await new Promise((r) => setTimeout(r, 200));
    events.length = 0;
    await writeFile(join(dir, "0007-back.md"), cardText({ id: '"0007"' }));
    await waitFor(events, (e) => e.type === "cards" && e.project === "demo");
  });

  it("ignores other files in the project folder", async () => {
    const { demo, events } = await watched();
    await writeFile(join(demo, "README.md"), "changed");
    await mkdir(join(demo, "src"));
    await new Promise((r) => setTimeout(r, 300));
    expect(events).toEqual([]);
  });
});
