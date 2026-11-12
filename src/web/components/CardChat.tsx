/**
 * The conversation about a card (E): a headless Claude Code session in the card's project
 * that reads the project and the web and changes nothing (#0004).
 *
 * - Where: a side panel next to the card, or in the page's flow under the options below
 *   about 1100 px (#0002, 20261111sblu); CardView picks the layout.
 * - What it shows: the hub's copy of the messages on this machine (#0018), the reply as it
 *   streams in, and when Claude Code has deleted the session, "The agent no longer remembers
 *   this conversation" (#0018, 20261111paot).
 * - Summaries: "Conversation not summarized yet. [Write summary]" while messages aren't
 *   covered by a saved summary (#0024, 202611111ky9); the agent writes one, the human edits
 *   it, and only what they save is added to the card as a `chat` entry (#0003, #0023).
 * - Neither's new options (#0007): the run is a turn here (202611111gpm). Your "Neither"
 *   message waits, "Sending when Undo closes" in the tab whose Undo notice will start it
 *   (20261112160s), with Start now in any other page (20261112dfik); then "Writing new
 *   options…", and when it fails, why and Try again. A message sent meanwhile is held and
 *   sent after the run.
 */
import { useEffect, useRef, useState } from "react";
import type { CardDetailDto, ChatMessageDto } from "../../core/api.ts";
import { newOptionsFailure } from "../../core/new-options.ts";
import { api, type ChatContext } from "../api.ts";
import type { CardChat as ChatState } from "../chat.ts";
import type { Draft } from "../drafts.ts";
import { clockTime, fullDate, timeAgo } from "../format.ts";
import { useKeyLayer } from "../keyboard.ts";
import { useHoldsUndo } from "../new-options.ts";
import { useToast } from "../toast.tsx";
import { Markdown } from "./Markdown.tsx";

export function CardChat(props: {
  card: CardDetailDto;
  chat: ChatState;
  context: ChatContext;
  layout: "side" | "inline";
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  /** Hides the panel; the conversation stays as it is. */
  onClose: () => void;
  /** Saves the edited summary on the card; true when it was saved. */
  onSaveSummary: (summary: string) => Promise<boolean>;
}) {
  const { card, chat, context, draft } = props;
  const toast = useToast();
  const messages = chat.chat?.messages ?? [];
  const live = chat.live;
  const [writing, setWriting] = useState(false);
  const [boxOpen, setBoxOpen] = useState(() => draft.summary.trim() !== "");
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const shown = [...messages, ...(live?.saved ?? [])];
  const running = live !== undefined || chat.chat?.running === true;
  const remembers = chat.chat?.remembers ?? true;
  const unsummarized = chat.chat?.unsummarized === true;
  const summaryShown = boxOpen || draft.summary.trim() !== "";

  // Neither's new-options run (#0007): your "Neither" message is pending until the run
  // starts (20261112160s); this tab sends it when its Undo notice closes, any other page
  // offers Start now (20261112dfik).
  const run = chat.chat?.newOptions;
  const pending = run?.state === "to-start" ? run : undefined;
  const pendingNote = pending
    ? card.frontmatter.feedback.find((f) => f.type === "neither" && f.at === pending.note)
    : undefined;
  const holdsUndo = useHoldsUndo(card.project, card.id, pending?.note);
  const [starting, setStarting] = useState(false);
  /** A message sent while the "Neither" message waits: sent once the run has started. */
  const [held, setHeld] = useState<string>();
  const heldRef = useRef(held);
  heldRef.current = held;
  const onDraft = useRef(props.onDraft);
  onDraft.current = props.onDraft;

  const startRun = async () => {
    if (!run || starting) return;
    setStarting(true);
    try {
      await api.startNewOptions(card.project, card.id, { note: run.note, ...context });
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      setStarting(false);
    }
  };

  // Leaving the card with a held message keeps it as unsent text.
  useEffect(
    () => () => {
      if (heldRef.current) onDraft.current({ chat: heldRef.current });
    },
    [],
  );

  // Keep the newest message in view as the conversation grows (the panel scrolls itself).
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when anything is added
  useEffect(() => {
    const el = list.current;
    if (el && props.layout === "side") el.scrollTop = el.scrollHeight;
  }, [shown.length, live?.text.length, props.layout]);

  const send = async () => {
    const text = draft.chat.trim();
    if (!text || running || held) return;
    props.onDraft({ chat: "" });
    // Held until the run has started, so it reaches the session after the "Neither" message.
    if (pending) {
      setHeld(text);
      return;
    }
    await deliver(text);
  };

  const deliver = async (text: string) => {
    const failure = await chat.send(text, context);
    if (failure) {
      toast(failure, { tone: "error" });
      // Refused before it was sent (the agent was busy, the hub unreachable): keep the text.
      if (!failure.startsWith("No reply")) props.onDraft({ chat: text });
    }
  };

  // The run is over (or the note was undone): the held message goes now, after it.
  const waiting = pending !== undefined || run?.state === "started" || chat.chat?.running;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the wait ends
  useEffect(() => {
    if (held === undefined || waiting) return;
    setHeld(undefined);
    void deliver(held);
  }, [held, waiting]);

  const writeSummary = async () => {
    setWriting(true);
    try {
      const { summary } = await chat.summarize(context);
      props.onDraft({ summary });
      setBoxOpen(true);
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      setWriting(false);
    }
  };

  const closeBox = () => {
    props.onDraft({ summary: "" });
    setBoxOpen(false);
  };

  const save = async () => {
    const text = draft.summary.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      if (await props.onSaveSummary(text)) setBoxOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // The summary box holds text not saved yet: Esc closes it, and the page's keys wait.
  useKeyLayer({ escape: closeBox }, summaryShown);

  return (
    <section className={`chat chat-${props.layout}`} aria-labelledby={`chat-heading-${card.id}`}>
      <header className="chat-header">
        <h2 id={`chat-heading-${card.id}`} className="section-heading">
          Conversation
        </h2>
        <button type="button" className="button button-quiet" onClick={props.onClose}>
          Hide <kbd>c</kbd>
        </button>
      </header>

      <ol className="chat-messages" ref={list} aria-live="polite">
        {shown.length === 0 && !live && !pending && held === undefined && (
          <li className="chat-empty muted">
            Ask the card's agent about this card. It reads the project and searches the web; it
            can't change anything.
          </li>
        )}
        {shown.map((message, i) => (
          // The copy is append-only, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <Message key={i} message={message} />
        ))}
        {live && live.text.length > 0 && (
          <li className="chat-message chat-agent">
            <p className="chat-meta">agent</p>
            <Markdown className="chat-text">{live.text.join("\n\n")}</Markdown>
          </li>
        )}
        {pending && pendingNote && (
          <li className="chat-message chat-you chat-pending">
            <p className="chat-meta">
              you,{" "}
              <time dateTime={pendingNote.at} title={fullDate(pendingNote.at)}>
                {timeAgo(pendingNote.at)}
              </time>
            </p>
            <p className="chat-text">Neither: {pendingNote.note}</p>
            {holdsUndo ? (
              <p className="chat-pending-note muted small">Sending when Undo closes</p>
            ) : (
              <p className="chat-pending-note small">
                The run for your note at {clockTime(pendingNote.at)} hasn't started. If another tab
                still shows its Undo notice, it starts when that closes.{" "}
                <button
                  type="button"
                  className="button"
                  disabled={starting}
                  onClick={() => void startRun()}
                >
                  Start now
                </button>
              </p>
            )}
          </li>
        )}
        {held !== undefined && (
          <li className="chat-message chat-you chat-pending">
            <p className="chat-meta">you</p>
            <p className="chat-text">{held}</p>
            <p className="chat-pending-note muted small">Sent after your Neither message</p>
          </li>
        )}
        {running && (
          <li className="chat-status muted">
            {live?.activity ??
              (run?.state === "started" ? "Writing new options…" : "The agent is answering…")}
          </li>
        )}
      </ol>

      {run?.state === "failed" && (
        <p className="chat-note">
          {newOptionsFailure(run.error ?? "the run failed")}{" "}
          <button
            type="button"
            className="button"
            disabled={starting || running}
            onClick={() => void startRun()}
          >
            Try again
          </button>
        </p>
      )}

      {!remembers && shown.length > 0 && (
        <p className="chat-note muted">
          The agent no longer remembers this conversation; your next message starts from the
          summaries.
        </p>
      )}

      {summaryShown ? (
        <form
          className="chat-summary"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor={`chat-summary-${card.id}`} className="action-panel-label">
            Summary for the project's agent
          </label>
          <p className="muted small">
            Edit it, then save: it is added to the card's history as a conversation summary, and the
            agent reads it with your notes.
          </p>
          <textarea
            id={`chat-summary-${card.id}`}
            rows={5}
            value={draft.summary}
            onChange={(event) => props.onDraft({ summary: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void save();
              }
            }}
          />
          <div className="action-panel-buttons">
            <button type="button" className="button" onClick={closeBox}>
              Cancel <kbd>Esc</kbd>
            </button>
            <button
              type="submit"
              className="button button-primary"
              disabled={saving || !draft.summary.trim()}
            >
              Save summary <kbd>Ctrl ⏎</kbd>
            </button>
          </div>
        </form>
      ) : writing ? (
        <p className="chat-note muted">Writing a summary…</p>
      ) : (
        unsummarized && (
          <p className="chat-note">
            {remembers ? "Conversation not summarized yet." : "Not summarized yet."}{" "}
            <button
              type="button"
              className="button"
              disabled={running}
              onClick={() => void writeSummary()}
            >
              {remembers ? "Write summary" : "Write summary from these messages"}
            </button>
          </p>
        )
      )}

      <form
        className="chat-compose"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message to the card's agent"
          placeholder="Ask about this card…"
          rows={2}
          value={draft.chat}
          onChange={(event) => props.onDraft({ chat: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={running || !draft.chat.trim()}
        >
          Send <kbd>⏎</kbd>
        </button>
      </form>
    </section>
  );
}

const WHO: Record<ChatMessageDto["from"], string> = {
  you: "you",
  agent: "agent",
  hub: "president",
};

function Message({ message }: { message: ChatMessageDto }) {
  return (
    <li className={`chat-message chat-${message.from}`}>
      <p className="chat-meta">
        {WHO[message.from]},{" "}
        <time dateTime={message.at} title={fullDate(message.at)}>
          {timeAgo(message.at)}
        </time>
      </p>
      {message.from === "agent" ? (
        <Markdown className="chat-text">{message.text}</Markdown>
      ) : (
        <p className="chat-text">{message.text}</p>
      )}
    </li>
  );
}
