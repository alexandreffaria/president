/**
 * Watches every registered project's decisions/ folder and the registry file, and
 * reports changes (debounced) so the UI can refresh without a reload.
 */
import { EventEmitter } from "node:events";
import { basename, dirname } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { HubEvent } from "../core/api.ts";
import { isIgnoredFile } from "./cards.ts";
import { decisionsDirOf, type Registry } from "./registry.ts";

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
}

export class HubWatcher {
  readonly #registry: Registry;
  readonly #bus: EventBus;
  readonly #debounceMs: number;
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #watcher: FSWatcher;
  /** decisions dir -> project name */
  #dirs = new Map<string, string>();

  constructor(registry: Registry, bus: EventBus, options: HubWatcherOptions = {}) {
    this.#registry = registry;
    this.#bus = bus;
    this.#debounceMs = options.debounceMs ?? 150;
    this.#watcher = watch([], {
      ignoreInitial: true,
      depth: 0,
      usePolling: options.usePolling ?? false,
      interval: 100,
      ignored: (path, stats) => stats?.isFile() === true && isIgnoredWatchedFile(path, registry),
    });
    this.#watcher.on("all", (_event, path) => this.#onChange(path));
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
    for (const dir of this.#dirs.keys()) {
      if (!next.has(dir)) this.#watcher.unwatch(dir);
    }
    const added = [...next.keys()].filter((dir) => !this.#dirs.has(dir));
    this.#dirs = next;
    if (added.length > 0) this.#watcher.add(added);
  }

  async close(): Promise<void> {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    await this.#watcher.close();
  }

  #onChange(path: string): void {
    if (path === this.#registry.file) {
      this.#debounce("projects", async () => {
        await this.sync();
        this.#bus.emit({ type: "projects" });
      });
      return;
    }
    const dir = this.#dirs.has(path) ? path : dirname(path);
    const project = this.#dirs.get(dir);
    if (!project) return;
    if (dir !== path && isIgnoredFile(basename(path))) return;
    this.#debounce(`cards:${project}`, () => this.#bus.emit({ type: "cards", project }));
  }

  #debounce(key: string, fn: () => void | Promise<void>): void {
    clearTimeout(this.#timers.get(key));
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        Promise.resolve(fn()).catch((error) => console.error("[watcher]", error));
      }, this.#debounceMs),
    );
  }
}

/** In the config folder only projects.json matters; in decisions/ only card files. */
function isIgnoredWatchedFile(path: string, registry: Registry): boolean {
  if (dirname(path) === dirname(registry.file)) return path !== registry.file;
  return isIgnoredFile(basename(path));
}
