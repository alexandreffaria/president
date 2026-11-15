/**
 * Sync for every registered project: one git sequence per project at a time, card writes
 * refused while a project's Sync runs, and the fetch at hub start with its retries.
 */
import { basename } from "node:path";
import type {
  ProjectSyncStatus,
  SyncResultDto,
  SyncRunResponse,
  SyncStatusResponse,
} from "../../core/api.ts";
import { UserError } from "../errors.ts";
import { KeyedMutex } from "../fs-utils.ts";
import type { Project, Registry } from "../registry.ts";
import type { EventBus } from "../watcher.ts";
import type { CardRevision } from "./checks.ts";
import { result } from "./messages.ts";
import type { SyncOptions } from "./repo.ts";
import { syncRepoDetailed } from "./sequence.ts";
import { fetchRepo, type RepoStatus, repoStatus } from "./status.ts";

/**
 * Card writes and Syncs per project: while a project's Sync runs (or waits for writes in
 * progress to finish), new card writes there are refused.
 */
class WriteGate {
  readonly #writers = new Map<string, number>();
  readonly #syncing = new Set<string>();
  readonly #drained = new Map<string, () => void>();

  async write<T>(key: string, refuse: () => Error, task: () => Promise<T>): Promise<T> {
    if (this.#syncing.has(key)) throw refuse();
    this.#writers.set(key, (this.#writers.get(key) ?? 0) + 1);
    try {
      return await task();
    } finally {
      const left = (this.#writers.get(key) ?? 1) - 1;
      if (left > 0) this.#writers.set(key, left);
      else {
        this.#writers.delete(key);
        this.#drained.get(key)?.();
      }
    }
  }

  /** Runs `task` once the writes in progress are done; callers are already serialized. */
  async exclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    this.#syncing.add(key);
    try {
      if (this.#writers.has(key)) {
        await new Promise<void>((done) => this.#drained.set(key, done));
        this.#drained.delete(key);
      }
      return await task();
    } finally {
      this.#syncing.delete(key);
    }
  }
}

/** A card file's key: its project's folder and its file name. */
function broughtInKey(project: Project, cardPath: string): string {
  return `${project.path}\0${basename(cardPath)}`;
}

interface ProjectState {
  fetchError?: string;
  last?: SyncResultDto;
  /** The last counts computed, shown while a Sync runs. */
  counts?: RepoStatus;
}

/**
 * After a failed fetch at hub start, the waits before each retry (ms). After a reboot the hub
 * can start before DNS works, and the network is usually up within seconds; a remote still
 * out of reach after ~9 minutes is a real problem (gone, no access), which Sync reports.
 */
export const FETCH_RETRY_DELAYS: readonly number[] = [
  5_000, 15_000, 30_000, 60_000, 120_000, 300_000,
];

export interface SyncServiceOptions extends SyncOptions {
  /** The waits before each retry of a failed start-up fetch (ms); {@link FETCH_RETRY_DELAYS}. */
  fetchRetryMs?: readonly number[];
}

/** Sync for every registered project: what the API and the hub start call. */
export class SyncService {
  readonly #registry: Registry;
  readonly #bus: EventBus;
  readonly #options: SyncOptions;
  readonly #fetchRetryMs: readonly number[];
  /** One git sequence (Sync, the start-up fetch or its retry) per project at a time. */
  readonly #lock = new KeyedMutex();
  readonly #gate = new WriteGate();
  readonly #state = new Map<string, ProjectState>();
  readonly #running = new Set<string>();
  readonly #inFlight = new Set<Promise<unknown>>();
  /** The start-up fetch's retries waiting to run, by project folder. */
  readonly #retries = new Map<string, NodeJS.Timeout>();
  /** Projects whose start-up fetch is being retried: a wait, or a retry at or in the lock. */
  readonly #retrying = new Set<string>();
  /** Projects a Sync ran in: it fetched, so the start-up fetch isn't retried there. */
  readonly #synced = new Set<string>();
  #closed = false;
  /**
   * The card revisions a pull of this hub's Sync brought in, by project folder and card
   * file name (the 500 most recent cards, 20 revisions each; a restart forgets them).
   */
  readonly #broughtIn = new Map<string, string[]>();

  constructor(registry: Registry, bus: EventBus, options: SyncServiceOptions = {}) {
    this.#registry = registry;
    this.#bus = bus;
    const { fetchRetryMs, ...git } = options;
    this.#options = git;
    this.#fetchRetryMs = fetchRetryMs ?? FETCH_RETRY_DELAYS;
  }

  #stateOf(project: Project): ProjectState {
    let state = this.#state.get(project.path);
    if (!state) {
      state = {};
      this.#state.set(project.path, state);
    }
    return state;
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#inFlight.add(promise);
    const done = () => this.#inFlight.delete(promise);
    promise.then(done, done);
    return promise;
  }

  /**
   * Runs a card write unless the project's Sync is running; then refuses it (409,
   * "syncing"). A Sync waits for writes already in progress.
   */
  writeCard<T>(project: Project, task: () => Promise<T>): Promise<T> {
    return this.#gate.write(
      project.path,
      () =>
        new UserError(
          `Sync is running in ${project.name}, so nothing was changed; try again when it finishes.`,
          { status: 409, code: "syncing" },
        ),
      task,
    );
  }

  /**
   * Whether the card file at `cardPath` in `project` is at a revision this hub's Sync
   * brought in with a pull: the card view then says "Sync just brought in a newer version
   * of this card from the online copy." rather than "An agent changed this card".
   */
  broughtIn(project: Project, cardPath: string, revision: string): boolean {
    return this.#broughtIn.get(broughtInKey(project, cardPath))?.includes(revision) ?? false;
  }

  #recordBroughtIn(project: Project, cards: CardRevision[]): void {
    for (const { path, revision } of cards) {
      const key = broughtInKey(project, path);
      const list = this.#broughtIn.get(key) ?? [];
      if (!list.includes(revision)) list.push(revision);
      if (list.length > 20) list.shift();
      this.#broughtIn.delete(key);
      this.#broughtIn.set(key, list);
      if (this.#broughtIn.size > 500) {
        this.#broughtIn.delete(this.#broughtIn.keys().next().value as string);
      }
    }
  }

  async status(): Promise<SyncStatusResponse> {
    const projects = await this.#registry.list();
    const statuses = await Promise.all(
      projects.map(async (project): Promise<ProjectSyncStatus> => {
        const state = this.#stateOf(project);
        const running = this.#running.has(project.path);
        // Mid-Sync the checkout is in flux; show the counts from before.
        const counts =
          running && state.counts
            ? state.counts
            : await repoStatus(project.path, this.#options, project.name);
        if (!running) state.counts = counts;
        return {
          project: project.name,
          ...(counts.unavailable ? { unavailable: counts.unavailable } : {}),
          unsynced: counts.unsynced,
          ...(counts.skippedUnsynced !== undefined
            ? { skippedUnsynced: counts.skippedUnsynced }
            : {}),
          remoteChanges: counts.remoteChanges,
          ...(counts.rebase ? { rebase: counts.rebase } : {}),
          ...(state.fetchError ? { fetchError: state.fetchError } : {}),
          fetchRetrying: this.#retrying.has(project.path),
          running,
          ...(state.last ? { last: state.last } : {}),
        };
      }),
    );
    return { projects: statuses, running: statuses.some((s) => s.running) };
  }

  /** Syncs every registered project, one after another, and reports each one. */
  sync(): Promise<SyncRunResponse> {
    return this.#track(this.#syncAll());
  }

  async #syncAll(): Promise<SyncRunResponse> {
    const projects = await this.#registry.list();
    const results: SyncResultDto[] = [];
    for (const project of projects) {
      let fetched = false;
      const outcome = await this.#lock.run(project.path, () =>
        this.#gate.exclusive(project.path, async () => {
          this.#running.add(project.path);
          this.#bus.emit({ type: "sync" });
          try {
            const run = await syncRepoDetailed(project.path, project.name, this.#options);
            // Recorded before the `cards` event below, so a card view that reloaded while
            // the pull ran (and took the change for an agent's) gets it right on that event.
            this.#recordBroughtIn(project, run.broughtIn);
            if (run.fetched) {
              // This Sync fetched: no more retries of the start-up fetch here. One that
              // stopped before (a rebase in progress, say) leaves them going.
              fetched = true;
              this.#synced.add(project.path);
              this.#stopRetrying(project.path);
            }
            return run.result;
          } catch (error) {
            console.error(error);
            return result("not-synced", `Not synced: something went wrong in ${project.name}`, {
              action: "See the president server's log.",
            });
          } finally {
            this.#running.delete(project.path);
          }
        }),
      );
      const done: SyncResultDto = {
        project: project.name,
        ...outcome,
        at: new Date().toISOString(),
      };
      const state = this.#stateOf(project);
      state.last = done;
      // This Sync fetched (or said why it couldn't): the start-up fetch's error is old news.
      if (fetched) delete state.fetchError;
      results.push(done);
      // A pull (or an abort) may have rewritten card files: open card views reload. The
      // watcher notices too, a moment later.
      if (!["nothing", "not-now", "unavailable"].includes(done.outcome)) {
        this.#bus.emit({ type: "cards", project: project.name });
      }
      this.#bus.emit({ type: "sync" });
    }
    return { results };
  }

  /** The fetch at hub start, for every project; failures are kept for the status. */
  fetchAll(): Promise<void> {
    return this.#track(
      (async () => {
        let projects: Project[];
        try {
          projects = await this.#registry.list();
        } catch {
          return; // A broken registry is reported wherever it is read; no fetch then.
        }
        await Promise.all(
          projects.map((project) =>
            this.#lock.run(project.path, async () => {
              // A Sync that took the lock first fetched later than this would: its result stands.
              if (this.#synced.has(project.path)) return;
              await this.#fetch(project);
              if (this.#stateOf(project).fetchError) this.#retryFetch(project, 0);
            }),
          ),
        );
        this.#bus.emit({ type: "sync" });
      })(),
    );
  }

  /** Fetches `project` and keeps the error for the status; true when that changed it. */
  async #fetch(project: Project): Promise<boolean> {
    const state = this.#stateOf(project);
    const before = state.fetchError;
    try {
      const fetched = await fetchRepo(project.path, this.#options);
      if (fetched.error) state.fetchError = fetched.error;
      else delete state.fetchError;
    } catch (error) {
      state.fetchError = (error as Error).message;
    }
    return state.fetchError !== before;
  }

  /**
   * Fetches `project` again after the `attempt`th wait, until a fetch works, the waits run
   * out, a Sync runs there or the hub closes. The error stays shown meanwhile.
   */
  #retryFetch(project: Project, attempt: number): void {
    const { path } = project;
    const delay = this.#fetchRetryMs[attempt];
    if (delay === undefined || this.#closed || this.#synced.has(path)) {
      this.#stopRetrying(path);
      return;
    }
    const timer = setTimeout(() => {
      this.#retries.delete(path);
      void this.#track(
        this.#lock.run(path, async () => {
          // A Sync that ran while this waited for the lock already fetched.
          if (this.#closed || this.#synced.has(path)) return;
          // A project removed meanwhile: nothing left to show the error for.
          let projects: Project[];
          try {
            projects = await this.#registry.list();
          } catch {
            projects = [project]; // A broken registry may well be fixed; keep trying.
          }
          if (!projects.some((p) => p.path === path)) {
            this.#stopRetrying(path);
            this.#state.delete(path);
            this.#synced.delete(path);
            return;
          }
          const changed = await this.#fetch(project);
          if (this.#stateOf(project).fetchError) this.#retryFetch(project, attempt + 1);
          else this.#stopRetrying(path);
          // The error, or whether the hub keeps trying, changed.
          if (changed || !this.#retrying.has(path)) this.#bus.emit({ type: "sync" });
        }),
      );
    }, delay);
    // A wait never keeps the process alive; close() cancels it.
    timer.unref();
    clearTimeout(this.#retries.get(path));
    this.#retries.set(path, timer);
    this.#retrying.add(path);
  }

  /** Cancels the waiting retry of the start-up fetch in the project at `path`, if any. */
  #stopRetrying(path: string): void {
    clearTimeout(this.#retries.get(path));
    this.#retries.delete(path);
    this.#retrying.delete(path);
  }

  /**
   * Cancels the start-up fetch's waiting retries, then waits for every Sync and fetch in
   * progress (each is bounded by its git timeouts).
   */
  async close(): Promise<void> {
    this.#closed = true;
    for (const path of [...this.#retries.keys()]) this.#stopRetrying(path);
    this.#retrying.clear();
    await Promise.allSettled([...this.#inFlight]);
  }
}
