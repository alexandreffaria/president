/**
 * Card conversations: a headless Claude Code session per card, run in the card's project
 * folder with #0004's read-only flags (runner.ts), and the per-machine stores that go with
 * it (store.ts).
 *
 * - Each card has at most one session on this machine (#0021); its id is chosen up front
 *   (`--session-id`) and kept in the session store, never in the card. Chatting never writes
 *   the card file.
 * - A new session starts as a fork of the session that wrote the card (`created_session`,
 *   `--resume <it> --fork-session --session-id <new id>`) when this machine's Claude Code
 *   still has it and it held at most MAX_FORK_TOKENS (runner.ts: a fork must fit the run's $1
 *   cap), so the chat knows what the author researched and ruled out; the author's
 *   session is untouched. Its first message carries the chat's instructions (forkIntro),
 *   since a fork keeps the author's system prompt. Otherwise, or when the author's session
 *   goes just before the run, it starts from the card alone, as it always did.
 * - Each message the hub showed is kept in its own copy (#0018) for showing the conversation
 *   again after a reload or a restart; continuing always resumes Claude Code's session.
 * - When Claude Code no longer has the session (another machine, or after
 *   `cleanupPeriodDays`), the next message starts a fresh one from the card and its
 *   summaries (a fork of the author's session, when there is one), the page says so, and the
 *   entry is replaced.
 * - Your next message resumes the same session by default; New conversation (20261112lvbu
 *   `choose`) ends it, and the next message starts a new one the same way, with a new id,
 *   neutral about the pick again (a new fork of the author's session, when there is one: it
 *   never saw the earlier conversation). The copy keeps the earlier messages, above a divider.
 * - Summaries: the session writes one (or, when Claude Code deleted it, a fresh one-off
 *   session reads the hub's copy, 20261111paot); nothing is saved until the human saves it
 *   as a `chat` card action, which goes through the card API like any other write.
 * - The hub's copy is kept as long as its card exists: once the card or its project has been
 *   gone for 30 days, it is deleted (202611114wet `with-card`), at start and once a day.
 */
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { timestamp } from "../../core/actions.ts";
import {
  type ChatAsk,
  type ChatCloseResponse,
  type ChatDto,
  type ChatMessageDto,
  type ChatSummaryResponse,
  isNewConversation,
  NEW_CONVERSATION,
  type StartNewOptionsResponse,
} from "../../core/api.ts";
import { parseCardFileName } from "../../core/card-file.ts";
import { findCard, isIgnoredFile, type LoadedCard } from "../cards.ts";
import { checkoutsOf } from "../checkouts.ts";
import { UserError } from "../errors.ts";
import { isNotFound } from "../fs-utils.ts";
import { decisionsDirOf, type Project, type Registry } from "../registry.ts";
import type { EventBus } from "../watcher.ts";
import { type CardWriter, NewOptionsRuns } from "./new-options.ts";
import {
  ASK_LABEL,
  askRequest,
  forkIntro,
  isViewAsked,
  pickHash,
  pickLine,
  revealOf,
  sessionInstructions,
  startOverNote,
  withPickLine,
} from "./prompts.ts";
import {
  contextTokens,
  defaultClaudeDir,
  MAX_FORK_TOKENS,
  type RunRequest,
  type RunResult,
  runClaude,
  transcriptExists,
  transcriptPath,
} from "./runner.ts";
import { CardRuns, ChatRun, keyName } from "./runs.ts";
import { type CardKey, ChatStore, defaultStateDir, type SessionEntry } from "./store.ts";
import { Summaries } from "./summaries.ts";

export type { CardWriter } from "./new-options.ts";

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

/** One turn of the card's session (ChatService #converse). */
export interface Turn {
  text: string;
  /** The pick the page says the human revealed with this message (pickHash). */
  revealedNow: string | undefined;
  jsonSchema?: string;
  /** Stops the run, besides the hub shutting down. */
  signal?: AbortSignal;
  /** Saves a line from president (the start-over notice). */
  notice: (message: ChatMessageDto) => Promise<void>;
  first: () => Promise<void>;
  onText?: (text: string) => void;
  onActivity?: (text: string) => void;
}

/** What ChatService shares with new-options.ts and summaries.ts. */
export interface ChatHost {
  readonly store: ChatStore;
  readonly runs: CardRuns;
  readonly bus: EventBus;
  /** Claude Code's folder, where its transcripts are. */
  readonly claudeDir: string;
  card(project: Project, id: string): Promise<LoadedCard>;
  conversation(project: Project, id: string): Promise<ChatDto>;
  converse(
    project: Project,
    card: LoadedCard,
    key: CardKey,
    entry: SessionEntry | undefined,
    turn: Turn,
  ): Promise<RunResult>;
  run(
    request: Pick<
      RunRequest,
      "cwd" | "session" | "message" | "forked" | "appendSystemPrompt" | "jsonSchema" | "signal"
    >,
    handlers?: Parameters<typeof runClaude>[1],
  ): Promise<RunResult>;
  message(from: ChatMessageDto["from"], text: string): ChatMessageDto;
  changed(key: CardKey): void;
}

export class ChatService {
  readonly store: ChatStore;
  readonly #registry: Registry;
  readonly #bus: EventBus;
  readonly #bin: string;
  readonly #claudeDir: string;
  readonly #env: NodeJS.ProcessEnv | undefined;
  readonly #timeoutMs: number | undefined;
  readonly #now: () => Date;
  /** Which card has a run going on, and its new-options run (runs.ts). */
  readonly #runs = new CardRuns();
  readonly #newOptions: NewOptionsRuns;
  readonly #summaries: Summaries;
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
    const host: ChatHost = {
      store: this.store,
      runs: this.#runs,
      bus,
      claudeDir: this.#claudeDir,
      card: (project, id) => this.#card(project, id),
      conversation: (project, id) => this.conversation(project, id),
      converse: (project, card, key, entry, turn) =>
        this.#converse(project, card, key, entry, turn),
      run: (request, handlers) => this.#run(request, handlers),
      message: (from, text) => this.#message(from, text),
      changed: (key) => this.#changed(key),
    };
    this.#newOptions = new NewOptionsRuns(host);
    this.#summaries = new Summaries(host);
  }

  /** How the new-options run writes the card (the app passes Sync's guard). */
  setCardWriter(writer: CardWriter): void {
    this.#newOptions.setCardWriter(writer);
  }

  /** Cleans up now and once a day (202611114wet). */
  start(): void {
    const run = () =>
      this.cleanup().catch((error) => console.error("[chat] cleaning up conversations:", error));
    void run();
    this.#cleanupTimer = setInterval(run, CLEANUP_EVERY_MS);
    this.#cleanupTimer.unref();
  }

  /**
   * Stops the runs in progress and waits until no card is reserved and no new-options run is
   * pending: every run (a reply, a summary, new options) and New conversation, including one
   * reserved while it waits, has ended and released its card. It doesn't wait for a cleanup()
   * already under way, or for writes that take no reservation (saving or closing a summary,
   * recording a "neither", undo). A request that comes in after this returns has any run it
   * starts stopped at once, but may still write to the state folder.
   */
  async close(): Promise<void> {
    clearInterval(this.#cleanupTimer);
    this.#abort.abort();
    while (this.#runs.active) {
      await Promise.all([
        ...this.#runs.reservedNames().map((name) => this.#runs.whenIdle(name)),
        ...this.#runs.newOptionsDone(),
      ]);
    }
  }

  async conversation(project: Project, id: string): Promise<ChatDto> {
    const key = { project: project.name, id };
    // Read before the copy and the record: a run that ends while they are read is still
    // reported as going on (the page reads again when it ends), never as over with what the
    // record said before it ended.
    const run = this.#runs.reservation(keyName(key));
    const optionsRun = this.#runs.hasNewOptionsRun(keyName(key));
    // A new-options run counts from its start, also while it waits for a reply to end.
    const running: ChatDto["running"] =
      run === "summary"
        ? "summary"
        : run instanceof ChatRun
          ? this.#runs.isOptionsRun(run)
            ? "options"
            : "reply"
          : optionsRun
            ? "options"
            : false;
    const [messages, entry] = await Promise.all([this.store.messages(key), this.store.entry(key)]);
    const newOptions =
      entry?.newOptions && (await this.#newOptions.visibleRun(project, key, entry.newOptions));
    return {
      messages,
      unsummarized: entry?.unsummarized === true,
      // "No longer remembers" only for a stored session whose transcript Claude Code no
      // longer has, never during a new session's first run (before its transcript exists).
      remembers:
        !entry?.session ||
        this.#runs.isStartingSession(keyName(key)) ||
        (await transcriptExists(this.#claudeDir, entry.session)),
      running,
      optionsRun,
      ...(newOptions ? { newOptions } : {}),
    };
  }

  /**
   * Sends the human's message to the card's session and returns the run, whose events the
   * caller streams. Refused while another run on the card is going on, a new-options run
   * included (also while it waits for a reply to end).
   */
  async send(project: Project, id: string, input: SendInput): Promise<ChatRun> {
    const card = await this.#card(project, id);
    const key = { project: project.name, id: card.id };
    if (this.#runs.hasNewOptionsRun(keyName(key))) throw this.#runs.busyError(key);
    const run = new ChatRun();
    this.#runs.reserve(key, run);
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
        this.#runs.release(key);
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
    turn: Turn,
  ): Promise<RunResult> {
    const fresh = entry?.fresh === true;
    let resume =
      !fresh && entry?.session && (await transcriptExists(this.#claudeDir, entry.session));
    // A conversation existed (here, or on another machine: the card has its summaries) that
    // this session won't remember.
    const startsOver = () =>
      fresh || Boolean(entry?.session) || card.frontmatter.feedback.some((f) => f.type === "chat");
    let startOver = !resume && startsOver();
    // A new session starts as a fork of the one that wrote the card, when this machine has it
    // (a new conversation too: the author's session is as it was, untouched by earlier copies).
    let author = resume ? undefined : await this.#authorSession(card);
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
      if (resume) this.#runs.resumesSession(keyName(key));
      else this.#runs.startsSession(keyName(key));
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
      const withLine = withPickLine(
        pickLine(card, revealed, asksNow),
        startOver
          ? `${startOverNote(card, fresh, author !== undefined)}\n\n${turn.text}`
          : turn.text,
      );
      // A fork keeps the author's system prompt: the chat's instructions go in the message.
      const message = author ? `${forkIntro(card, project.path)}\n\n${withLine}` : withLine;
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
          session: resume
            ? { resume: session }
            : author
              ? { fork: author, start: session }
              : { start: session },
          message,
          forked: resume ? entry?.forked === true : author !== undefined,
          // Not on a fork, where Claude Code ignores it (forkIntro carries the instructions).
          appendSystemPrompt: resume || author ? undefined : sessionInstructions(card),
          jsonSchema: turn.jsonSchema,
          signal: turn.signal,
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
                if (author) next.forked = true;
                else delete next.forked;
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
      author = await this.#authorSession(card);
      await turn.notice(this.#startOverNotice());
      result = await attempt();
    }
    if (!result.ok && author && result.sessionNotFound) {
      // The author's session went between the check and the run: start from the card alone.
      author = undefined;
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
   * "Neither" (#0007): `write` records the note and its run starts at once (2026111459oa
   * `trim`). One note at a time: refused, before the write, while the card's run goes on or
   * winds down after an Undo. `started: false`: the note is written but its run couldn't be.
   */
  newOptionsAsked(
    project: Project,
    id: string,
    write: () => Promise<LoadedCard>,
  ): Promise<{ card: LoadedCard; started: boolean }> {
    return this.#newOptions.newOptionsAsked(project, id, write);
  }

  /**
   * Undoes a card action (`undo`) one after the other with starting runs, and stops the card's
   * new-options run when the card no longer waits on its note (new-options.ts).
   */
  undoing(project: Project, id: string, undo: () => Promise<LoadedCard>): Promise<LoadedCard> {
    return this.#newOptions.undoing(project, id, undo);
  }

  /** Try again (202611111gpm): starts the run again for the note recorded at `input.note`. */
  startNewOptions(
    project: Project,
    id: string,
    input: { note: string; revealed?: boolean | undefined; revision?: string | undefined },
  ): Promise<StartNewOptionsResponse> {
    return this.#newOptions.startNewOptions(project, id, input);
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
    if (this.#runs.hasNewOptionsRun(keyName(key))) throw this.#runs.busyError(key);
    this.#runs.reserve(key, "new");
    try {
      const messages = await this.store.messages(key);
      const last = messages.at(-1);
      if (last && !isNewConversation(last)) {
        await this.store.updateEntry(key, (entry) => {
          const next: SessionEntry = { ...entry, fresh: true };
          delete next.session;
          delete next.forked;
          delete next.revealed;
          return next;
        });
        await this.store.append(key, this.#message("hub", NEW_CONVERSATION));
      }
    } finally {
      this.#runs.release(key);
      this.#changed(key);
    }
    return this.conversation(project, card.id);
  }

  /**
   * Has the session write a summary of the messages after the last saved summary, and returns
   * it for the human to edit. Nothing is saved.
   */
  summarize(
    project: Project,
    id: string,
    input: Omit<SendInput, "text">,
  ): Promise<ChatSummaryResponse> {
    return this.#summaries.summarize(project, id, input);
  }

  /**
   * Ends the conversation without a summary ("Close without summary"; with `decision`, a
   * decision made with "Decide without summary"). See summaries.ts.
   */
  closeWithoutSummary(
    project: Project,
    id: string,
    options: { decision?: string } = {},
  ): Promise<ChatCloseResponse> {
    return this.#summaries.closeWithoutSummary(project, id, options);
  }

  /** Undoes `closeWithoutSummary` (its notice's Undo). */
  reopen(project: Project, id: string, closed: string): Promise<ChatDto> {
    return this.#summaries.reopen(project, id, closed);
  }

  /** A summary was saved on the card, which wrote `revision`. */
  summarySaved(project: Project, id: string, revision: string): Promise<void> {
    return this.#summaries.summarySaved(project, id, revision);
  }

  /** An undo took back the write that produced `revision` (a summary, a close). */
  undone(revision: string): Promise<void> {
    return this.#summaries.undone(revision);
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
          idsByProject.set(project.name, await projectCardIds(project));
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
        if (!this.#runs.isReserved(keyName(key))) await this.store.forget(key);
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

  #run(
    request: Pick<
      RunRequest,
      "cwd" | "session" | "message" | "forked" | "appendSystemPrompt" | "jsonSchema" | "signal"
    >,
    handlers: Parameters<typeof runClaude>[1] = {},
  ): Promise<RunResult> {
    const { signal } = request;
    return runClaude(
      {
        ...request,
        bin: this.#bin,
        env: this.#env,
        timeoutMs: this.#timeoutMs,
        signal: signal ? AbortSignal.any([this.#abort.signal, signal]) : this.#abort.signal,
      },
      handlers,
    );
  }

  #message(from: ChatMessageDto["from"], text: string): ChatMessageDto {
    return { at: this.#now().toISOString(), from, text };
  }

  /**
   * The session that wrote the card (`created_session`), when this machine's Claude Code still
   * has it and it is small enough to fork within the run's cap: a new session on the card
   * starts as a fork of it (`--fork-session`).
   */
  async #authorSession(card: LoadedCard): Promise<string | undefined> {
    const author = card.frontmatter.created_session;
    // transcriptPath finds nothing for an id that isn't a UUID.
    const path = author && (await transcriptPath(this.#claudeDir, author));
    if (!author || !path) return undefined;
    // Too large to fork within the run's cap, or of unknown size: the card alone (its
    // `## For the chat` note says what the author found).
    const tokens = await contextTokens(path);
    return tokens !== undefined && tokens <= MAX_FORK_TOKENS ? author : undefined;
  }

  /**
   * Said before the human's message, so before it is known whether a fork of the author's
   * session works: it doesn't say where the new conversation starts from beyond the card.
   */
  #startOverNotice(): ChatMessageDto {
    return this.#message(
      "hub",
      "The earlier conversation on this card isn't available on this machine; this one starts again from the card.",
    );
  }

  #changed(key: CardKey): void {
    this.#bus.emit({ type: "chat", project: key.project, id: key.id });
  }
}

/**
 * The ids of the card files in every checkout of the project (undefined: no checkout has a
 * decisions/ folder; "unknown": one can't be read).
 */
async function projectCardIds(project: Project): Promise<Set<string> | "unknown" | undefined> {
  const found = await Promise.all((await checkoutsOf(project)).map(cardIds));
  if (found.includes("unknown")) return "unknown";
  const sets = found.filter((ids) => ids instanceof Set);
  return sets.length === 0 ? undefined : new Set(sets.flatMap((ids) => [...ids]));
}

/**
 * The ids of the card files in a checkout's decisions/ (undefined: the folder is gone, as on
 * another branch; "unknown": it can't be read).
 */
async function cardIds(
  project: Pick<Project, "path">,
): Promise<Set<string> | "unknown" | undefined> {
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
