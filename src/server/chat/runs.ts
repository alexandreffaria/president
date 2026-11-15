/**
 * Which card has a run going on, on this machine (service.ts): one at a time per card.
 *
 * - A card is reserved for a reply (its ChatRun), a summary or a New conversation from the
 *   start to the end of it; another one is refused meanwhile (`chat_busy`), and a new-options
 *   run waits for the card to be free (reserveWhenIdle).
 * - A new-options run is tracked from its start until it has ended (also while it waits for a
 *   reply to end, or winds down after an Undo), with the note it is for and what stops it.
 * - Starting a new-options run and undoing its note take the card's run lock, one after the
 *   other.
 */
import type { ChatStreamEvent } from "../../core/api.ts";
import { UserError } from "../errors.ts";
import { KeyedMutex } from "../fs-utils.ts";
import type { CardKey } from "./store.ts";

type Listener = (event: ChatStreamEvent) => void;

/** A run in progress: its events so far, replayed to whoever subscribes. */
export class ChatRun {
  readonly #events: ChatStreamEvent[] = [];
  readonly #listeners = new Set<Listener>();
  #ended = false;
  readonly done: Promise<void>;
  #resolve!: () => void;

  constructor() {
    this.done = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  emit(event: ChatStreamEvent): void {
    this.#events.push(event);
    for (const listener of this.#listeners) listener(event);
    if (event.type === "done" || event.type === "error") {
      this.#ended = true;
      this.#listeners.clear();
      this.#resolve();
    }
  }

  /** Every event so far, then each new one until the run ends. */
  subscribe(listener: Listener): () => void {
    for (const event of this.#events) listener(event);
    if (!this.#ended) this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const keyName = ({ project, id }: CardKey) => `${project}/${id}`;

/** What holds a card: a reply or new options (its ChatRun), a summary, New conversation. */
export type Reservation = ChatRun | "summary" | "new";

/** A card's new-options run: its note's time, when it ends, and what stops it (Undo). */
export interface NewOptionsRun {
  readonly note: string;
  readonly done: Promise<void>;
  readonly stop: AbortController;
}

export class CardRuns {
  /** Cards with a run going on (a reply, a summary, new options): one at a time per card. */
  readonly #running = new Map<string, Reservation>();
  /** Who waits for a card's run to end (#nextRelease). */
  readonly #waiters = new Map<string, (() => void)[]>();
  /**
   * The new-options run of each card, from its start until it has ended (also while it waits
   * for a reply to end, or winds down after an Undo): its note's time, when it ends, and what
   * stops it (Undo). One at a time: a second "neither" is refused meanwhile (newOptionsAsked).
   */
  readonly #newOptions = new Map<string, NewOptionsRun>();
  /** The runs in #running that are new-options runs (`running: "options"`). */
  readonly #optionRuns = new WeakSet<ChatRun>();
  /** One at a time per card: starting a new-options run, undoing its note. */
  readonly #runLock = new KeyedMutex();
  /**
   * Cards whose run is starting a new session: Claude Code may not have written its
   * transcript yet, which doesn't mean it forgot the conversation.
   */
  readonly #starting = new Set<string>();

  /** What the card is reserved for, if anything. */
  reservation(name: string): Reservation | undefined {
    return this.#running.get(name);
  }

  isReserved(name: string): boolean {
    return this.#running.has(name);
  }

  /** The cards reserved now. */
  reservedNames(): string[] {
    return [...this.#running.keys()];
  }

  /** The card's new-options run, from its start until it has ended. */
  newOptionsRun(name: string): NewOptionsRun | undefined {
    return this.#newOptions.get(name);
  }

  hasNewOptionsRun(name: string): boolean {
    return this.#newOptions.has(name);
  }

  /** When each new-options run going on now ends. */
  newOptionsDone(): Promise<void>[] {
    return [...this.#newOptions.values()].map((run) => run.done);
  }

  /** Whether any card is reserved or has a new-options run. */
  get active(): boolean {
    return this.#running.size > 0 || this.#newOptions.size > 0;
  }

  /** Runs `task` under the card's run lock: after the tasks before it, before those after. */
  lock<T>(name: string, task: () => Promise<T>): Promise<T> {
    return this.#runLock.run(name, task);
  }

  /**
   * Tracks the card's new-options run for `note` from now; `forget` ends it (and only drops
   * it while it is still the card's run). Call under the card's run lock, with no run on it.
   */
  beginNewOptions(name: string, note: string): { run: NewOptionsRun; forget: () => void } {
    const { promise: done, resolve: ended } = Promise.withResolvers<void>();
    const run = { note, done, stop: new AbortController() };
    this.#newOptions.set(name, run);
    const forget = () => {
      if (this.#newOptions.get(name) === run) this.#newOptions.delete(name);
      ended();
    };
    return { run, forget };
  }

  /** Marks `run` as a new-options run (`running: "options"`). */
  markOptionsRun(run: ChatRun): void {
    this.#optionRuns.add(run);
  }

  isOptionsRun(run: ChatRun): boolean {
    return this.#optionRuns.has(run);
  }

  /** The card's run starts a new session (until it is released). */
  startsSession(name: string): void {
    this.#starting.add(name);
  }

  /** The card's run resumes its session. */
  resumesSession(name: string): void {
    this.#starting.delete(name);
  }

  isStartingSession(name: string): boolean {
    return this.#starting.has(name);
  }

  reserve(key: CardKey, run: Reservation): void {
    if (this.#running.has(keyName(key))) throw this.busyError(key);
    this.#running.set(keyName(key), run);
  }

  /** Why the card refuses another run: what holds it. */
  busyError(key: CardKey): UserError {
    const options = this.#newOptions.get(keyName(key));
    // A stopped run still on the card is one being stopped (its process, or its write).
    const message = options?.stop.signal.aborted
      ? "the new-options run on this card is still stopping; try again in a moment"
      : options
        ? "new options are being written on this card; wait for them, or undo your note first"
        : this.#running.get(keyName(key)) === "new"
          ? "a new conversation is being started on this card; try again in a moment"
          : "the agent is still answering on this card; wait for it to finish";
    return new UserError(message, { status: 409, code: "chat_busy" });
  }

  /** The card's run (a reply, a summary) ended: the next one may start. */
  release(key: CardKey): void {
    this.#running.delete(keyName(key));
    this.#starting.delete(keyName(key));
    const waiting = this.#waiters.get(keyName(key)) ?? [];
    this.#waiters.delete(keyName(key));
    for (const wake of waiting) wake();
  }

  /**
   * Waits until no run is going on for the card, then reserves it for `run`: the check and
   * the reservation have no await between them, so of several waiters woken together one
   * reserves and the others wait again. False, without reserving, once `stop` is aborted.
   */
  async reserveWhenIdle(key: CardKey, run: ChatRun, stop: AbortSignal): Promise<boolean> {
    const name = keyName(key);
    const stopped = new Promise<void>((resolve) =>
      stop.addEventListener("abort", () => resolve(), { once: true }),
    );
    while (!stop.aborted && this.#running.has(name)) {
      await Promise.race([this.#nextRelease(name), stopped]);
    }
    if (stop.aborted) return false;
    this.#running.set(name, run);
    return true;
  }

  #nextRelease(name: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const list = this.#waiters.get(name) ?? [];
      list.push(resolve);
      this.#waiters.set(name, list);
    });
  }

  /** Waits until the card is no longer reserved. */
  async whenIdle(name: string): Promise<void> {
    while (this.#running.has(name)) await this.#nextRelease(name);
  }
}
