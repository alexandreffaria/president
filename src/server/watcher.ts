/**
 * Watches every registered project's decisions/ folder and the registry file, and
 * reports changes (debounced) so the UI can refresh without a reload.
 */
import { EventEmitter } from "node:events";
import { basename, dirname } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { HubEvent } from "../core/api.ts";
import { isIgnoredFile } from "./cards.ts";
import { DECISIONS_DIR, decisionsDirOf, type Registry } from "./registry.ts";

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
  readonly #watcher: FSWatcher;
  /** decisions dir -> project name */
  #dirs = new Map<string, string>();
  /**
   * Project folders, watched one level deep so we notice decisions/ being deleted and
   * created again (a watch on a deleted folder goes silent).
   */
  #roots = new Set<string>();

  constructor(registry: Registry, bus: EventBus, options: HubWatcherOptions = {}) {
    this.#registry = registry;
    this.#bus = bus;
    this.#debouncer = new Debouncer(options.debounceMs ?? 150);
    this.#onFileEvent = options.onFileEvent;
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

  /** Starts watching; resolves once the initial scan is done. */
  async start(): Promise<void> {
    const ready = new Promise<void>((resolve) => this.#watcher.once("ready", () => resolve()));
    this.#watcher.add(dirname(this.#registry.file));
    await this.sync();
    await ready;
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
    const nextRoots = new Set(projects.map((p) => p.path));
    const removed = [
      ...[...this.#dirs.keys()].filter((dir) => !next.has(dir)),
      ...[...this.#roots].filter((root) => !nextRoots.has(root)),
    ];
    const added = [
      ...[...next.keys()].filter((dir) => !this.#dirs.has(dir)),
      ...[...nextRoots].filter((root) => !this.#roots.has(root)),
    ];
    this.#dirs = next;
    this.#roots = nextRoots;
    if (removed.length > 0) this.#watcher.unwatch(removed);
    if (added.length > 0) this.#watcher.add(added);
  }

  async close(): Promise<void> {
    this.#debouncer.cancelAll();
    await this.#watcher.close();
  }

  /** True for paths whose changes don't matter (anything but projects.json, decisions/ and cards). */
  ignores(path: string): boolean {
    if (path === this.#registry.file || this.#dirs.has(path) || this.#roots.has(path)) {
      return false;
    }
    const parent = dirname(path);
    // In the config folder only projects.json matters.
    if (parent === dirname(this.#registry.file)) return true;
    // In a project folder only decisions/ matters.
    if (this.#roots.has(parent)) return basename(path) !== DECISIONS_DIR;
    // In decisions/ only card files matter.
    if (this.#dirs.has(parent)) return isIgnoredFile(basename(path));
    return false;
  }

  #onChange(event: string, path: string): void {
    this.#onFileEvent?.(event, path);
    if (path === this.#registry.file) {
      this.#debouncer.run("projects", async () => {
        await this.sync();
        this.#bus.emit({ type: "projects" });
      });
      return;
    }
    let project = this.#dirs.get(path);
    if (project && event === "addDir") {
      // decisions/ came back after being deleted: watch it afresh.
      this.#watcher.unwatch(path);
      this.#watcher.add(path);
    }
    project ??= this.#dirs.get(dirname(path));
    if (!project) return;
    const name = project;
    this.#debouncer.run(`cards:${name}`, () => this.#bus.emit({ type: "cards", project: name }));
  }
}
