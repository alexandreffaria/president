/**
 * The watcher and the running hub. File system events arrive whenever the OS delivers
 * them, so these tests never sleep a fixed time or count events exactly: they wait for a
 * condition (with a generous timeout) and, where a watch may not be attached yet, keep
 * poking the file system until the event shows up.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClientOptions, WebSocket } from "ws";
import type { HubEvent, LiveMessage } from "../src/core/api.ts";
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
 * The default deadline is under vitest's 5 s test timeout, so a miss says what it waited for.
 */
async function until<T>(
  items: T[],
  predicate: (item: T) => boolean,
  poke?: () => Promise<unknown>,
  timeoutMs = 4_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastPoke = 0;
  for (;;) {
    const found = items.find(predicate);
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for an event matching ${predicate}`);
    }
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

/** A watcher on a registry with the demo project; `setup` can change the registry first. */
/** Keeps writing fresh cards into `dir` until the watcher sees one (a "cards" event can be late). */
async function untilNewCardSeen(
  fileEvents: { event: string; path: string }[],
  dir: string,
): Promise<void> {
  let n = 10;
  await until(
    fileEvents,
    (e) => e.event === "add" && dirname(e.path) === dir && e.path.endsWith("-x.md"),
    () => writeCard(dir, n++),
  );
}

async function watched(setup?: (registry: Registry) => Promise<void>) {
  const registry = new Registry(join(await tempDir(), "config"));
  await mkdir(registry.dir, { recursive: true });
  const demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  await setup?.(registry);
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const fileEvents: { event: string; path: string }[] = [];
  const watcher = new HubWatcher(registry, bus, {
    debounceMs: 30,
    onFileEvent: (event, path) => fileEvents.push({ event, path }),
  });
  closers.push(() => watcher.close());
  await watcher.start();
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
    expect(watcher.ignores(registry.dir)).toBe(false);
    expect(watcher.ignores(join(registry.dir, "other.json"))).toBe(false);
    expect(watcher.ignores(join(registry.dir, ".other.json.123.ab.tmp"))).toBe(true);
    expect(watcher.ignores(join(registry.dir, "notes.txt"))).toBe(true);
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
    await new Registry(join(registry.dir, "..")).add({ path: other, name: "other" });
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

  /** Registers projects in one folder, then removes their folders (or only decisions/). */
  function missing(names: string[], only?: "decisions") {
    const paths = new Map<string, string>();
    const setup = async (registry: Registry) => {
      const parent = await tempDir();
      for (const name of names) {
        const path = join(parent, name);
        await mkdir(join(path, "decisions"), { recursive: true });
        await registry.add({ path, name });
        await rm(only ? join(path, "decisions") : path, { recursive: true });
        paths.set(name, path);
      }
    };
    return { paths, setup };
  }

  it("is watching the projects once start() resolves, with folders missing (R11-1)", async () => {
    // chokidar counts each missing path twice toward its one ready event.
    const gone = missing(["gone1", "gone2"]);
    const bare = missing(["bare1", "bare2"], "decisions");
    const { demo, events } = await watched(async (registry) => {
      await gone.setup(registry);
      await bare.setup(registry);
    });
    // No poke: a card written right after start() must be seen.
    await writeCard(join(demo, "decisions"), 5);
    await until(events, (e) => e.type === "cards" && e.project === "demo");
  });

  it("watches projects whose folders were missing at start once they come back (R11-2)", async () => {
    // Two, in one folder: chokidar's waits for two missing paths in one folder clash.
    const { paths, setup } = missing(["ghost1", "ghost2"]);
    const { events, fileEvents } = await watched(setup);
    for (const [name, path] of paths) {
      await mkdir(join(path, "decisions"), { recursive: true });
      await until(events, (e) => e.type === "cards" && e.project === name);
      await untilNewCardSeen(fileEvents, join(path, "decisions"));
    }
  });

  it("keeps reporting changes after a project's folder is deleted and created again", async () => {
    const { demo, fileEvents } = await watched();
    await rm(demo, { recursive: true });
    // Once the watcher has seen the folder go: one made again before that looks unchanged to it.
    await until(fileEvents, (e) => e.event === "unlinkDir" && e.path === demo);
    await mkdir(join(demo, "decisions"), { recursive: true });
    // Late events of the deletion also raise "cards", so wait for a new card to be seen.
    await untilNewCardSeen(fileEvents, join(demo, "decisions"));
  });
});

describe("running hub", () => {
  async function hub(options: { heartbeatMs?: number } = {}) {
    const registry = new Registry(join(await tempDir(), "config"));
    const demo = await copyDemoProject();
    await registry.add({ path: demo, name: "demo" });
    const running = await startHub({
      port: 0,
      registry,
      staticDir: join(await tempDir(), "none"),
      ...options,
    });
    closers.push(() => running.close());
    return { hub: running, demo };
  }

  /** A WebSocket to the hub's live events, with the messages it has received. */
  async function socket(
    running: RunningHub,
    options: ClientOptions = { origin: running.url },
  ): Promise<{ ws: WebSocket; messages: LiveMessage[]; closed: Promise<void> }> {
    const ws = new WebSocket(`${running.url.replace("http", "ws")}/api/events`, options);
    const messages: LiveMessage[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(String(data))));
    const closed = new Promise<void>((done) => ws.on("close", () => done()));
    closers.push(async () => ws.terminate());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    await until(messages, (m) => m.type === "ready");
    return { ws, messages, closed };
  }

  /** The HTTP status a refused handshake got. */
  function refusedWith(running: RunningHub, options: ClientOptions): Promise<number> {
    const ws = new WebSocket(`${running.url.replace("http", "ws")}/api/events`, options);
    ws.on("error", () => {});
    return new Promise((resolve, reject) => {
      ws.once("unexpected-response", (request, response) => {
        resolve(response.statusCode ?? 0);
        request.destroy();
      });
      ws.once("open", () => reject(new Error("the handshake was accepted")));
    });
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

  it("sends card changes over a WebSocket", async () => {
    const { hub: running, demo } = await hub();
    const { messages } = await socket(running);
    expect(messages).toEqual([{ type: "ready" }]);
    const file = join(demo, "decisions", "0002-api-errors.md");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace("priority: normal", "priority: high"),
    );
    await until(messages, (m) => m.type === "cards" && m.project === "demo");
  });

  it("keeps the API answering with more sockets open than browsers allow requests (R4-1)", async () => {
    const { hub: running } = await hub();
    const sockets = await Promise.all(Array.from({ length: 10 }, () => socket(running)));
    const res = await fetch(`${running.url}/api/cards`);
    expect(res.status).toBe(200);
    const removed = await fetch(`${running.url}/api/projects/demo`, {
      method: "DELETE",
      headers: { origin: running.url },
    });
    expect(removed.status).toBe(200);
    for (const { messages } of sockets) await until(messages, (m) => m.type === "projects");
  });

  it("refuses WebSockets from other origins and hosts (hijacking, DNS rebinding)", async () => {
    const { hub: running } = await hub();
    expect(await refusedWith(running, { origin: "https://evil.example" })).toBe(403);
    expect(await refusedWith(running, { origin: "http://localhost:3000" })).toBe(403);
    expect(await refusedWith(running, {})).toBe(403);
    expect(
      await refusedWith(running, {
        origin: running.url,
        headers: { "sec-fetch-site": "cross-site" },
      }),
    ).toBe(403);
    const port = new URL(running.url).port;
    expect(
      await refusedWith(running, {
        origin: `http://evil.example:${port}`,
        headers: { host: `evil.example:${port}` },
      }),
    ).toBe(403);
    // And the hub's own origin is let in.
    await socket(running);
  });

  it("drops a socket that stops answering pings, and keeps the ones that answer", async () => {
    const { hub: running } = await hub({ heartbeatMs: 30 });
    const silent = await socket(running, { origin: running.url, autoPong: false });
    const answering = await socket(running);
    await silent.closed;
    expect(answering.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("sends a ping message with each heartbeat, so a page can tell the hub hangs (R5-5)", async () => {
    // One ping message is enough: a heartbeat sends it to every socket that answered the last
    // ping, and a new socket counts as having answered. Waiting for more would also depend on
    // the pong arriving within one (short) heartbeat, which a busy machine may not manage.
    const { hub: running } = await hub({ heartbeatMs: 100 });
    const { messages } = await socket(running);
    await until(messages, (m) => m.type === "ping");
    expect(messages[0]).toEqual({ type: "ready" });
  });

  /** A raw TCP connection that sent the request head `lines`, and what came back. */
  async function rawRequest(running: RunningHub, lines: string[]) {
    const { port } = new URL(running.url);
    // allowHalfOpen: the client doesn't hang up when the hub ends its side.
    const sock: Socket = connect({ port: Number(port), host: "127.0.0.1", allowHalfOpen: true });
    sock.on("error", () => {});
    closers.push(async () => void sock.destroy());
    let received = "";
    sock.on("data", (data) => {
      received += String(data);
    });
    await new Promise<void>((done) => sock.once("connect", () => done()));
    sock.write(`${[...lines, `Host: 127.0.0.1:${port}`].join("\r\n")}\r\n\r\n`);
    return { received: () => received };
  }

  const h2c = [
    "GET /api/health HTTP/1.1",
    "Connection: Upgrade, HTTP2-Settings",
    "Upgrade: h2c",
    "HTTP2-Settings: AAMAAABkAAQAAQAAAAIAAAAA",
  ];

  it("answers a request that asks for another upgrade (curl --http2) as a plain one (R5-1)", async () => {
    const { hub: running } = await hub();
    const { received } = await rawRequest(running, h2c);
    await until([0], () => received().includes('{"ok":true}'), undefined, 5000);
    expect(received()).toMatch(/^HTTP\/1\.1 200 /);
  });

  it("stops promptly while upgrade requests are open (R5-1)", async () => {
    const { hub: running } = await hub();
    const other = await rawRequest(running, h2c);
    // A refused WebSocket handshake from a client that never hangs up: the hub ends its
    // side, but the socket stays open (half-closed) until it is destroyed.
    const refused = await rawRequest(running, [
      "GET /api/events HTTP/1.1",
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Origin: https://evil.example",
    ]);
    await until([0], () => refused.received().includes(" 403 "), undefined, 5000);
    await until([0], () => other.received().includes("200 OK"), undefined, 5000);
    const started = Date.now();
    await running.close();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("closes its sockets when it stops", async () => {
    const { hub: running } = await hub();
    const { closed } = await socket(running);
    await running.close();
    await closed;
  });
});
