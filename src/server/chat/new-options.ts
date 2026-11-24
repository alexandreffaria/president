/**
 * "Neither" (#0007): the hub's new-options run on a card (service.ts). The note is recorded
 * and its run starts at once (2026111459oa `trim`), one note at a time per card; the run waits
 * for a reply going on to end, asks the card's session for options with a `--json-schema`,
 * and writes them on the card (newCardContent) unless the note was undone or the card changed
 * meanwhile. Its record on this machine (store.ts `newOptions`) says how it went, for the page
 * and for Try again (202611111gpm).
 */
import { z } from "zod";
import type { ChatMessageDto, NewOptionsRunDto, StartNewOptionsResponse } from "../../core/api.ts";
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
import { findCard, type LoadedCard, rewriteCard } from "../cards.ts";
import type { HubProject } from "../checkouts.ts";
import { UserError } from "../errors.ts";
import {
  isViewAsked,
  lastNeither,
  newOptionsRequest,
  newOptionsSchema,
  optionCount,
  optionsHash,
  revealOf,
} from "./prompts.ts";
import { ChatRun, keyName } from "./runs.ts";
import type { ChatHost } from "./service.ts";
import type { CardKey, NewOptionsRecord, SessionEntry } from "./store.ts";

/**
 * Writes a card through whatever guards the hub's writes (Sync refuses them while it runs in
 * the project); `write` does the writing.
 */
export type CardWriter = (
  project: HubProject,
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

/** The card's new-options runs, for ChatService. */
export class NewOptionsRuns {
  readonly #host: ChatHost;
  #writeCard: CardWriter = (_project, write) => write();

  constructor(host: ChatHost) {
    this.#host = host;
  }

  /** How the new-options run writes the card (the app passes Sync's guard). */
  setCardWriter(writer: CardWriter): void {
    this.#writeCard = writer;
  }

  /**
   * The record of the card's new-options run as the page shows it: only while it is about the
   * card as it is now (the note is still the one the card waits on, or the options are still
   * the ones the hub wrote).
   */
  async visibleRun(
    project: HubProject,
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
    // "started", or "to-start" kept from before 2026111459oa.
    const unended = (state: string | undefined) => state !== "failed" && state !== "written";
    if (
      unended(record.state) &&
      !this.#host.runs.hasNewOptionsRun(keyName(key)) &&
      // Read again: the run may have ended (and saved how) while this was reading.
      unended((await this.#host.store.entry(key))?.newOptions?.state ?? "written") &&
      !this.#host.runs.hasNewOptionsRun(keyName(key))
    ) {
      // president stopped while it ran (the record is on disk, the run was in this process),
      // or before 2026111459oa while the note waited to be sent ("to-start").
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
   * "Neither" (#0007): `write` records the note and its run starts at once (2026111459oa
   * `trim`). One note at a time: refused, before the write, while the card's run goes on or
   * winds down after an Undo. `started: false`: the note is written but its run couldn't be.
   */
  async newOptionsAsked(
    project: HubProject,
    id: string,
    write: () => Promise<LoadedCard>,
  ): Promise<{ card: LoadedCard; started: boolean }> {
    const key = { project: project.name, id };
    const k = keyName(key);
    return this.#host.runs.lock(k, async () => {
      if (this.#host.runs.hasNewOptionsRun(k)) throw this.#host.runs.busyError(key);
      const card = await write();
      const note = lastNeither(card);
      try {
        if (note) await this.#startRun(project, key, note.at);
        return { card, started: true };
      } catch (error) {
        console.error("[chat] recording a new-options run:", error);
        return { card, started: false };
      }
    });
  }

  /**
   * Undoes a card action (`undo`) one after the other with starting runs. When the card then
   * no longer waits on the note of its new-options run (the "neither" was undone), the run is
   * stopped and its record dropped (2026111459oa `trim`). The card is put back first, so the
   * run can no longer write it (rewriteCard's revision check); once the run has written its
   * options, the card changed after the action and the undo is refused. The "Neither"
   * message stays in the conversation, and in the session. A decision doesn't stop the run
   * (the owner's choice, 2026-11-15): its write is refused, and Try again is there if the
   * decision is undone.
   */
  async undoing(
    project: HubProject,
    id: string,
    undo: () => Promise<LoadedCard>,
  ): Promise<LoadedCard> {
    const key = { project: project.name, id };
    const k = keyName(key);
    return this.#host.runs.lock(k, async () => {
      const card = await undo();
      const run = this.#host.runs.newOptionsRun(k);
      if (run && !waitsOn(card, run.note)) run.stop.abort();
      const record = (await this.#host.store.entry(key))?.newOptions;
      if (record && record.state !== "written" && !waitsOn(card, record.note)) {
        await this.#clearRecord(key, record.note);
        this.#host.changed(key);
      }
      return card;
    });
  }

  /**
   * Try again (202611111gpm): starts the run again for the note recorded at `input.note`,
   * after it failed or president was shut down during it. None while one is going on, for a
   * note the card no longer waits on, or with no record on this machine (20261112ah6a);
   * `started: false` then. The run itself goes on after this returns.
   */
  async startNewOptions(
    project: HubProject,
    id: string,
    input: { note: string; revealed?: boolean | undefined; revision?: string | undefined },
  ): Promise<StartNewOptionsResponse> {
    const card = await this.#host.card(project, id);
    const key = { project: project.name, id: card.id };
    const k = keyName(key);
    return this.#host.runs.lock(k, async () => {
      const current = await this.#host.card(project, id);
      const record = (await this.#host.store.entry(key))?.newOptions;
      if (
        !record ||
        record.note !== input.note ||
        record.state === "written" ||
        // Going on now. A "started" record without a run is one president was shut down
        // during: it can be tried again.
        this.#host.runs.hasNewOptionsRun(k) ||
        !waitsOn(current, record.note)
      ) {
        return { started: false };
      }
      const revealedNow =
        input.revealed && input.revision === current.revision ? revealOf(current) : undefined;
      // A "to-start" record from before 2026111459oa: the session never had the note, so this
      // is its first run, not a retry.
      const retry =
        record.state === "failed"
          ? record.error
          : record.state === "started"
            ? "the run stopped when president was shut down"
            : undefined;
      await this.#startRun(project, key, record.note, retry, revealedNow);
      return { started: true };
    });
  }

  /**
   * Records the run as started and starts it, in the background; call under the card's run
   * lock, with no run on the card (newOptionsAsked and startNewOptions refuse then).
   */
  async #startRun(
    project: HubProject,
    key: CardKey,
    note: string,
    retry?: string,
    revealedNow?: string,
  ): Promise<void> {
    const { run, forget } = this.#host.runs.beginNewOptions(keyName(key), note);
    try {
      await this.#host.store.updateEntry(key, (e) => ({
        ...e,
        newOptions: { note, state: "started" },
      }));
    } catch (error) {
      forget();
      throw error;
    }
    const stop = run.stop.signal;
    void this.#writeNewOptions(project, key, note, retry, revealedNow, stop)
      .catch(async (error: unknown) => {
        console.error("[chat]", error);
        if (!stop.aborted)
          await this.#newOptionsFailed(key, note, "internal error; see the server log");
      })
      .finally(() => {
        forget();
        this.#host.changed(key);
      });
    this.#host.changed(key);
  }

  async #writeNewOptions(
    project: HubProject,
    key: CardKey,
    note: string,
    retry: string | undefined,
    revealedNow: string | undefined,
    /** Aborted by an Undo of the note (undoing). */
    stop: AbortSignal,
  ): Promise<void> {
    const run = new ChatRun();
    this.#host.runs.markOptionsRun(run);
    // Stopped while it waited for a reply: it ends at once, and nothing reached the session.
    if (!(await this.#host.runs.reserveWhenIdle(key, run, stop))) return;
    try {
      if (stop.aborted) return;
      const card = await this.#host.card(project, key.id);
      // Undone, decided or rewritten by an agent while the run waited: nothing to write. (A
      // card that waits on the note has it as its last "neither"; `!neither` narrows the type.)
      // Only an undone note loses its record; otherwise the run failed, so Try again is there
      // if the card waits on the note again (a decision undone, 2026-11-15).
      const neither = lastNeither(card);
      if (!neither || !waitsOn(card, note)) {
        if (stop.aborted) await this.#clearRecord(key, note);
        else {
          const why =
            card.frontmatter.status === "resolved"
              ? "you decided the card meanwhile"
              : "the card changed while the run waited";
          await this.#newOptionsFailed(key, note, why, false);
        }
        return;
      }
      const entry = await this.#host.store.entry(key);
      const save = async (message: ChatMessageDto) => {
        await this.#host.store.append(key, message);
        this.#host.changed(key);
      };
      const result = await this.#host.converse(project, card, key, entry, {
        text: newOptionsRequest(card, neither, retry),
        revealedNow,
        jsonSchema: JSON.stringify(newOptionsSchema(card)),
        signal: stop,
        notice: save,
        first: () =>
          save(
            retry
              ? this.#host.message(
                  "hub",
                  `Trying again to write new options from your note at ${neither.at}.`,
                )
              : this.#host.message("you", `Neither: ${neither.note}`),
          ),
      });

      let failure: string | undefined;
      let written: LoadedCard | undefined;
      let message = "";
      // Undone: the card is already back as it was, and the record gone.
      const stopped = () =>
        save(this.#host.message("hub", "You undid your note, so the run stopped."));
      if (stop.aborted) {
        await stopped();
        return;
      }
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
        await this.#host.store.append(
          key,
          this.#host.message("agent", `${message}\n\n(The options are now on the card.)`),
        );
        // A run doesn't make the conversation "not summarized" (202611111gpm
        // `shown-no-reminder`), and a pick revealed before is not the new one (2026111272fu).
        // A view asked for on the card without a pick (20261112irpn) reveals nothing about the
        // new options either: the chat is neutral about them until r, with no word of an
        // earlier pick, since there was none.
        await this.#host.store.updateEntry(key, (e) => {
          if (e?.newOptions?.note !== note) return e;
          const next: SessionEntry = {
            ...e,
            newOptions: { note, state: "written", options: hash },
          };
          if (isViewAsked(e?.revealed)) delete next.revealed;
          else if (e?.revealed) next.revealed = "replaced";
          return next;
        });
        this.#host.bus.emit({ type: "cards", project: project.name });
      } else if (stop.aborted) {
        // Stopped while the hub wrote: the write was refused because the card was put back.
        await stopped();
      } else {
        // Whether the card still waits on the note (not decided elsewhere, say, by Sync).
        const now = await findCard(project, key.id).catch(() => undefined);
        const waits = now?.ok === true && waitsOn(now.card, note);
        await this.#newOptionsFailed(key, note, failure ?? "the run failed", waits);
      }
    } finally {
      run.emit({ type: "done", message: undefined });
      this.#host.runs.release(key);
    }
  }

  async #newOptionsFailed(key: CardKey, note: string, error: string, waits = true): Promise<void> {
    await this.#host.store.append(key, this.#host.message("hub", newOptionsFailure(error, waits)));
    await this.#host.store.updateEntry(key, (e) =>
      e?.newOptions?.note === note ? { ...e, newOptions: { note, state: "failed", error } } : e,
    );
  }

  async #clearRecord(key: CardKey, note: string): Promise<void> {
    await this.#host.store.updateEntry(key, (e) => {
      if (e?.newOptions?.note !== note) return e;
      const { newOptions: _, ...rest } = e;
      return rest;
    });
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
 * body is read back to check that: exactly the sections with details, and the context, the
 * appendix (`## Sources`, notes) and the author's `## For the chat` as they were. Otherwise
 * a UserError says what was wrong.
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
    [s.context, s.appendix, s.forChat]
      .filter((t) => t !== "")
      .join("\n\n")
      .replace(/[ \t]+$/gm, "");
  const restKept =
    (after.context === before.context &&
      after.appendix === before.appendix &&
      after.forChat === before.forChat) ||
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
