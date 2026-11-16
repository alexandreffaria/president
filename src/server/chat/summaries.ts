/**
 * Summaries of a card's conversation (#0003, #0024), for ChatService: the session writes one
 * (or, when Claude Code deleted it, a fresh one-off session reads the hub's copy, 20261111paot)
 * for the human to edit; nothing is saved until the human saves it as a `chat` card action.
 * Also what counts as summarized on this machine: a saved summary, Close without summary
 * (202611111ky9 `remind`) or Decide without summary (20261112hq3k `ends`), and their undo.
 */
import { randomUUID } from "node:crypto";
import {
  type ChatCloseResponse,
  type ChatDto,
  type ChatSummaryResponse,
  isNewConversation,
} from "../../core/api.ts";
import type { HubProject } from "../checkouts.ts";
import { UserError } from "../errors.ts";
import {
  pickLine,
  revealOf,
  sessionInstructions,
  summaryFromCopy,
  summaryRequest,
  withPickLine,
} from "./prompts.ts";
import { type RunResult, transcriptExists } from "./runner.ts";
import { keyName } from "./runs.ts";
import type { ChatHost, SendInput } from "./service.ts";
import type { CardKey, SessionEntry } from "./store.ts";

/** The card's summaries, for ChatService. */
export class Summaries {
  readonly #host: ChatHost;
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

  constructor(host: ChatHost) {
    this.#host = host;
  }

  /**
   * Has the session write a summary of the messages after the last saved summary, and returns
   * it for the human to edit. Nothing is saved.
   */
  async summarize(
    project: HubProject,
    id: string,
    input: Omit<SendInput, "text">,
  ): Promise<ChatSummaryResponse> {
    const card = await this.#host.card(project, id);
    const key = { project: project.name, id: card.id };
    this.#host.runs.reserve(key, "summary");
    this.#host.changed(key);
    try {
      const [entry, messages] = await Promise.all([
        this.#host.store.entry(key),
        this.#host.store.messages(key),
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
      if (
        !spans &&
        entry?.session &&
        (await transcriptExists(this.#host.claudeDir, entry.session))
      ) {
        fromCopy = false;
        result = await this.#host.run({
          cwd: project.path,
          session: { resume: entry.session },
          message: withPickLine(line, summaryRequest(since > 0)),
        });
        if (!result.ok && result.sessionNotFound) {
          fromCopy = true;
          result = undefined;
        }
      }
      result ??= await this.#host.run({
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
      this.#host.runs.release(key);
      this.#host.changed(key);
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
    project: HubProject,
    id: string,
    options: { decision?: string } = {},
  ): Promise<ChatCloseResponse> {
    const card = await this.#host.card(project, id);
    const key = { project: project.name, id: card.id };
    // A decision is already written: a reply still coming in is left to mark itself.
    if (options.decision === undefined && this.#host.runs.isReserved(keyName(key))) {
      throw this.#host.runs.busyError(key);
    }
    let before: SessionEntry | undefined;
    await this.#host.store.updateEntry(key, async (entry) => {
      before = entry;
      if (!entry) return entry;
      // Counted under the entry's lock, as in summarySaved.
      const messages = await this.#host.store.messages(key);
      const next: SessionEntry = { ...entry, summarized: messages.length };
      delete next.unsummarized;
      return next;
    });
    this.#offered.delete(keyName(key));
    const closed = options.decision ?? randomUUID();
    // A close made by a decision is undone with the decision, never with `reopen`.
    if (before) this.#remember(closed, key, before, options.decision === undefined);
    this.#host.changed(key);
    return { chat: await this.#host.conversation(project, card.id), closed };
  }

  /**
   * Undoes `closeWithoutSummary` (its notice's Undo): the conversation is "not summarized"
   * again, and the next summary covers what it covered before the close.
   */
  async reopen(project: HubProject, id: string, closed: string): Promise<ChatDto> {
    const card = await this.#host.card(project, id);
    const write = this.#summaryWrites.get(closed);
    if (!write?.close || write.key.project !== project.name || write.key.id !== card.id) {
      throw new UserError("this close can no longer be undone", {
        status: 409,
        code: "not_undoable",
      });
    }
    await this.undone(closed);
    return this.#host.conversation(project, card.id);
  }

  /**
   * A summary was saved on the card (the `chat` action, or a decision carrying one), which
   * wrote `revision`: the conversation counts as summarized up to the messages that summary
   * was written from.
   */
  async summarySaved(project: HubProject, id: string, revision: string): Promise<void> {
    const key = { project: project.name, id };
    const offered = this.#offered.get(keyName(key));
    this.#offered.delete(keyName(key));
    let before: SessionEntry | undefined;
    await this.#host.store.updateEntry(key, async (entry) => {
      before = entry;
      // Counted under the entry's lock: a message saved in between keeps its mark.
      const messages = await this.#host.store.messages(key);
      const through = offered ?? messages.length;
      const covered = Math.min(through, messages.length);
      const next: SessionEntry = { ...entry, summarized: covered };
      // A message sent while the summary was being edited is still not summarized; hub lines
      // (a New conversation's divider, 20261112lvbu) are nothing to summarize.
      if (messages.slice(covered).every((m) => m.from === "hub")) delete next.unsummarized;
      return next;
    });
    this.#remember(revision, key, before, false);
    this.#host.changed(key);
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
    await this.#host.store.updateEntry(write.key, (entry) => {
      const next: SessionEntry = { ...entry };
      if (write.before?.unsummarized) next.unsummarized = true;
      if (write.before?.summarized === undefined) delete next.summarized;
      else next.summarized = write.before.summarized;
      return next;
    });
    this.#host.changed(write.key);
  }
}
