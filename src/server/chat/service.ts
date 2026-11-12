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
 * - Summaries: the session writes one (or, when Claude Code deleted it, a fresh one-off
 *   session reads the hub's copy, 20261111paot); nothing is saved until the human saves it
 *   as a `chat` card action, which goes through the card API like any other write.
 * - The hub's copy is kept as long as its card exists: once the card or its project has been
 *   gone for 30 days, it is deleted (202611114wet `with-card`), at start and once a day.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { timestamp } from "../../core/actions.ts";
import type {
  ChatDto,
  ChatMessageDto,
  ChatStreamEvent,
  ChatSummaryResponse,
} from "../../core/api.ts";
import { parseCardFileName } from "../../core/card-file.ts";
import { findCard, isIgnoredFile, type LoadedCard } from "../cards.ts";
import { UserError } from "../errors.ts";
import { isNotFound } from "../fs-utils.ts";
import { decisionsDirOf, type Project, type Registry } from "../registry.ts";
import type { EventBus } from "../watcher.ts";
import {
  pickHash,
  pickLine,
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
import { type CardKey, ChatStore, defaultStateDir, type SessionEntry } from "./store.ts";

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
  text: string;
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
  /** Cards with a run going on (a reply or a summary): one at a time per card. */
  readonly #running = new Map<string, ChatRun | "summary">();
  /**
   * Cards whose run is starting a new session: Claude Code may not have written its
   * transcript yet, which doesn't mean it forgot the conversation.
   */
  readonly #starting = new Set<string>();
  /** Card revisions written by saving a summary, with what to put back if that is undone. */
  readonly #summaryWrites = new Map<string, { key: CardKey; before: SessionEntry | undefined }>();
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
    await Promise.all(
      [...this.#running.values()].map((run) => (run === "summary" ? undefined : run.done)),
    );
  }

  async conversation(project: Project, id: string): Promise<ChatDto> {
    const key = { project: project.name, id };
    const [messages, entry] = await Promise.all([this.store.messages(key), this.store.entry(key)]);
    return {
      messages,
      unsummarized: entry?.unsummarized === true,
      // "No longer remembers" only for a stored session whose transcript Claude Code no
      // longer has, never during a new session's first run (before its transcript exists).
      remembers:
        !entry?.session ||
        this.#starting.has(keyName(key)) ||
        (await transcriptExists(this.#claudeDir, entry.session)),
      running: this.#running.has(keyName(key)),
    };
  }

  /**
   * Sends the human's message to the card's session and returns the run, whose events the
   * caller streams. Refused while another run on the card is going on.
   */
  async send(project: Project, id: string, input: SendInput): Promise<ChatRun> {
    const card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
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
        this.#running.delete(keyName(key));
        this.#starting.delete(keyName(key));
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
      input.revealed && input.revision === card.revision ? pickHash(card) : undefined;
    const save = async (message: ChatMessageDto) => {
      await this.store.append(key, message);
      run.emit({ type: "message", message });
    };

    let resume = entry?.session && (await transcriptExists(this.#claudeDir, entry.session));
    // A conversation existed (here, or on another machine: the card has its summaries) that
    // this session won't remember.
    const startsOver = () =>
      Boolean(entry?.session) || card.frontmatter.feedback.some((f) => f.type === "chat");
    let startOver = !resume && startsOver();
    if (startOver) await save(this.#startOverNotice());
    await save(this.#message("you", input.text));

    let revealed = resume ? (revealedNow ?? entry?.revealed) : revealedNow;
    const texts: string[] = [];
    let entryWrite: Promise<unknown> = Promise.resolve();
    const attempt = async (): Promise<RunResult> => {
      const session = resume && entry?.session ? entry.session : randomUUID();
      if (resume) this.#starting.delete(keyName(key));
      else this.#starting.add(keyName(key));
      const message = withPickLine(
        pickLine(card, revealed),
        startOver ? `${startOverNote(card)}\n\n${input.text}` : input.text,
      );
      if (resume) {
        await this.store.updateEntry(key, (e) => ({
          ...e,
          session,
          ...(revealed ? { revealed } : {}),
        }));
      }
      return this.#run(
        {
          cwd: project.path,
          session: resume ? { resume: session } : { start: session },
          message,
          appendSystemPrompt: resume ? undefined : sessionInstructions(card),
        },
        {
          // A new session replaces this machine's entry once Claude Code has it; a new
          // conversation starts neutral about the pick (it hasn't named it).
          onStarted: () => {
            if (resume) return;
            entryWrite = this.store
              .updateEntry(key, (e) => {
                const next: SessionEntry = { ...e, session };
                if (revealed) next.revealed = revealed;
                else delete next.revealed;
                return next;
              })
              .catch((error) => console.error("[chat]", error));
          },
          onText: (text) => {
            texts.push(text);
            run.emit({ type: "text", text });
          },
          onActivity: (text) => run.emit({ type: "activity", text }),
        },
      );
    };

    let result = await attempt();
    if (!result.ok && resume && result.sessionNotFound) {
      // Claude Code deleted it between the check and the run.
      resume = false;
      revealed = revealedNow;
      startOver = true;
      await save(this.#startOverNotice());
      result = await attempt();
    }
    // The new session's entry is written before the run is reported done.
    await entryWrite;

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
        input.revealed && input.revision === card.revision ? pickHash(card) : undefined;
      const line = pickLine(card, revealedNow ?? entry?.revealed);
      let result: RunResult | undefined;
      let fromCopy = true;
      if (entry?.session && (await transcriptExists(this.#claudeDir, entry.session))) {
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
      this.#running.delete(keyName(key));
      this.#changed(key);
    }
  }

  /**
   * A summary was saved on the card (the `chat` action, or a decision carrying one), which
   * wrote `revision`: the conversation counts as summarized up to the messages that summary
   * was written from.
   */
  async summarySaved(project: Project, id: string, revision: string): Promise<void> {
    const key = { project: project.name, id };
    const messages = await this.store.messages(key);
    const through = this.#offered.get(keyName(key)) ?? messages.length;
    this.#offered.delete(keyName(key));
    let before: SessionEntry | undefined;
    await this.store.updateEntry(key, (entry) => {
      before = entry;
      const covered = Math.min(through, messages.length);
      const next: SessionEntry = { ...entry, summarized: covered };
      // A message sent while the summary was being edited is still not summarized.
      if (covered >= messages.length) delete next.unsummarized;
      return next;
    });
    this.#summaryWrites.set(revision, { key, before });
    if (this.#summaryWrites.size > 200) {
      this.#summaryWrites.delete(this.#summaryWrites.keys().next().value as string);
    }
    this.#changed(key);
  }

  /** An undo took back the write that produced `revision`; a summary in it is unsaved again. */
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

  #reserve(key: CardKey, run: ChatRun | "summary"): void {
    if (this.#running.has(keyName(key))) {
      throw new UserError("the agent is still answering on this card; wait for it to finish", {
        status: 409,
        code: "chat_busy",
      });
    }
    this.#running.set(keyName(key), run);
  }

  #run(
    request: Pick<RunRequest, "cwd" | "session" | "message" | "appendSystemPrompt">,
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
