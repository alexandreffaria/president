/**
 * Card conversations: a headless Claude Code session per card, run in the card's project
 * folder with #0004's read-only flags (runner.ts), and the per-machine stores that go with
 * it (store.ts).
 *
 * - Each card has at most one session on this machine (#0021); its id is chosen up front
 *   (`--session-id`) and kept in the session store, never in the card. Chatting never writes
 *   the card file.
 * - Each message the hub showed is kept in its own copy (#0018) for showing the conversation
 *   again after a reload or a restart; continuing always resumes Claude Code's session.
 * - When Claude Code no longer has the session (another machine, or after
 *   `cleanupPeriodDays`), the next message starts a fresh one from the card and its
 *   summaries, the page says so, and the entry is replaced.
 * - Your next message resumes the same session by default; New conversation (20261112lvbu
 *   `choose`) ends it, and the next message starts a new one the same way, with a new id,
 *   neutral about the pick again. The copy keeps the earlier messages, above a divider.
 * - Summaries: the session writes one (or, when Claude Code deleted it, a fresh one-off
 *   session reads the hub's copy, 20261111paot); nothing is saved until the human saves it
 *   as a `chat` card action, which goes through the card API like any other write.
 * - The hub's copy is kept as long as its card exists: once the card or its project has been
 *   gone for 30 days, it is deleted (202611114wet `with-card`), at start and once a day.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import { type CardActionType, timestamp } from "../../core/actions.ts";
import {
  type ChatAsk,
  type ChatCloseResponse,
  type ChatDto,
  type ChatMessageDto,
  type ChatStreamEvent,
  type ChatSummaryResponse,
  isNewConversation,
  NEW_CONVERSATION,
  type NewOptionsRunDto,
  type StartNewOptionsResponse,
} from "../../core/api.ts";
import { parseCardFileName } from "../../core/card-file.ts";
import { newOptionsFailure } from "../../core/new-options.ts";
import type { RawFrontmatter } from "../../core/schema.ts";
import {
  type BodySections,
  demoteSectionHeadings,
  FENCE_CLOSE,
  FENCE_OPEN,
  replaceOptionSections,
  splitSections,
} from "../../core/sections.ts";
import { findCard, isIgnoredFile, type LoadedCard, rewriteCard } from "../cards.ts";
import { UserError } from "../errors.ts";
import { isNotFound, KeyedMutex } from "../fs-utils.ts";
import { decisionsDirOf, type Project, type Registry } from "../registry.ts";
import type { EventBus } from "../watcher.ts";
import {
  ASK_LABEL,
  askRequest,
  isViewAsked,
  lastNeither,
  newOptionsRequest,
  newOptionsSchema,
  optionCount,
  optionsHash,
  pickHash,
  pickLine,
  revealOf,
  sessionInstructions,
  startOverNote,
  summaryFromCopy,
  summaryRequest,
  withPickLine,
} from "./prompts.ts";
import {
  defaultClaudeDir,
  type RunRequest,
  type RunResult,
  runClaude,
  transcriptExists,
} from "./runner.ts";
import {
  type CardKey,
  ChatStore,
  defaultStateDir,
  type NewOptionsRecord,
  type SessionEntry,
} from "./store.ts";

/**
 * Writes a card through whatever guards the hub's writes (Sync refuses them while it runs in
 * the project); `write` does the writing.
 */
export type CardWriter = (
  project: Project,
  write: () => Promise<LoadedCard>,
) => Promise<LoadedCard>;

/** The `--json-schema` answer of a new-options run (prompts.ts newOptionsSchema). */
const NewOptionsAnswer = z.object({
  message: z.string().trim().min(1),
  options: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
        pros: z.array(z.string()),
        cons: z.array(z.string()),
        details: z.string().optional(),
      }),
    )
    .min(1),
  recommendation: z.object({ option: z.string(), why: z.string() }),
});

/** Whether the card still waits for new options on the note recorded at `note`. */
function waitsOn(card: LoadedCard, note: string): boolean {
  return (
    card.frontmatter.status !== "resolved" &&
    card.frontmatter.needs_new_options === true &&
    lastNeither(card)?.at === note
  );
}

/** A reason as a clause after a colon: "The run failed." becomes "the run failed". */
function clause(text: string): string {
  const trimmed = text.trim().replace(/\.$/, "");
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed[0]?.toLowerCase() + trimmed.slice(1) : trimmed;
}

/** How long a copy is kept after its card or project was first found gone (202611114wet). */
export const KEEP_MISSING_MS = 30 * 24 * 3600 * 1000;
const CLEANUP_EVERY_MS = 24 * 3600 * 1000;

export interface ChatOptions {
  /** president's state folder (default `$XDG_STATE_HOME/president`). */
  stateDir?: string | undefined;
  /** The `claude` executable (default `claude` on PATH; tests pass a stand-in). */
  claudeBin?: string | undefined;
  /** Claude Code's folder, where its transcripts are (default `$CLAUDE_CONFIG_DIR` or ~/.claude). */
  claudeDir?: string | undefined;
  /** Environment of the runs (default: the hub's). */
  env?: NodeJS.ProcessEnv | undefined;
  timeoutMs?: number | undefined;
  now?: (() => Date) | undefined;
}

export interface SendInput {
  /** What the human typed (ignored when `ask` is given). */
  text?: string | undefined;
  /** A panel button's request (Teach me, More info) instead of typed text. */
  ask?: ChatAsk | undefined;
  /**
   * The page has revealed the card's pick (#0008's `r`) on the revision it sends; the
   * conversation is then free about that pick (20261111mby8).
   */
  revealed?: boolean | undefined;
  /** The card revision the page shows. */
  revision?: string | undefined;
}

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

const keyName = ({ project, id }: CardKey) => `${project}/${id}`;

export class ChatService {
  readonly store: ChatStore;
  readonly #registry: Registry;
  readonly #bus: EventBus;
  readonly #bin: string;
  readonly #claudeDir: string;
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #timeoutMs: number | undefined;
  readonly #now: () => Date;
  /** Cards with a run going on (a reply, a summary, new options): one at a time per card. */
  readonly #running = new Map<string, ChatRun | "summary" | "new">();
  /** Who waits for a card's run to end (#whenIdle). */
  readonly #waiters = new Map<string, (() => void)[]>();
  /**
   * New-options runs started and not ended (they may still wait for the card's other run),
   * by card. A message sent meanwhile goes to the session after the run (20261112160s).
   */
  readonly #newOptions = new Map<string, Promise<void>>();
  /** The runs in #running that are new-options runs (`running: "options"`). */
  readonly #optionRuns = new WeakSet<ChatRun>();
  /** One at a time per card: recording a note, starting its run, undoing it (20261112dfik). */
  readonly #runLock = new KeyedMutex();
  #writeCard: CardWriter = (_project, write) => write();
  /**
   * Cards whose run is starting a new session: Claude Code may not have written its
   * transcript yet, which doesn't mean it forgot the conversation.
   */
  readonly #starting = new Set<string>();
  /**
   * Card revisions written by saving a summary (or by Decide without summary), and the ids of
   * closes ("Close without summary", `close: true`), with what to put back if that is undone.
   * Only a close is undone with `reopen`; a card write is undone by undoing it (`undone`).
   */
  readonly #summaryWrites = new Map<
    string,
    { key: CardKey; before: SessionEntry | undefined; close: boolean }
  >();
  /** How many messages the summary last offered for a card covers. */
  readonly #offered = new Map<string, number>();
  readonly #abort = new AbortController();
  #cleanupTimer: NodeJS.Timeout | undefined;

  constructor(registry: Registry, bus: EventBus, options: ChatOptions = {}) {
    this.#registry = registry;
    this.#bus = bus;
    this.store = new ChatStore(options.stateDir ?? defaultStateDir());
    this.#bin = options.claudeBin ?? "claude";
    this.#claudeDir = options.claudeDir ?? defaultClaudeDir();
    this.#env = options.env;
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? (() => new Date());
  }

  /** How the new-options run writes the card (the app passes Sync's guard). */
  setCardWriter(writer: CardWriter): void {
    this.#writeCard = writer;
  }

  /** Cleans up now and once a day (202611114wet). */
  start(): void {
    const run = () =>
      this.cleanup().catch((error) => console.error("[chat] cleaning up conversations:", error));
    void run();
    this.#cleanupTimer = setInterval(run, CLEANUP_EVERY_MS);
    this.#cleanupTimer.unref();
  }

  /** Stops the runs in progress and waits for them to end. */
  async close(): Promise<void> {
    clearInterval(this.#cleanupTimer);
    this.#abort.abort();
    await Promise.all([
      ...[...this.#running.values()].map((run) => (typeof run === "string" ? undefined : run.done)),
      ...this.#newOptions.values(),
    ]);
  }

  async conversation(project: Project, id: string): Promise<ChatDto> {
    const key = { project: project.name, id };
    // Read before the copy and the record: a run that ends while they are read is still
    // reported as going on (the page reads again when it ends), never as over with what the
    // record said before it ended.
    const run = this.#running.get(keyName(key));
    // A new-options run counts from its start, also while it waits for a reply to end.
    const running: ChatDto["running"] =
      run === "summary"
        ? "summary"
        : run instanceof ChatRun && !this.#optionRuns.has(run)
          ? "reply"
          : this.#newOptions.has(keyName(key))
            ? "options"
            : false;
    const [messages, entry] = await Promise.all([this.store.messages(key), this.store.entry(key)]);
    const newOptions =
      entry?.newOptions && (await this.#visibleRun(project, key, entry.newOptions));
    return {
      messages,
      unsummarized: entry?.unsummarized === true,
      // "No longer remembers" only for a stored session whose transcript Claude Code no
      // longer has, never during a new session's first run (before its transcript exists).
      remembers:
        !entry?.session ||
        this.#starting.has(keyName(key)) ||
        (await transcriptExists(this.#claudeDir, entry.session)),
      running,
      ...(newOptions ? { newOptions } : {}),
    };
  }

  /**
   * The record of the card's new-options run as the page shows it: only while it is about the
   * card as it is now (the note is still the one the card waits on, or the options are still
   * the ones the hub wrote).
   */
  async #visibleRun(
    project: Project,
    key: CardKey,
    record: NewOptionsRecord,
  ): Promise<NewOptionsRunDto | undefined> {
    const found = await findCard(project, key.id).catch(() => undefined);
    if (!found?.ok) return undefined;
    const card = found.card;
    if (record.state === "written") {
      return record.options === optionsHash(card.frontmatter)
        ? { note: record.note, state: "written" }
        : undefined;
    }
    if (!waitsOn(card, record.note)) return undefined;
    if (
      record.state === "started" &&
      !this.#newOptions.has(keyName(key)) &&
      // Read again: the run may have ended (and saved how) while this was reading.
      (await this.store.entry(key))?.newOptions?.state === "started" &&
      !this.#newOptions.has(keyName(key))
    ) {
      // president stopped while it ran (the record is on disk, the run was in this process).
      return {
        note: record.note,
        state: "failed",
        error: "the run stopped when president was shut down",
      };
    }
    return {
      note: record.note,
      state: record.state,
      ...(record.error ? { error: record.error } : {}),
    };
  }

  /**
   * Sends the human's message to the card's session and returns the run, whose events the
   * caller streams. Refused while another run on the card is going on, except a new-options
   * run: the message then waits for it, so it reaches the session after the "Neither"
   * message (20261112160s).
   */
  async send(project: Project, id: string, input: SendInput): Promise<ChatRun> {
    let card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
    if (this.#newOptions.has(keyName(key))) {
      while (this.#newOptions.has(keyName(key))) await this.#newOptions.get(keyName(key));
      card = await this.#card(project, id);
    }
    const run = new ChatRun();
    this.#reserve(key, run);
    void this.#reply(project, card, key, input, run)
      .catch((error: unknown) => {
        console.error("[chat]", error);
        run.emit({
          type: "error",
          error: "internal error; see the server log",
          message: this.#message("hub", "No reply: internal error; see the server log."),
        });
      })
      .finally(() => {
        this.#release(key);
        this.#changed(key);
      });
    return run;
  }

  async #reply(
    project: Project,
    card: LoadedCard,
    key: CardKey,
    input: SendInput,
    run: ChatRun,
  ): Promise<void> {
    this.#changed(key);
    const entry = await this.store.entry(key);
    const revealedNow =
      input.revealed && input.revision === card.revision ? revealOf(card) : undefined;
    const save = async (message: ChatMessageDto) => {
      await this.store.append(key, message);
      run.emit({ type: "message", message });
    };

    // A button shows as its name in the conversation; the session gets its request.
    const shown = input.ask ? ASK_LABEL[input.ask] : (input.text ?? "");
    const request = input.ask ? askRequest(input.ask, card) : shown;
    const texts: string[] = [];
    const result = await this.#converse(project, card, key, entry, {
      text: request,
      revealedNow,
      notice: save,
      first: async () => {
        await save(this.#message("you", shown));
        // Unsummarized from the moment the message is in (#0024): leaving while the agent
        // thinks still gets the reminder.
        await this.store.updateEntry(key, (e) => ({ ...e, unsummarized: true }));
      },
      onText: (text) => {
        texts.push(text);
        run.emit({ type: "text", text });
      },
      onActivity: (text) => run.emit({ type: "activity", text }),
    });

    const text = texts.join("\n\n").trim() || result.text;
    let reply: ChatMessageDto | undefined;
    if (text) {
      reply = this.#message("agent", text);
      await this.store.append(key, reply);
      await this.store.updateEntry(key, (e) => ({ ...e, unsummarized: true }));
    }
    if (result.ok) {
      run.emit({ type: "done", message: reply });
    } else {
      const error = result.error ?? "The run failed.";
      const message = this.#message("hub", `No reply: ${error}`);
      await this.store.append(key, message);
      run.emit({ type: "error", error, message });
    }
  }

  /**
   * One turn of the card's session: resumes it, or starts one (with an id chosen up front,
   * kept in this machine's entry once Claude Code has it), starting over from the card and
   * its summaries when Claude Code no longer has the conversation or the human started a new
   * one (`fresh`, 20261112lvbu; its divider is already in the copy, so no notice). `first`
   * saves the human's message, after the start-over notice when there is one; `text` goes to
   * the session after the pick line.
   */
  async #converse(
    project: Project,
    card: LoadedCard,
    key: CardKey,
    entry: SessionEntry | undefined,
    turn: {
      text: string;
      /** The pick the page says the human revealed with this message (pickHash). */
      revealedNow: string | undefined;
      jsonSchema?: string;
      /** Saves a line from president (the start-over notice). */
      notice: (message: ChatMessageDto) => Promise<void>;
      first: () => Promise<void>;
      onText?: (text: string) => void;
      onActivity?: (text: string) => void;
    },
  ): Promise<RunResult> {
    const fresh = entry?.fresh === true;
    let resume =
      !fresh && entry?.session && (await transcriptExists(this.#claudeDir, entry.session));
    // A conversation existed (here, or on another machine: the card has its summaries) that
    // this session won't remember.
    const startsOver = () =>
      fresh || Boolean(entry?.session) || card.frontmatter.feedback.some((f) => f.type === "chat");
    let startOver = !resume && startsOver();
    if (startOver && !fresh) await turn.notice(this.#startOverNotice());
    await turn.first();

    let revealed = resume ? (turn.revealedNow ?? entry?.revealed) : turn.revealedNow;
    let entryWrite: Promise<unknown> = Promise.resolve();
    /**
     * The view asked for on a card without a pick (20261112irpn), while no answer has given it
     * yet: stored only once a run has, so a failed run leaves the next one asked for it too.
     */
    let viewAsked: string | undefined;
    const attempt = async (): Promise<RunResult> => {
      const session = resume && entry?.session ? entry.session : randomUUID();
      if (resume) this.#starting.delete(keyName(key));
      else this.#starting.add(keyName(key));
      // The first answer since the human asked for the agent's view on a card without a pick
      // gives it (20261112irpn); a structured answer (new options) can't, so it waits.
      const asksNow =
        turn.jsonSchema === undefined &&
        pickHash(card) === undefined &&
        isViewAsked(revealed) &&
        (!resume || entry?.revealed !== revealed);
      viewAsked = asksNow ? revealed : undefined;
      // What this machine's entry holds until then: the reveal, unless it is that view.
      const stored = asksNow ? (resume ? entry?.revealed : undefined) : revealed;
      const message = withPickLine(
        pickLine(card, revealed, asksNow),
        startOver ? `${startOverNote(card, fresh)}\n\n${turn.text}` : turn.text,
      );
      if (resume) {
        await this.store.updateEntry(key, (e) => ({
          ...e,
          session,
          ...(stored ? { revealed: stored } : {}),
        }));
      }
      return this.#run(
        {
          cwd: project.path,
          session: resume ? { resume: session } : { start: session },
          message,
          appendSystemPrompt: resume ? undefined : sessionInstructions(card),
          jsonSchema: turn.jsonSchema,
        },
        {
          // A new session replaces this machine's entry once Claude Code has it; a new
          // conversation starts neutral about the pick (it hasn't named it).
          onStarted: () => {
            if (resume) return;
            entryWrite = this.store
              .updateEntry(key, (e) => {
                const next: SessionEntry = { ...e, session };
                delete next.fresh;
                if (stored) next.revealed = stored;
                else delete next.revealed;
                return next;
              })
              .catch((error) => console.error("[chat]", error));
          },
          ...(turn.onText ? { onText: turn.onText } : {}),
          ...(turn.onActivity ? { onActivity: turn.onActivity } : {}),
        },
      );
    };

    let result = await attempt();
    if (!result.ok && resume && result.sessionNotFound) {
      // Claude Code deleted it between the check and the run.
      resume = false;
      revealed = turn.revealedNow;
      startOver = true;
      await turn.notice(this.#startOverNotice());
      result = await attempt();
    }
    // The new session's entry is written before the run is reported done.
    await entryWrite;
    // The view was given: later messages are free, not asked for it again.
    const given = viewAsked;
    if (result.ok && given) {
      await this.store.updateEntry(key, (e) => ({ ...e, revealed: given }));
    }
    return result;
  }

  /**
   * The human said "neither" and asked for new options (#0007): the hub records the run as
   * "to start" (20261112160s). Nothing reaches the session until a page starts it.
   */
  async newOptionsAsked(project: Project, card: LoadedCard): Promise<void> {
    const note = lastNeither(card);
    if (!note) return;
    const key = { project: project.name, id: card.id };
    await this.#runLock.run(keyName(key), () =>
      this.store.updateEntry(key, (e) => ({
        ...e,
        newOptions: { note: note.at, state: "to-start" },
      })),
    );
    this.#changed(key);
  }

  /**
   * Undoes a card action (`undo`, given the check to pass to undoLastAction) one after the
   * other with starting runs: a "neither" whose run already started is refused (20261112dfik
   * `refuse-undo`), and one undone in time loses its "to start" record, so no run ever starts
   * for it. Only the record for the note being undone counts: one left for another note
   * (a stale one, or an earlier note's when recording this one failed) never refuses it.
   */
  async undoing<T>(
    project: Project,
    id: string,
    undo: (check: (action: CardActionType, card: LoadedCard) => void) => Promise<T>,
  ): Promise<T> {
    const key = { project: project.name, id };
    return this.#runLock.run(keyName(key), async () => {
      const stored = (await this.store.entry(key))?.newOptions;
      let record: NewOptionsRecord | undefined;
      const result = await undo((action, card) => {
        if (action !== "neither") return;
        record = stored && stored.note === lastNeither(card)?.at ? stored : undefined;
        if (record && record.state !== "to-start") {
          throw new UserError("the run for this note already started from another tab", {
            status: 409,
            code: "run_started",
          });
        }
      });
      if (record) {
        await this.#clearRecord(key, record.note);
        this.#changed(key);
      }
      return result;
    });
  }

  /**
   * Starts the run that writes new options from the note recorded at `input.note`: when the
   * page's Undo notice closes (`from: "undo-closed"`), on Start now in another page
   * (20261112dfik), or on Try again after a failed run (202611111gpm). Starts at most one run
   * per note, and none for a note undone or no longer the one the card waits on; `started:
   * false` then. The notice closing starts only a run still "to start", never a retry: there
   * is no automatic retry. The run itself goes on after this returns.
   */
  async startNewOptions(
    project: Project,
    id: string,
    input: {
      note: string;
      from?: "undo-closed" | undefined;
      revealed?: boolean | undefined;
      revision?: string | undefined;
    },
  ): Promise<StartNewOptionsResponse> {
    const card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
    const k = keyName(key);
    return this.#runLock.run(k, async () => {
      const current = await this.#card(project, id);
      const entry = await this.store.entry(key);
      const record = entry?.newOptions;
      if (
        !record ||
        record.note !== input.note ||
        record.state === "written" ||
        (input.from === "undo-closed" && record.state !== "to-start") ||
        // Going on now. A "started" record without a run is one president was shut down
        // during: it can be tried again.
        this.#newOptions.has(k) ||
        !waitsOn(current, record.note)
      ) {
        return { started: false };
      }
      const revealedNow =
        input.revealed && input.revision === current.revision ? revealOf(current) : undefined;
      const retry =
        record.state === "failed"
          ? record.error
          : record.state === "started"
            ? "the run stopped when president was shut down"
            : undefined;
      let done!: () => void;
      this.#newOptions.set(
        k,
        new Promise<void>((resolve) => {
          done = resolve;
        }),
      );
      try {
        await this.store.updateEntry(key, (e) => ({
          ...e,
          newOptions: { note: record.note, state: "started" },
        }));
      } catch (error) {
        this.#newOptions.delete(k);
        done();
        throw error;
      }
      void this.#writeNewOptions(project, key, record.note, retry, revealedNow)
        .catch(async (error: unknown) => {
          console.error("[chat]", error);
          await this.#newOptionsFailed(key, record.note, "internal error; see the server log");
        })
        .finally(() => {
          this.#newOptions.delete(k);
          done();
          this.#changed(key);
        });
      this.#changed(key);
      return { started: true };
    });
  }

  async #writeNewOptions(
    project: Project,
    key: CardKey,
    note: string,
    retry: string | undefined,
    revealedNow: string | undefined,
  ): Promise<void> {
    await this.#whenIdle(key);
    const run = new ChatRun();
    this.#optionRuns.add(run);
    this.#reserve(key, run);
    try {
      const card = await this.#card(project, key.id);
      const neither = lastNeither(card);
      // Decided, undone or rewritten by an agent while the run waited: nothing to write.
      if (!neither || !waitsOn(card, note)) {
        await this.#clearRecord(key, note);
        return;
      }
      const entry = await this.store.entry(key);
      const save = async (message: ChatMessageDto) => {
        await this.store.append(key, message);
        this.#changed(key);
      };
      const result = await this.#converse(project, card, key, entry, {
        text: newOptionsRequest(card, neither, retry),
        revealedNow,
        jsonSchema: JSON.stringify(newOptionsSchema(card)),
        notice: save,
        first: () =>
          save(
            retry
              ? this.#message(
                  "hub",
                  `Trying again to write new options from your note at ${neither.at}.`,
                )
              : this.#message("you", `Neither: ${neither.note}`),
          ),
      });

      let failure: string | undefined;
      let written: LoadedCard | undefined;
      let message = "";
      if (!result.ok) {
        failure = clause(result.error ?? "the run failed");
      } else {
        const answer = NewOptionsAnswer.safeParse(result.structured);
        if (!answer.success) {
          failure =
            result.structured === undefined
              ? "the agent answered without the options"
              : "the agent's answer wasn't in the expected form";
        } else {
          message = answer.data.message.trim();
          try {
            const content = newCardContent(card, answer.data);
            written = await this.#writeCard(project, () =>
              rewriteCard(project, key.id, card, content),
            );
          } catch (error) {
            if (!(error instanceof UserError)) throw error;
            failure = clause(error.message);
          }
        }
      }

      if (written) {
        const hash = optionsHash(written.frontmatter);
        await this.store.append(
          key,
          this.#message("agent", `${message}\n\n(The options are now on the card.)`),
        );
        // A run doesn't make the conversation "not summarized" (202611111gpm
        // `shown-no-reminder`), and a pick revealed before is not the new one (2026111272fu).
        // A view asked for on the card without a pick (20261112irpn) reveals nothing about the
        // new options either: the chat is neutral about them until r, with no word of an
        // earlier pick, since there was none.
        await this.store.updateEntry(key, (e) => {
          const next: SessionEntry = {
            ...e,
            newOptions: { note, state: "written", options: hash },
          };
          if (isViewAsked(e?.revealed)) delete next.revealed;
          else if (e?.revealed) next.revealed = "replaced";
          return next;
        });
        this.#bus.emit({ type: "cards", project: project.name });
      } else {
        await this.#newOptionsFailed(key, note, failure ?? "the run failed");
      }
    } finally {
      run.emit({ type: "done", message: undefined });
      this.#release(key);
    }
  }

  async #newOptionsFailed(key: CardKey, note: string, error: string): Promise<void> {
    await this.store.append(key, this.#message("hub", newOptionsFailure(error)));
    await this.store.updateEntry(key, (e) =>
      e?.newOptions?.note === note ? { ...e, newOptions: { note, state: "failed", error } } : e,
    );
  }

  async #clearRecord(key: CardKey, note: string): Promise<void> {
    await this.store.updateEntry(key, (e) => {
      if (e?.newOptions?.note !== note) return e;
      const { newOptions: _, ...rest } = e;
      return rest;
    });
  }

  /**
   * New conversation (20261112lvbu `choose`): ends the card's session on this machine. The
   * next message starts a new one from the card and its saved summaries, as when `--resume`
   * can't find the session, with a new session id; the pick it revealed is forgotten, so the
   * new one is neutral again unless a saved summary names it. The copy keeps the earlier
   * messages, followed by a divider; what they leave unsummarized stays so (the next summary
   * is written from the copy). Nothing happens without a conversation, or right after a
   * divider. Refused while a run is going on.
   */
  async newConversation(project: Project, id: string): Promise<ChatDto> {
    const card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
    if (this.#newOptions.has(keyName(key))) {
      throw new UserError("new options are being written on this card; wait for them", {
        status: 409,
        code: "chat_busy",
      });
    }
    this.#reserve(key, "new");
    try {
      const messages = await this.store.messages(key);
      const last = messages.at(-1);
      if (last && !isNewConversation(last)) {
        await this.store.updateEntry(key, (entry) => {
          const next: SessionEntry = { ...entry, fresh: true };
          delete next.session;
          delete next.revealed;
          return next;
        });
        await this.store.append(key, this.#message("hub", NEW_CONVERSATION));
      }
    } finally {
      this.#release(key);
      this.#changed(key);
    }
    return this.conversation(project, card.id);
  }

  /**
   * Has the session write a summary of the messages after the last saved summary, and returns
   * it for the human to edit. Nothing is saved.
   */
  async summarize(
    project: Project,
    id: string,
    input: Omit<SendInput, "text">,
  ): Promise<ChatSummaryResponse> {
    const card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
    this.#reserve(key, "summary");
    this.#changed(key);
    try {
      const [entry, messages] = await Promise.all([
        this.store.entry(key),
        this.store.messages(key),
      ]);
      const since = Math.min(entry?.summarized ?? 0, messages.length);
      const unsaid = messages.slice(since).filter((m) => m.from !== "hub");
      if (unsaid.length === 0) {
        throw new UserError("there is nothing new in this conversation to summarize", {
          status: 409,
          code: "nothing_to_summarize",
        });
      }
      const revealedNow =
        input.revealed && input.revision === card.revision ? revealOf(card) : undefined;
      const line = pickLine(card, revealedNow ?? entry?.revealed);
      // Messages to cover from before a New conversation (20261112lvbu): the session now
      // resumed never had them, so the summary is written from the copy.
      const divider = messages.findLastIndex(isNewConversation);
      const spans = divider > since && messages.slice(since, divider).some((m) => m.from !== "hub");
      let result: RunResult | undefined;
      let fromCopy = true;
      if (!spans && entry?.session && (await transcriptExists(this.#claudeDir, entry.session))) {
        fromCopy = false;
        result = await this.#run({
          cwd: project.path,
          session: { resume: entry.session },
          message: withPickLine(line, summaryRequest(since > 0)),
        });
        if (!result.ok && result.sessionNotFound) {
          fromCopy = true;
          result = undefined;
        }
      }
      result ??= await this.#run({
        cwd: project.path,
        session: { oneOff: true },
        message: withPickLine(line, summaryFromCopy(card, messages.slice(since), since > 0)),
        appendSystemPrompt: sessionInstructions(card),
      });
      const summary = result.text.trim();
      if (!result.ok || !summary) {
        throw new UserError(
          `Couldn't write the summary: ${result.error ?? "the agent wrote nothing."}`,
          {
            status: 422,
            code: "summary_failed",
          },
        );
      }
      this.#offered.set(keyName(key), messages.length);
      return { summary, fromCopy };
    } finally {
      this.#release(key);
      this.#changed(key);
    }
  }

  /**
   * Ends the conversation without a summary ("Close without summary" in the summary box;
   * 202611111ky9 `remind`: the reminder lasts "until you close the conversation, saving its
   * summary or not"). Nothing is written to the card. The messages so far stay in the hub's
   * copy, and the next summary covers only what comes after them.
   *
   * `decision`: the revision of a decision made with "Decide without summary", which closes
   * the conversation too (20261112hq3k `ends`); undoing that decision (`undone`) reopens it.
   * Without it, the close is undone with `reopen` and the returned `closed`.
   */
  async closeWithoutSummary(
    project: Project,
    id: string,
    options: { decision?: string } = {},
  ): Promise<ChatCloseResponse> {
    const card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
    // A decision is already written: a reply still coming in is left to mark itself.
    if (options.decision === undefined && this.#running.has(keyName(key))) {
      throw this.#busy(key);
    }
    let before: SessionEntry | undefined;
    await this.store.updateEntry(key, async (entry) => {
      before = entry;
      if (!entry) return entry;
      // Counted under the entry's lock, as in summarySaved.
      const messages = await this.store.messages(key);
      const next: SessionEntry = { ...entry, summarized: messages.length };
      delete next.unsummarized;
      return next;
    });
    this.#offered.delete(keyName(key));
    const closed = options.decision ?? randomUUID();
    // A close made by a decision is undone with the decision, never with `reopen`.
    if (before) this.#remember(closed, key, before, options.decision === undefined);
    this.#changed(key);
    return { chat: await this.conversation(project, card.id), closed };
  }

  /**
   * Undoes `closeWithoutSummary` (its notice's Undo): the conversation is "not summarized"
   * again, and the next summary covers what it covered before the close.
   */
  async reopen(project: Project, id: string, closed: string): Promise<ChatDto> {
    const card = await this.#card(project, id);
    const write = this.#summaryWrites.get(closed);
    if (!write?.close || write.key.project !== project.name || write.key.id !== card.id) {
      throw new UserError("this close can no longer be undone", {
        status: 409,
        code: "not_undoable",
      });
    }
    await this.undone(closed);
    return this.conversation(project, card.id);
  }

  /**
   * A summary was saved on the card (the `chat` action, or a decision carrying one), which
   * wrote `revision`: the conversation counts as summarized up to the messages that summary
   * was written from.
   */
  async summarySaved(project: Project, id: string, revision: string): Promise<void> {
    const key = { project: project.name, id };
    const offered = this.#offered.get(keyName(key));
    this.#offered.delete(keyName(key));
    let before: SessionEntry | undefined;
    await this.store.updateEntry(key, async (entry) => {
      before = entry;
      // Counted under the entry's lock: a message saved in between keeps its mark.
      const messages = await this.store.messages(key);
      const through = offered ?? messages.length;
      const covered = Math.min(through, messages.length);
      const next: SessionEntry = { ...entry, summarized: covered };
      // A message sent while the summary was being edited is still not summarized; hub lines
      // (a New conversation's divider, 20261112lvbu) are nothing to summarize.
      if (messages.slice(covered).every((m) => m.from === "hub")) delete next.unsummarized;
      return next;
    });
    this.#remember(revision, key, before, false);
    this.#changed(key);
  }

  /** What an undo of `write` (a card revision, or a close's id) puts back; the last 200. */
  #remember(write: string, key: CardKey, before: SessionEntry | undefined, close: boolean): void {
    this.#summaryWrites.set(write, { key, before, close });
    if (this.#summaryWrites.size > 200) {
      this.#summaryWrites.delete(this.#summaryWrites.keys().next().value as string);
    }
  }

  /**
   * An undo took back the write that produced `revision`; a summary in it is unsaved again,
   * and a close in it (Decide without summary, or `reopen`) is undone.
   */
  async undone(revision: string): Promise<void> {
    const write = this.#summaryWrites.get(revision);
    if (!write) return;
    this.#summaryWrites.delete(revision);
    await this.store.updateEntry(write.key, (entry) => {
      const next: SessionEntry = { ...entry };
      if (write.before?.unsummarized) next.unsummarized = true;
      if (write.before?.summarized === undefined) delete next.summarized;
      else next.summarized = write.before.summarized;
      return next;
    });
    this.#changed(write.key);
  }

  /**
   * Deletes what is kept for cards whose card file or project has been gone for 30 days, and
   * forgets the date for those that came back (202611114wet `with-card`).
   */
  async cleanup(): Promise<void> {
    const now = this.#now();
    const projects = new Map((await this.#registry.list()).map((p) => [p.name, p]));
    const idsByProject = new Map<string, Set<string> | "unknown" | undefined>();
    for (const key of await this.store.keys()) {
      const project = projects.get(key.project);
      let exists = false;
      if (project) {
        if (!idsByProject.has(project.name)) {
          idsByProject.set(project.name, await cardIds(project));
        }
        const ids = idsByProject.get(project.name);
        // The folder can't be read right now (permissions, ...): no verdict either way.
        if (ids === "unknown") continue;
        exists = ids?.has(key.id) ?? false;
      }
      const since = await this.store.missingSince(key);
      if (exists) {
        if (since) await this.store.setMissingSince(key, undefined);
      } else if (!since) {
        await this.store.setMissingSince(key, timestamp(now));
      } else if (now.getTime() - Date.parse(since) >= KEEP_MISSING_MS) {
        if (!this.#running.has(keyName(key))) await this.store.forget(key);
      }
    }
  }

  async #card(project: Project, id: string): Promise<LoadedCard> {
    const found = await findCard(project, id);
    if (!found.ok) {
      throw new UserError(`card "${id}" is broken; fix it before talking about it`, {
        status: 422,
        details: found.broken.errors,
      });
    }
    return found.card;
  }

  #reserve(key: CardKey, run: ChatRun | "summary" | "new"): void {
    if (this.#running.has(keyName(key))) throw this.#busy(key);
    this.#running.set(keyName(key), run);
  }

  /** Why the card refuses another run: what holds it. */
  #busy(key: CardKey): UserError {
    const message =
      this.#running.get(keyName(key)) === "new"
        ? "a new conversation is being started on this card; try again in a moment"
        : "the agent is still answering on this card; wait for it to finish";
    return new UserError(message, { status: 409, code: "chat_busy" });
  }

  /** The card's run (a reply, a summary) ended: the next one may start. */
  #release(key: CardKey): void {
    this.#running.delete(keyName(key));
    this.#starting.delete(keyName(key));
    const waiting = this.#waiters.get(keyName(key)) ?? [];
    this.#waiters.delete(keyName(key));
    for (const wake of waiting) wake();
  }

  /** Waits until no run is going on for the card; reserve right after, with no await between. */
  async #whenIdle(key: CardKey): Promise<void> {
    while (this.#running.has(keyName(key))) {
      await new Promise<void>((resolve) => {
        const list = this.#waiters.get(keyName(key)) ?? [];
        list.push(resolve);
        this.#waiters.set(keyName(key), list);
      });
    }
  }

  #run(
    request: Pick<RunRequest, "cwd" | "session" | "message" | "appendSystemPrompt" | "jsonSchema">,
    handlers: Parameters<typeof runClaude>[1] = {},
  ): Promise<RunResult> {
    return runClaude(
      {
        ...request,
        bin: this.#bin,
        env: this.#env,
        timeoutMs: this.#timeoutMs,
        signal: this.#abort.signal,
      },
      handlers,
    );
  }

  #message(from: ChatMessageDto["from"], text: string): ChatMessageDto {
    return { at: this.#now().toISOString(), from, text };
  }

  #startOverNotice(): ChatMessageDto {
    return this.#message(
      "hub",
      "The earlier conversation on this card isn't available on this machine; this one starts from the card and its summaries.",
    );
  }

  #changed(key: CardKey): void {
    this.#bus.emit({ type: "chat", project: key.project, id: key.id });
  }
}

/**
 * The ids of the card files in the project's decisions/ (undefined: the folder is gone, as on
 * another branch; "unknown": it can't be read).
 */
async function cardIds(project: Project): Promise<Set<string> | "unknown" | undefined> {
  try {
    const names = await readdir(decisionsDirOf(project));
    const ids = new Set<string>();
    for (const name of names) {
      if (isIgnoredFile(name)) continue;
      const parsed = parseCardFileName(name);
      if (parsed) ids.add(parsed.id);
    }
    return ids;
  } catch (error) {
    return isNotFound(error) ? undefined : "unknown";
  }
}

/** Whether `markdown` has a `<!--` with no later `-->`, outside code fences. */
function unclosedHtmlComment(markdown: string): boolean {
  // Fences follow the section splitter's rules (FENCE_OPEN/FENCE_CLOSE), so the two agree.
  let fence: string | null = null;
  let open = false;
  for (const line of markdown.split("\n")) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      continue;
    }
    if (!open) {
      const marker = FENCE_OPEN.exec(line)?.[1];
      if (marker) {
        fence = marker;
        continue;
      }
    }
    let at = 0;
    while (at < line.length) {
      if (open) {
        const end = line.indexOf("-->", at);
        if (end < 0) break;
        at = end + 3;
        open = false;
        continue;
      }
      const comment = line.indexOf("<!--", at);
      if (comment < 0) break;
      // An inline code span (a backtick run closed by an equal run on the line) before the
      // comment hides what it holds; an unmatched run is literal text.
      const tick = /`+/g;
      tick.lastIndex = at;
      const run = tick.exec(line);
      if (run && run.index < comment) {
        const closer = new RegExp(`(?<!\`)${run[0]}(?!\`)`, "g");
        closer.lastIndex = run.index + run[0].length;
        const shut = closer.exec(line);
        at = shut ? shut.index + run[0].length : run.index + run[0].length;
        continue;
      }
      at = comment + 4;
      open = true;
    }
  }
  return open;
}

/**
 * The card with the run's options (#0007): `options`, their `## Option` sections and
 * `recommendation` replaced, `needs_new_options` removed; everything else as the run read it.
 * The answer is model-written, so it must stay inside its sections: ids, titles and summaries
 * on one line, the option count the card's kind takes, and `details` that neither end their
 * section (its level-2 headings become level 3) nor run past it (an unclosed code fence). An
 * option without details (left out or blank) gets no section, so cards stay short. The new
 * body is read back to check that: exactly the sections with details, and the context and the
 * appendix (`## Sources`, notes) as they were. Otherwise a UserError says what was wrong.
 */
function newCardContent(
  card: LoadedCard,
  answer: z.output<typeof NewOptionsAnswer>,
): { raw: RawFrontmatter; body: string } {
  const refuse = (problem: string): never => {
    throw new UserError(`the agent's options didn't pass the card checks (${problem})`, {
      status: 422,
      code: "invalid_card",
    });
  };
  const { min, max } = optionCount(card);
  const count = answer.options.length;
  if (count < min || count > max) {
    const takes = min === max ? `${min}` : `${min} to ${max}`;
    refuse(`it wrote ${count} option${count === 1 ? "" : "s"}; this card takes ${takes}`);
  }
  const multiline = (text: string) => /[\r\n\u2028\u2029]/.test(text);
  for (const option of answer.options) {
    if (multiline(option.id) || multiline(option.title) || multiline(option.summary)) {
      refuse("an option's id, title or summary has a line break in it");
    }
  }
  if (multiline(answer.recommendation.option)) refuse("the pick has a line break in it");

  const raw: RawFrontmatter = {
    ...card.raw,
    options: answer.options.map(({ id, title, summary, pros, cons }) => ({
      id,
      title,
      summary,
      pros,
      cons,
    })),
    recommendation: answer.recommendation,
  };
  delete raw.needs_new_options;
  // Every line ending as "\n", so no lone "\r" (or U+2028/U+2029) hides a heading or a fence.
  const details = answer.options.map((option) =>
    (option.details ?? "").replace(/\r\n?|[\u2028\u2029]/g, "\n"),
  );
  if (details.some(unclosedHtmlComment)) refuse("an option's details open an HTML comment");
  const sections = answer.options
    .map((option, i) => ({
      id: option.id,
      title: option.title.trim(),
      markdown: demoteSectionHeadings(details[i] ?? "").trim(),
    }))
    .filter((section) => section.markdown !== "");
  const body = replaceOptionSections(card.body, sections);

  // Read back: exactly the sections with details, and the rest of the body as it was. When
  // the old option sections were removed and none written, a body without option sections
  // may split its text between context and appendix at another heading (a second context
  // section), so only the text, with the spaces at its line ends, must be the same. Such a
  // second section then shows below the options, and the card's changes say the context
  // and the notes below the options changed: accepted, since cards keep one context section.
  const before = splitSections(card.body);
  const after = splitSections(body);
  const rest = (s: BodySections) =>
    [s.context, s.appendix]
      .filter((t) => t !== "")
      .join("\n\n")
      .replace(/[ \t]+$/gm, "");
  const restKept =
    (after.context === before.context && after.appendix === before.appendix) ||
    (sections.length === 0 && before.options.length > 0 && rest(after) === rest(before));
  const same =
    restKept &&
    after.options.length === sections.length &&
    after.options.every((written, i) => {
      const wanted = sections[i];
      return (
        wanted !== undefined &&
        written.id === wanted.id &&
        (written.heading ?? "") === wanted.title &&
        written.markdown === wanted.markdown
      );
    });
  if (!same) {
    refuse("an option's text runs outside its section, for example an unclosed code fence");
  }
  return { raw, body };
}
