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
 *   "Close without summary" ends the reminder without writing the card (202611111ky9: it
 *   lasts "until you close the conversation, saving its summary or not").
 * - Teach me (#0005, 20261111fauj) and More info: buttons next to the message box (#0002's
 *   sketch); the hub writes their requests.
 * - While the "Before deciding" box is open (#0019, BeforeDeciding.tsx), the summary is edited
 *   there, so this panel's summary box stays out of the way.
 */
import { useEffect, useRef, useState } from "react";
import type { CardDetailDto, ChatAsk, ChatMessageDto } from "../../core/api.ts";
import type { ChatContext } from "../api.ts";
import type { CardChat as ChatState } from "../chat.ts";
import type { Draft } from "../drafts.ts";
import { fullDate, timeAgo } from "../format.ts";
import { useKeyLayer } from "../keyboard.ts";
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
  /** The "Before deciding" box is open and holds the summary (#0019). */
  deciding?: boolean;
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
  const summaryShown = !props.deciding && (boxOpen || draft.summary.trim() !== "");
  const [closing, setClosing] = useState(false);

  // Keep the newest message in view as the conversation grows (the panel scrolls itself).
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when anything is added
  useEffect(() => {
    const el = list.current;
    if (el && props.layout === "side") el.scrollTop = el.scrollHeight;
  }, [shown.length, live?.text.length, props.layout]);

  const send = async () => {
    const text = draft.chat.trim();
    if (!text || running) return;
    props.onDraft({ chat: "" });
    const failure = await chat.send(text, context);
    if (failure) {
      toast(failure, { tone: "error" });
      // Refused before it was sent (the agent was busy, the hub unreachable): keep the text.
      if (!failure.startsWith("No reply")) props.onDraft({ chat: text });
    }
  };

  /** Teach me or More info: the button's name shows as your message. */
  const ask = async (what: ChatAsk) => {
    if (running) return;
    const failure = await chat.send({ ask: what }, context);
    if (failure) toast(failure, { tone: "error" });
  };

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

  /** Ends the conversation without saving a summary: the reminder goes, the card stays. */
  const closeWithoutSummary = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await chat.close();
      closeBox();
      toast("Conversation closed without a summary. Nothing was added to the card.");
    } catch (error) {
      toast((error as Error).message, { tone: "error" });
    } finally {
      setClosing(false);
    }
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
        {shown.length === 0 && !live && (
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
        {running && (
          <li className="chat-status muted">{live?.activity ?? "The agent is answering…"}</li>
        )}
      </ol>

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
              type="button"
              className="button"
              disabled={closing || saving || running}
              onClick={() => void closeWithoutSummary()}
            >
              Close without summary
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

      <p className="chat-asks">
        <button
          type="button"
          className="button"
          disabled={running}
          onClick={() => void ask("teach")}
        >
          Teach me
        </button>
        <button
          type="button"
          className="button"
          disabled={running}
          onClick={() => void ask("research")}
        >
          More info
        </button>
      </p>

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
