/**
 * Watches every registered project's decisions/ folder and the registry folder, and
 * reports changes (debounced) so the UI can refresh without a reload.
 */
import { EventEmitter } from "node:events";
import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
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
  #closed = false;

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
    this.#watcher.on("error", (error) => console.error("[watcher]", error));
  }

  /** Starts watching; resolves once every decisions/ folder that exists is watched. */
  async start(): Promise<void> {
    const ready = new Promise<void>((resolve) => this.#watcher.once("ready", () => resolve()));
    // The decisions/ folders first: chokidar's one ready event counts only the adds made before it.
    await this.sync();
    this.#watcher.add(this.#registry.dir);
    await ready;
    if (this.#closed) return;
    // A watch doesn't see its own folder appear, or another made in its place, so a poll looks
    // for that: two stats per project, and no watches of its own.
    this.#poll = setInterval(() => void this.#check([...this.#dirs.keys()]), this.#pollMs);
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
    clearInterval(this.#poll);
    this.#debouncer.cancelAll();
    await this.#watcher.close();
  }

  /** True for paths whose changes don't matter (anything but registry entries, decisions/ and cards). */
  ignores(path: string): boolean {
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
    const project = this.#dirs.get(path) ?? this.#dirs.get(dirname(path));
    if (project) this.#reportCards(project);
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
 * What is at decisions/ `dir`: which folder it and its project folder are, or null if it is
 * not a folder. That changes when either is made again or a drive is mounted above. The
 * birth time is part of it, as a folder made again often gets the old one's inode (ext4).
 */
function identity(dir: string): Promise<string | null> {
  const id = (s: Stats) => `${s.dev}:${s.ino}:${s.birthtimeMs}`;
  return Promise.all([stat(dirname(dir)), stat(dir)]).then(
    ([root, decisions]) => (decisions.isDirectory() ? `${id(root)} ${id(decisions)}` : null),
    () => null,
  );
}
