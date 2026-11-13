/**
 * The watcher and the running hub. File system events arrive whenever the OS delivers
 * them, so these tests never sleep a fixed time or count events exactly: they wait for a
 * condition (with a generous timeout) and, where a watch may not be attached yet, keep
 * poking the file system until the event shows up.
 */
import type { Stats } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { FSWatcher } from "chokidar";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClientOptions, WebSocket } from "ws";
import type { HubEvent, LiveMessage } from "../src/core/api.ts";
import { Registry } from "../src/server/registry.ts";
import { type RunningHub, startHub } from "../src/server/server.ts";
import { Debouncer, EventBus, HubWatcher, identity } from "../src/server/watcher.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

/** Stats of `paths` wait for `until`; `held` and `released` count those calls. */
interface Hold {
  paths: Set<string>;
  until: Promise<void>;
  held: number;
  released: number;
}

/**
 * `stat` as the watcher's poll sees it (chokidar's own calls aren't affected). By default it
 * is the real one. A test can make some folders look as a filesystem without birth times
 * that reuses inodes shows them (`sameInode`), report the ctime as the birth time as Node
 * does without statx (`birthIsCtime`), or hold calls for some paths (`hold`). Each test
 * uses its own folders, so a look still running from an earlier test changes nothing here.
 */
const statMock = vi.hoisted(() => ({
  sameInode: new Set<string>(),
  birthIsCtime: false,
  hold: undefined as Hold | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const stat = async (path: string, ...rest: unknown[]): Promise<Stats> => {
    const hold = statMock.hold?.paths.has(path) ? statMock.hold : undefined;
    if (hold) {
      hold.held += 1;
      await hold.until;
    }
    try {
      const real = (await fs.stat(path, ...(rest as []))) as Stats;
      const changes = {
        ...(statMock.birthIsCtime ? { birthtimeMs: real.ctimeMs } : {}),
        ...(statMock.sameInode.has(path) ? { ino: 1, birthtimeMs: 0 } : {}),
      };
      return Object.assign(Object.create(Object.getPrototypeOf(real)), real, changes);
    } finally {
      if (hold) hold.released += 1;
    }
  };
  return { ...fs, stat, default: { ...fs, stat } };
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  statMock.sameInode.clear();
  statMock.birthIsCtime = false;
  statMock.hold = undefined;
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

/** What a watcher did, in order: file events it acted on and events it emitted. */
type Log = ({ event: string; path: string } | HubEvent)[];

/**
 * Keeps writing fresh cards into project `name`'s `dir` until the watcher sees one and then
 * reports the project's cards. A "cards" event alone can come from older changes. Each card
 * is also written into the folders `also`.
 */
async function untilNewCardSeen(log: Log, name: string, dir: string, also: string[] = []) {
  let n = 10;
  const seen = () => {
    const added = log.findIndex(
      (e) =>
        "event" in e && e.event === "add" && dirname(e.path) === dir && e.path.endsWith("-x.md"),
    );
    return (
      added >= 0 &&
      log.slice(added).some((e) => "type" in e && e.type === "cards" && e.project === name)
    );
  };
  const poke = () => {
    const id = n++;
    return Promise.all([dir, ...also].map((to) => writeCard(to, id)));
  };
  await until([0], seen, poke);
}

/** A watcher on a registry with the demo project; `setup` can change the registry first. */
async function watched(setup?: (registry: Registry) => Promise<void>) {
  const registry = new Registry(join(await tempDir(), "config"));
  await mkdir(registry.dir, { recursive: true });
  const demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  await setup?.(registry);
  const bus = new EventBus();
  const events: HubEvent[] = [];
  const log: Log = [];
  bus.subscribe((e) => {
    events.push(e);
    log.push(e);
  });
  const fileEvents: { event: string; path: string }[] = [];
  const watcher = new HubWatcher(registry, bus, {
    debounceMs: 30,
    pollMs: 100,
    onFileEvent: (event, path) => {
      fileEvents.push({ event, path });
      log.push({ event, path });
    },
  });
  closers.push(() => watcher.close());
  await watcher.start();
  return { registry, demo, events, fileEvents, log, watcher };
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
    expect(watcher.ignores(dir)).toBe(false);
    expect(watcher.ignores(demo)).toBe(true);
    expect(watcher.ignores(dirname(demo))).toBe(true);
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

  // Twice: every time, not only the first, the old watch must be dropped (P2b-3).
  it("keeps reporting changes after decisions/ is deleted and created again, twice", async () => {
    const { demo, log } = await watched();
    const dir = join(demo, "decisions");
    for (let round = 0; round < 2; round++) {
      log.splice(0);
      await rm(dir, { recursive: true });
      // At once: the watcher may not have seen the old folder go.
      await mkdir(dir);
      await untilNewCardSeen(log, "demo", dir);
    }
  });

  // Moved away, the old folder still exists and its watch still works, on it: the folder made
  // in its place must be watched instead. Without the inode fake below, so that it runs on
  // Windows too, where the poll is what sees the new folder (by its file ID).
  it("keeps reporting changes after decisions/ is moved away and made again, twice", async () => {
    const { demo, log } = await watched();
    const dir = join(demo, "decisions");
    for (let round = 0; round < 2; round++) {
      log.splice(0);
      await rename(dir, `${dir}-${round}`);
      await mkdir(dir);
      await untilNewCardSeen(log, "demo", dir);
    }
  });

  // Where the folder made again gets the old inode and there is no birth time (ext4 with
  // small inodes, most FUSE filesystems), only the old watch's raw event tells (P2b-1).
  // Two signals tell: the folder's raw `rename`, and chokidar's unlinkDir when it notices
  // first (from the cards' events) and drops the watch, so that the raw event never comes.
  // Which of the two comes first is up to timing, so the second case makes the second
  // order happen: no raw events, and the unlinkDir chokidar then sends. Moved away, the old
  // folder still exists and its watch still works, on it: only a watch dropped first and
  // made again watches the new folder.
  const deleted = (dir: string) => rm(dir, { recursive: true });
  const removals: [string, (dir: string) => Promise<void>, boolean][] = [
    ["deleted", deleted, false],
    ["deleted (chokidar's unlinkDir alone telling)", deleted, true],
  ];
  // Not on Windows: there a watched folder moved away raises no event, and the poll is what
  // sees the folder made in its place, by its new file ID (NTFS doesn't reuse one at once,
  // unlike ext4's inodes, which this case fakes).
  if (process.platform !== "win32") {
    removals.push(["moved away", (dir) => rename(dir, `${dir}-${Math.random()}`), false]);
  }
  it.each(removals)(
    "keeps reporting changes after decisions/ is %s and made again with the same inode, twice",
    async (_, remove, unlinkDirOnly) => {
      let chokidar: FSWatcher | undefined;
      if (unlinkDirOnly) {
        const emit = FSWatcher.prototype.emit as (this: FSWatcher, ...args: unknown[]) => boolean;
        const spy = vi.spyOn(FSWatcher.prototype, "emit");
        spy.mockImplementation(function (this: FSWatcher, ...args: unknown[]) {
          chokidar = this;
          return args[0] === "raw" ? false : emit.apply(this, args);
        } as FSWatcher["emit"]);
        closers.push(async () => spy.mockRestore());
      }
      const { demo, log } = await watched(async (registry) => {
        const [project] = await registry.list();
        statMock.sameInode.add(project?.path ?? "");
        statMock.sameInode.add(join(project?.path ?? "", "decisions"));
      });
      const dir = join(demo, "decisions");
      expect(statMock.sameInode.has(dir)).toBe(true);
      for (let round = 0; round < 2; round++) {
        log.splice(0);
        await remove(dir);
        chokidar?.emit("all", "unlinkDir", dir);
        await mkdir(dir);
        await untilNewCardSeen(log, "demo", dir);
      }
    },
  );

  // Without statx, Node gives the ctime as the birth time; a card write changes it, and must
  // not make the poll take the folder for a new one (P2b-1).
  it("tells folders apart by something card writes don't change", async () => {
    statMock.birthIsCtime = true;
    const demo = await copyDemoProject();
    const dir = join(demo, "decisions");
    const before = await identity(dir);
    expect(before).not.toBeNull();
    await writeCard(dir, 5);
    await writeFile(join(demo, "notes.txt"), "x");
    await rm(join(dir, "0005-x.md"));
    expect(await identity(dir)).toBe(before);
    await rm(dir, { recursive: true });
    expect(await identity(dir)).toBeNull();
  });

  // A project removed and added back keeps nothing from before: its folder is looked at as
  // new and watched again (P2b-3).
  it("watches a project again once it is unregistered and registered at the same path", async () => {
    const { demo, registry, watcher, log } = await watched();
    await registry.remove("demo");
    await watcher.sync();
    await registry.add({ path: demo, name: "demo" });
    await watcher.sync();
    log.splice(0);
    await untilNewCardSeen(log, "demo", join(demo, "decisions"));
  });

  /**
   * Holds the watcher's stats of the projects' folders (each project and its decisions/)
   * until `release()`, which resolves once every look that was held has finished.
   */
  function holdLooks(projects: string[]) {
    const { promise, resolve } = Promise.withResolvers<void>();
    const paths = new Set(projects.flatMap((path) => [path, join(path, "decisions")]));
    const hold: Hold = { paths, until: promise, held: 0, released: 0 };
    statMock.hold = hold;
    const release = async () => {
      resolve();
      // A look stats a project's decisions/ right after its folder (in the same macrotask),
      // and its own code runs right after its last stat: seen from here, a look is done once
      // no held stat is left running.
      await vi.waitFor(() => expect(hold.released).toBe(hold.held));
      await new Promise((done) => setImmediate(done));
    };
    return { hold, release };
  }

  // A hung stat (a hung network mount) must not pile up looks, one per tick (P2b-2).
  it("starts no new look while the last one is still running", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { demo } = await watched();
      const { hold, release } = holdLooks([demo]);
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(hold.held).toBe(1));
      await vi.advanceTimersByTimeAsync(1000);
      expect(hold.held).toBe(1);
      await release();
      // And the poll goes on once it is done.
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(hold.held).toBeGreaterThan(2));
    } finally {
      vi.useRealTimers();
    }
  });

  // A look that ends after close() must not add a watch, which would reopen chokidar (P2b-3).
  it("adds no watch from a look that ends after close()", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { demo, watcher } = await watched();
      const add = vi.spyOn(FSWatcher.prototype, "add");
      closers.push(async () => add.mockRestore());
      const { hold, release } = holdLooks([demo]);
      // The look will find another folder there.
      statMock.sameInode.add(join(demo, "decisions"));
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(hold.held).toBe(1));
      await watcher.close();
      await release();
      expect(hold.released).toBe(2);
      expect(add).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // close() while start() runs: start() settles, and nothing stays open (P2b-4). "During
  // its first look" closes while start() is looking at the folders, every time; the others
  // land wherever the timing puts them.
  it.each([
    ["during its first look", "hold"],
    ["right after it adds the registry folder", "registry"],
    ["at once", 0],
    ["after a turn", "turn"],
    ["after 1 ms", 1],
    ["after 5 ms", 5],
    ["after 20 ms", 20],
  ] as const)(
    "lets start() settle and leaves no watches when closed during it (%s)",
    async (_, when) => {
      const watches = () => process.getActiveResourcesInfo().filter((r) => r === "FSEventWrap");
      const before = watches().length;
      const registry = new Registry(join(await tempDir(), "config"));
      await mkdir(registry.dir, { recursive: true });
      const projects = [await copyDemoProject("one"), await copyDemoProject("two")];
      for (const [i, path] of projects.entries()) await registry.add({ path, name: `p${i}` });
      const held = when === "hold" ? holdLooks(projects) : undefined;
      const watcher = new HubWatcher(registry, new EventBus(), { pollMs: 100 });
      const original = FSWatcher.prototype.add;
      const add = vi.spyOn(FSWatcher.prototype, "add");
      closers.push(async () => add.mockRestore());
      // Before chokidar is ready: it then never will be.
      let closing: Promise<void> | undefined;
      add.mockImplementation(function (this: FSWatcher, ...args: Parameters<FSWatcher["add"]>) {
        original.apply(this, args);
        if (when === "registry" && args[0] === registry.dir) closing ??= watcher.close();
        return this;
      });
      const started = watcher.start();
      if (held) await vi.waitFor(() => expect(held.hold.held).toBe(2));
      else if (when === "registry") await vi.waitFor(() => expect(closing).toBeDefined());
      else if (when === "turn") await new Promise((done) => setImmediate(done));
      else if (typeof when === "number" && when > 0)
        await new Promise((done) => setTimeout(done, when));
      await (closing ?? watcher.close());
      const adds = add.mock.calls.length;
      await held?.release();
      await started;
      // Nothing is added once closed (that would reopen chokidar), and every watch goes.
      expect(add.mock.calls.length).toBe(adds);
      await until([0], () => watches().length === before);
    },
  );

  // rm -rf removes a folder's entries in readdir order, so decisions/ needn't go last.
  it.each([
    ["decisions/ first", ["decisions", "a", "z"]],
    ["decisions/ last", ["a", "z", "decisions"]],
    ["all at once", []],
  ])(
    "keeps reporting changes after a project's folder is deleted and created again (%s)",
    async (_, order) => {
      const { demo, log } = await watched();
      for (const name of ["a", "z"]) {
        await mkdir(join(demo, name, "sub"), { recursive: true });
        await writeFile(join(demo, name, "file"), "x");
      }
      for (const name of order) await rm(join(demo, name), { recursive: true });
      await rm(demo, { recursive: true });
      await mkdir(join(demo, "decisions"), { recursive: true });
      await untilNewCardSeen(log, "demo", join(demo, "decisions"));
    },
  );

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
    // Missing folders mustn't end start() early (chokidar would count each twice toward ready).
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
    // Two, in one folder, back at once.
    const { paths, setup } = missing(["ghost1", "ghost2"]);
    const { log } = await watched(setup);
    await Promise.all(
      [...paths].map(async ([name, path]) => {
        await mkdir(join(path, "decisions"), { recursive: true });
        await untilNewCardSeen(log, name, join(path, "decisions"));
      }),
    );
  });

  it("reports the cards of a project folder that comes back with cards in it", async () => {
    // As a clone does: a folder that is added raises no events for what is already in it.
    const { paths, setup } = missing(["clone"]);
    const { events } = await watched(setup);
    const dir = join(paths.get("clone") ?? "", "decisions");
    await mkdir(dir, { recursive: true });
    await writeCard(dir, 1);
    await until(events, (e) => e.type === "cards" && e.project === "clone");
  });

  it("stops looking for a project's folder once the project is unregistered", async () => {
    const { paths, setup } = missing(["kept", "dropped"]);
    const { registry, watcher, log } = await watched(setup);
    await registry.remove("dropped");
    await watcher.sync();
    const kept = join(paths.get("kept") ?? "", "decisions");
    const dropped = join(paths.get("dropped") ?? "", "decisions");
    for (const dir of [kept, dropped]) await mkdir(dir, { recursive: true });
    // Cards go into both: the look that finds "kept" back would find "dropped" too.
    await untilNewCardSeen(log, "kept", kept, [dropped]);
    const aboutDropped = log.filter((e) =>
      "path" in e ? e.path.startsWith(dropped) : e.type === "cards" && e.project === "dropped",
    );
    expect(aboutDropped).toEqual([]);
  });

  it("leaves no timers or watches behind once closed", async () => {
    // getActiveResourcesInfo() doesn't list the poll's interval, as it is unref'd: fake it to count it.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const watches = () =>
        process.getActiveResourcesInfo().filter((r) => r === "FSEventWrap").length;
      const before = watches();
      const { demo, watcher, fileEvents } = await watched(missing(["gone"]).setup);
      await writeCard(join(demo, "decisions"), 5);
      await until(fileEvents, (e) => e.path.endsWith("0005-x.md"));
      expect(vi.getTimerCount()).toBe(1);
      expect(watches()).toBeGreaterThan(before);
      await watcher.close();
      expect(vi.getTimerCount()).toBe(0);
      // A closed fs.watch handle is let go of a moment later.
      await until([0], () => watches() === before);
    } finally {
      vi.useRealTimers();
    }
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

  // The heartbeat's interval is faked, so a busy machine can't make the answering socket miss
  // a deadline: the next beat comes only once the hub has had its answer (R5-5, D).
  it("drops a socket that stops answering pings, and keeps the ones that answer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { hub: running } = await hub({ heartbeatMs: 30 });
      const silent = await socket(running, { origin: running.url, autoPong: false });
      const answering = await socket(running);
      const pinged = new Promise<void>((done) => answering.ws.once("ping", () => done()));
      vi.advanceTimersByTime(30);
      await pinged;
      // The answer went out before this ping, so once the hub answers this one it has read it.
      await new Promise<void>((done) => {
        answering.ws.once("pong", () => done());
        answering.ws.ping();
      });
      vi.advanceTimersByTime(30);
      await silent.closed;
      expect(answering.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      vi.useRealTimers();
    }
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
    await until([0], () => received().includes('{"ok":true}'));
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
    await until([0], () => refused.received().includes(" 403 "));
    await until([0], () => other.received().includes("200 OK"));
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
