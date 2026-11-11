/**
 * Watches every registered project's decisions/ folder and the registry folder, and
 * reports changes (debounced) so the UI can refresh without a reload.
 */
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { basename, dirname, sep } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { HubEvent } from "../core/api.ts";
import { isIgnoredFile } from "./cards.ts";
import { DECISIONS_DIR, decisionsDirOf, isEntryFileName, type Registry } from "./registry.ts";

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
  /**
   * Folders watched one level deep because a project folder below them is missing. chokidar
   * would watch a missing path's parent for it, but two such waits on one folder share its
   * reads, so one of them misses its folder appearing, and a folder found that way is not
   * watched inside.
   */
  #lookouts = new Set<string>();
  #closed = false;

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
    // The projects' folders first: chokidar's one ready event counts only the adds made before it.
    // Missing folders after it: chokidar counts a missing path twice toward ready, so with two or
    // more of them ready would come before the other folders are watched.
    const missing = await this.sync(true);
    this.#watcher.add(this.#registry.dir);
    await ready;
    await this.#watchMissing(missing);
  }

  /**
   * Re-reads the registry and adjusts the set of watched folders. With `holdMissing`, new
   * folders that don't exist are returned for the caller to watch for, instead of now.
   */
  async sync(holdMissing = false): Promise<string[]> {
    let projects: Awaited<ReturnType<Registry["list"]>>;
    try {
      projects = await this.#registry.list();
    } catch (error) {
      console.error("[watcher]", (error as Error).message);
      return [];
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
    const there = await Promise.all(added.map(isFolder));
    if (this.#closed) return [];
    const present = added.filter((_, i) => there[i]);
    const missing = added.filter((_, i) => !there[i]);
    if (present.length > 0) this.#watcher.add(present);
    if (holdMissing) return missing;
    await this.#watchMissing(missing);
    return [];
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#debouncer.cancelAll();
    await this.#watcher.close();
  }

  /** True for paths whose changes don't matter (anything but registry entries, decisions/ and cards). */
  ignores(path: string): boolean {
    if (
      path === this.#registry.dir ||
      this.#dirs.has(path) ||
      this.#roots.has(path) ||
      this.#lookouts.has(path)
    ) {
      return false;
    }
    const parent = dirname(path);
    // In the registry folder only the projects' files matter (not temp files).
    if (parent === this.#registry.dir) return !isEntryFileName(basename(path));
    // In a project folder only decisions/ matters.
    if (this.#roots.has(parent)) return basename(path) !== DECISIONS_DIR;
    // In decisions/ only card files matter.
    if (this.#dirs.has(parent)) return isIgnoredFile(basename(path));
    // In a folder watched for a missing project folder only the way to that folder matters.
    if (this.#lookouts.has(parent)) {
      return ![...this.#roots].some((root) => root.startsWith(path + sep));
    }
    return false;
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
    if (this.#roots.has(path) && (event === "addDir" || event === "unlinkDir")) {
      if (event === "addDir") this.#watchRoot(path);
      else void this.#lookFor(path);
      return;
    }
    if (event === "addDir" && this.#lookouts.has(dirname(path))) {
      // A folder on the way to a missing project folder appeared: look from there.
      for (const root of this.#roots) if (root.startsWith(path + sep)) void this.#lookFor(root);
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

  /** Watches for folders that don't exist yet. */
  async #watchMissing(paths: string[]): Promise<void> {
    // A missing decisions/ through its project's folder (as before); one whose project's
    // folder is missing too is watched once that folder appears.
    const dirs = paths.filter((path) => this.#dirs.has(path) && !paths.includes(dirname(path)));
    if (dirs.length > 0) this.#watcher.add(dirs);
    const roots = paths.filter((path) => this.#roots.has(path));
    await Promise.all(roots.map((root) => this.#lookFor(root)));
  }

  /**
   * Watches the nearest folder above a missing project folder, to see the way to it appear.
   * It may have appeared before that watch was attached, which no event reports, so look once
   * more after a debounce delay; `from` is the folder the last look found.
   */
  async #lookFor(root: string, from?: string): Promise<void> {
    let folder = root;
    while (!(await isFolder(folder))) {
      if (dirname(folder) === folder) return;
      folder = dirname(folder);
    }
    if (this.#closed || !this.#roots.has(root) || folder === from) return;
    if (folder === root) {
      this.#watchRoot(root);
      return;
    }
    if (!this.#lookouts.has(folder)) {
      this.#lookouts.add(folder);
      this.#watcher.add(folder);
    }
    this.#debouncer.run(`look:${root}`, () => this.#lookFor(root, folder));
  }

  /**
   * A project's folder appeared: watch it afresh (a folder that was missing is not watched
   * inside). Its decisions/ may have been made before that watch was attached, which no event
   * reports, so look once more after a debounce delay: watch the decisions/ folders that are
   * there, and report the projects' cards after one more delay, once those watches are
   * attached. A decisions/ made later is reported by the new watch.
   */
  #watchRoot(root: string): void {
    this.#watcher.unwatch(root);
    this.#watcher.add(root);
    this.#debouncer.run(`root:${root}`, async () => {
      for (const [dir, name] of this.#dirs) {
        if (dirname(dir) !== root || !(await isFolder(dir))) continue;
        if (this.#closed || this.#dirs.get(dir) !== name) continue;
        this.#watcher.unwatch(dir);
        this.#watcher.add(dir);
        this.#debouncer.run(`cards:${name}`, () =>
          this.#bus.emit({ type: "cards", project: name }),
        );
      }
    });
  }
}

/** True if `path` is a folder (following links, as chokidar does). */
function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}
