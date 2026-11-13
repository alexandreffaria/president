/**
 * Watches every registered project's decisions/ folder and the registry folder, and
 * reports changes (debounced) so the UI can refresh without a reload.
 */
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { basename, dirname, normalize } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { HubEvent } from "../core/api.ts";
import { isIgnoredFile } from "./cards.ts";
import { decisionsDirOf, isEntryFileName, type Registry } from "./registry.ts";

export class EventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    this.#emitter.setMaxListeners(0);
  }

  emit(event: HubEvent): void {
    this.#emitter.emit("event", event);
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.#emitter.on("event", listener);
    return () => this.#emitter.off("event", listener);
  }
}

export interface HubWatcherOptions {
  debounceMs?: number;
  /** Use stat polling instead of native events (slower; for odd filesystems and tests). */
  usePolling?: boolean;
  /** Called for every file event the watcher acts on, before debouncing (tests, debugging). */
  onFileEvent?: (event: string, path: string) => void;
  /** How often to look for decisions/ folders that appeared, went or were made again (ms). */
  pollMs?: number;
}

/** Runs the last function given for a key once no new one arrived for `delayMs`. */
export class Debouncer {
  readonly #delayMs: number;
  readonly #timers = new Map<string, NodeJS.Timeout>();

  constructor(delayMs: number) {
    this.#delayMs = delayMs;
  }

  run(key: string, fn: () => void | Promise<void>): void {
    clearTimeout(this.#timers.get(key));
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        Promise.resolve()
          .then(fn)
          .catch((error) => console.error("[watcher]", error));
      }, this.#delayMs),
    );
  }

  cancelAll(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}

export class HubWatcher {
  readonly #registry: Registry;
  readonly #bus: EventBus;
  readonly #debouncer: Debouncer;
  readonly #onFileEvent: HubWatcherOptions["onFileEvent"];
  readonly #pollMs: number;
  readonly #watcher: FSWatcher;
  /** decisions dir -> project name */
  #dirs = new Map<string, string>();
  /** decisions dir -> what the last look found there (see `identity`), null if nothing. */
  #seen = new Map<string, string | null>();
  #poll: NodeJS.Timeout | undefined;
  /** A poll's look is still running: the next tick is skipped, so looks never pile up. */
  #polling = false;
  #closed = false;
  readonly #closing = Promise.withResolvers<void>();

  constructor(registry: Registry, bus: EventBus, options: HubWatcherOptions = {}) {
    this.#registry = registry;
    this.#bus = bus;
    this.#debouncer = new Debouncer(options.debounceMs ?? 150);
    this.#onFileEvent = options.onFileEvent;
    this.#pollMs = options.pollMs ?? 1000;
    this.#watcher = watch([], {
      ignoreInitial: true,
      depth: 0,
      usePolling: options.usePolling ?? false,
      interval: 100,
      ignored: (path) => this.ignores(path),
    });
    this.#watcher.on("all", (event, path) => this.#onChange(event, path));
    this.#watcher.on("raw", (event, path, details) => this.#onRaw(event, path, details));
    this.#watcher.on("error", (error) => console.error("[watcher]", error));
  }

  /** Starts watching; resolves once every decisions/ folder that exists is watched. */
  async start(): Promise<void> {
    const ready = new Promise<void>((resolve) => this.#watcher.once("ready", () => resolve()));
    // The decisions/ folders first: chokidar's one ready event counts only the adds made before it.
    await this.sync();
    // Closed meanwhile: an add would reopen chokidar, and its ready event will never come.
    if (this.#closed) return;
    this.#watcher.add(this.#registry.dir);
    await Promise.race([ready, this.#closing.promise]);
    if (this.#closed) return;
    // A watch doesn't see its own folder appear, or another made in its place, so a poll looks
    // for that: two stats per project, and no watches of its own.
    this.#poll = setInterval(() => void this.#tick(), this.#pollMs);
    this.#poll.unref();
  }

  /** Re-reads the registry and adjusts the set of watched folders. */
  async sync(): Promise<void> {
    let projects: Awaited<ReturnType<Registry["list"]>>;
    try {
      projects = await this.#registry.list();
    } catch (error) {
      console.error("[watcher]", (error as Error).message);
      return;
    }
    const next = new Map(projects.map((p) => [decisionsDirOf(p), p.name]));
    const removed = [...this.#dirs.keys()].filter((dir) => !next.has(dir));
    const added = [...next.keys()].filter((dir) => !this.#dirs.has(dir));
    this.#dirs = next;
    for (const dir of removed) this.#seen.delete(dir);
    if (removed.length > 0) this.#watcher.unwatch(removed);
    await this.#check(added);
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#closing.resolve();
    clearInterval(this.#poll);
    this.#debouncer.cancelAll();
    await this.#watcher.close();
  }

  /** True for paths whose changes don't matter (anything but registry entries, decisions/ and cards). */
  ignores(chokidarPath: string): boolean {
    const path = nativePath(chokidarPath);
    if (path === this.#registry.dir || this.#dirs.has(path)) return false;
    const parent = dirname(path);
    // In the registry folder only the projects' files matter (not temp files).
    if (parent === this.#registry.dir) return !isEntryFileName(basename(path));
    // In decisions/ only card files matter.
    if (this.#dirs.has(parent)) return isIgnoredFile(basename(path));
    // Nothing else: not even the folder chokidar would watch for a decisions/ that went
    // between the poll's look and its add. The next look handles that.
    return true;
  }

  #onChange(event: string, path: string): void {
    this.#onFileEvent?.(event, path);
    if (path === this.#registry.dir || dirname(path) === this.#registry.dir) {
      this.#debouncer.run("projects", async () => {
        await this.sync();
        this.#bus.emit({ type: "projects" });
      });
      return;
    }
    // chokidar can tell decisions/ went (from its cards' events) before the folder's own
    // event comes, and then stops watching it, so that event may never come (see #onRaw).
    if (event === "unlinkDir") this.#wentAway(path);
    const project = this.#dirs.get(path) ?? this.#dirs.get(dirname(path));
    if (project) this.#reportCards(project);
  }

  /** A watched decisions/ that is deleted or moved away raises a raw `rename` naming itself. */
  #onRaw(event: string, path: string, details: unknown): void {
    const raw = (details as { watchedPath?: unknown } | undefined)?.watchedPath;
    if (event !== "rename" || typeof raw !== "string") return;
    const watched = nativePath(raw);
    if (path === watched || path === basename(watched)) this.#wentAway(watched);
  }

  /**
   * decisions/ `dir` went (deleted or moved away): its next look treats whatever is there as
   * new, even a folder with the same inode (ext4 reuses it for a folder made again at once).
   */
  #wentAway(dir: string): void {
    if (this.#seen.get(dir)) this.#seen.set(dir, STALE);
  }

  /** One poll tick, skipped while the last one is still looking (a hung mount, say). */
  async #tick(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      await this.#check([...this.#dirs.keys()]);
    } finally {
      this.#polling = false;
    }
  }

  #reportCards(name: string): void {
    this.#debouncer.run(`cards:${name}`, () => this.#bus.emit({ type: "cards", project: name }));
  }

  /**
   * Looks at the decisions/ folders `dirs`: watches each that appeared or was made again since
   * the last look, and stops watching each that went. A change after the first look also
   * reports the project's cards, since cards in a folder that is added raise no events.
   */
  async #check(dirs: string[]): Promise<void> {
    const before = dirs.map((dir) => this.#seen.get(dir));
    const now = await Promise.all(dirs.map(identity));
    if (this.#closed) return;
    const stale: string[] = [];
    const there: string[] = [];
    dirs.forEach((dir, i) => {
      const name = this.#dirs.get(dir);
      // One unregistered, or looked at by another check meanwhile, is left to the next look.
      if (now[i] === before[i] || name === undefined || this.#seen.get(dir) !== before[i]) return;
      this.#seen.set(dir, now[i] ?? null);
      if (before[i]) stale.push(dir);
      if (now[i]) there.push(dir);
      if (before[i] !== undefined) this.#reportCards(name);
    });
    if (stale.length > 0) this.#watcher.unwatch(stale);
    // All at once, after every look: chokidar's ready event counts only the adds made before it.
    if (there.length > 0) this.#watcher.add(there);
  }
}

/**
 * A path as president spells it. On Windows chokidar gives `ignored` and raw events its own
 * spelling, with forward slashes (C:/Users/...), though its other events use backslashes.
 */
function nativePath(path: string): string {
  return process.platform === "win32" ? normalize(path) : path;
}

/** What `#seen` holds for a folder that went: no identity equals it. */
const STALE = "stale";

/**
 * What is at decisions/ `dir`: which folder it and its project folder are (device and
 * inode), or null if it is not a folder. That changes when either is made again with a new
 * inode, or a drive is mounted above. A folder made again often gets the old one's inode
 * (ext4); its watch's events catch that (see `#wentAway`). No time is part of it: without
 * statx, Node reports the ctime as the birth time, and that changes with every card written.
 *
 * Known limit: where the watch reports nothing when the folder goes (a network drive
 * changed from another machine), a decisions/ deleted and made again with the same inode
 * between two looks isn't noticed, and its project gets no live updates until the hub
 * restarts or the project is registered again.
 *
 * The two stats run one after the other, so a hung mount holds one thread, not two.
 */
export async function identity(dir: string): Promise<string | null> {
  try {
    const root = await stat(dirname(dir));
    const decisions = await stat(dir);
    if (!decisions.isDirectory()) return null;
    return `${root.dev}:${root.ino} ${decisions.dev}:${decisions.ino}`;
  } catch {
    return null;
  }
}
