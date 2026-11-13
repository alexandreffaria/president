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
 *   lasts "until you close the conversation, saving its summary or not"), drops the draft,
 *   and can be undone from its notice.
 *   Closing the box (Esc, Cancel) keeps the edited text as a draft, like the other panels.
 * - Teach me (#0005, 20261111fauj) and More info (20261112e1ik): buttons next to the message
 *   box (#0002's sketch); the hub writes their requests.
 * - While the "Before deciding" box is open (#0019, BeforeDeciding.tsx), the summary is edited
 *   there, so this panel's summary box stays out of the way, and nothing can be asked (the
 *   message box, Teach me and More info are off): a message then would be missing from the
 *   summary saved with the decision.
 * - Agent text never loads anything: images in it are links (a page the session read could
 *   have asked for an image whose address carries project text).
 */
import { type RefObject, useEffect, useRef, useState } from "react";
import type { CardDetailDto, ChatAsk, ChatMessageDto } from "../../core/api.ts";
import type { ChatContext } from "../api.ts";
import type { CardChat as ChatState } from "../chat.ts";
import { clearSummaryIf, type Draft, fillSummaryIfEmpty, putBack } from "../drafts.ts";
import { fullDate, timeAgo } from "../format.ts";
import { useKeyLayer } from "../keyboard.ts";
import { useToast } from "../toast.tsx";
import { Markdown } from "./Markdown.tsx";

/** How close to the bottom (px) the list counts as at the bottom, following new messages. */
const AT_BOTTOM_PX = 24;

export function CardChat(props: {
  card: CardDetailDto;
  chat: ChatState;
  context: ChatContext;
  layout: "side" | "inline";
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  /** Hides the panel; the conversation stays as it is. */
  onClose: () => void;
  /** Set when the human opened the panel: the message box takes focus (then it is reset). */
  focusOnOpen: RefObject<boolean>;
  /** Saves the edited summary on the card; true when it was saved. */
  onSaveSummary: (summary: string) => Promise<boolean>;
  /**
   * Puts an agent summary in the draft, only if the draft is still empty (the agent never
   * replaces text already in the summary box); true when it was used.
   */
  onAgentSummary: (summary: string) => boolean;
  /**
   * Told when this panel's Write summary starts and ends, before the hub's copy says so;
   * at the end, with why no summary was written when the run failed.
   */
  onWriting?: (writing: boolean, error?: string) => void;
  /** The "Before deciding" box is open and holds the summary (#0019). */
  deciding?: boolean;
}) {
  const { card, chat, context, draft } = props;
  const deciding = props.deciding === true;
  const toast = useToast();
  const messages = chat.chat?.messages ?? [];
  const live = chat.live;
  const [writing, setWriting] = useState(false);
  const hasSummaryDraft = draft.summary.trim() !== "";
  // A draft kept from before (closed with Esc, a reload) waits behind "Edit summary".
  const [boxOpen, setBoxOpen] = useState(false);
  const hadSummaryDraft = useRef(hasSummaryDraft);
  const [saving, setSaving] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const atBottom = useRef(true);
  const messageBox = useRef<HTMLTextAreaElement>(null);
  const summaryBox = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the summary box opens or closes. */
  const focusAfterBox = useRef<"box" | "edit" | null>(null);
  const shown = [...messages, ...(live?.saved ?? [])];
  const answering = live !== undefined && !live.lost;
  const running = answering || Boolean(chat.chat?.running);
  const remembers = chat.chat?.remembers ?? true;
  const unsummarized = chat.chat?.unsummarized === true;
  const [closing, setClosing] = useState(false);
  const status = answering
    ? (live.activity ?? "The agent is answering…")
    : writing || chat.chat?.running === "summary"
      ? "The agent is writing a summary…"
      : chat.chat?.running === "reply"
        ? "The agent is answering…"
        : "";

  // Opened with c or the button: straight to the message box (inline, that scrolls it into
  // view; beside the card, it is otherwise after the whole card in tab order).
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening only
  useEffect(() => {
    if (!props.focusOnOpen.current) return;
    props.focusOnOpen.current = false;
    messageBox.current?.focus();
    if (props.layout === "inline") messageBox.current?.scrollIntoView?.({ block: "nearest" });
  }, []);

  // A summary draft that appears (the agent wrote one, an Undo put a saved one back) opens
  // the box; closing the box keeps the draft without reopening it. One the "Before deciding"
  // box wrote waits behind "Edit summary" if that box is left with Esc.
  useEffect(() => {
    if (hasSummaryDraft && !hadSummaryDraft.current && !deciding) setBoxOpen(true);
    hadSummaryDraft.current = hasSummaryDraft;
  }, [hasSummaryDraft, deciding]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once the box opened or closed
  useEffect(() => {
    const target = focusAfterBox.current;
    focusAfterBox.current = null;
    if (target === "box") summaryBox.current?.focus();
    if (target === "edit") editButton.current?.focus();
  }, [boxOpen]);

  // Keep the newest message in view as the conversation grows (the panel scrolls itself),
  // unless the human has scrolled up to read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when anything is added
  useEffect(() => {
    const el = list.current;
    if (el && props.layout === "side" && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown.length, live?.text.length, props.layout]);

  const send = async () => {
    const text = draft.chat.trim();
    if (!text || running || deciding) return;
    props.onDraft({ chat: "" });
    const failure = await chat.send(text, context);
    if (failure) {
      toast(failure.error, { tone: "error" });
      // Refused before the hub saved it (the agent was busy, the hub unreachable): keep the
      // text. Once saved, it is in the conversation; sending it again would send it twice.
      // Into the stored draft, ahead of what was typed since (here, or in a new view of the
      // card if the human left and came back), which stays.
      if (failure.notSent) putBack(card.project, card.id, "chat", text);
    }
  };

  /** Teach me or More info: the button's name shows as your message. */
  const ask = async (what: ChatAsk) => {
    if (running || deciding) return;
    const failure = await chat.send({ ask: what }, context);
    if (failure) toast(failure.error, { tone: "error" });
  };

  const writeSummary = async () => {
    setWriting(true);
    props.onWriting?.(true);
    let failed: string | undefined;
    try {
      const { summary } = await chat.summarize(context);
      // Text typed while the agent wrote (here or in the "Before deciding" box) wins.
      if (props.onAgentSummary(summary)) {
        focusAfterBox.current = "box";
        setBoxOpen(true);
      }
    } catch (error) {
      failed = (error as Error).message;
      toast(failed, { tone: "error" });
    } finally {
      setWriting(false);
      props.onWriting?.(false, failed);
    }
  };

  /** Closes the summary box; what is in it stays as a draft (Esc never throws text away). */
  const closeBox = () => {
    if (hasSummaryDraft) {
      toast("Your summary is kept as a draft; it isn't saved on the card yet.");
      focusAfterBox.current = "edit";
    }
    setBoxOpen(false);
  };

  const reopenBox = () => {
    focusAfterBox.current = "box";
    setBoxOpen(true);
  };

  /**
   * Ends the conversation without saving a summary: the reminder goes, the card stays, and
   * the draft is dropped (the only button that drops it). Undo on the notice brings the
   * reminder and the draft back.
   */
  const closeWithoutSummary = async () => {
    if (closing) return;
    setClosing(true);
    const dropped = draft.summary;
    try {
      const closed = await chat.close();
      // Only while the box still holds what was dropped, and no other field: this view may
      // have gone (the human left the card and came back), and what was typed since stays.
      clearSummaryIf(card.project, card.id, dropped);
      setBoxOpen(false);
      toast("Conversation closed without a summary. Nothing was added to the card.", {
        action: {
          label: "Undo",
          key: "u",
          run: () => {
            chat
              .reopen(closed)
              .then(() => {
                // Into the stored draft, only while its summary is empty: this view may have
                // gone (the human left the card and came back), and what was typed since stays.
                const kept =
                  dropped.trim() !== "" && !fillSummaryIfEmpty(card.project, card.id, dropped);
                toast(
                  kept
                    ? "Undone. The conversation isn't summarized again. Your earlier summary wasn't put back: the summary box already has text."
                    : "Undone. The conversation isn't summarized again.",
                );
              })
              .catch((error: Error) => toast(`Couldn't undo: ${error.message}`, { tone: "error" }));
          },
        },
      });
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
  useKeyLayer({ escape: closeBox }, boxOpen && !deciding);

  return (
    <section className={`chat chat-${props.layout}`} aria-labelledby={`chat-heading-${card.id}`}>
      <header className="chat-header">
        <h2 id={`chat-heading-${card.id}`} className="section-heading">
          Conversation
        </h2>
        <button type="button" className="button button-quiet" onClick={props.onClose}>
          Hide conversation <kbd>c</kbd>
        </button>
      </header>

      {/* Busy while a reply streams in: it is read out once, when it is complete. */}
      <ol
        className="chat-messages"
        ref={list}
        aria-live="polite"
        aria-busy={answering}
        onScroll={(event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
        }}
      >
        {shown.length === 0 && !live && (
          <li className="chat-empty muted">
            Ask the card's agent about this card. It reads the project and searches the web; it
            can't change anything.
          </li>
        )}
        {[
          ...shown,
          ...(live && live.text.length > 0
            ? [{ from: "agent" as const, text: live.text.join("\n\n"), at: undefined }]
            : []),
        ].map((message, i) => (
          // The copy is append-only, so the index is a stable key; the reply streaming in
          // has the index its saved copy will have, so it stays the same item (one list, so
          // React matches them up) and isn't announced again when the copy replaces it.
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
          <Message key={i} message={message} />
        ))}
      </ol>

      <p className="chat-status muted" role="status">
        {status}
      </p>

      {!remembers && shown.length > 0 && (
        <p className="chat-note muted">
          The agent no longer remembers this conversation; your next message starts from the
          summaries.
        </p>
      )}

      {deciding ? null : boxOpen ? (
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
            ref={summaryBox}
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
      ) : hasSummaryDraft ? (
        <p className="chat-note">
          Summary draft kept, not saved yet.{" "}
          <button type="button" className="button" ref={editButton} onClick={reopenBox}>
            Edit summary
          </button>
        </p>
      ) : (
        unsummarized &&
        !writing && (
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
          disabled={running || deciding}
          onClick={() => void ask("teach")}
        >
          Teach me
        </button>
        <button
          type="button"
          className="button"
          disabled={running || deciding}
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
          ref={messageBox}
          aria-label="Message to the card's agent"
          placeholder="Ask about this card…"
          rows={2}
          disabled={deciding}
          aria-describedby={deciding ? `chat-deciding-${card.id}` : undefined}
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
          disabled={running || deciding || !draft.chat.trim()}
        >
          Send <kbd>⏎</kbd>
        </button>
      </form>
      {deciding && (
        <p className="chat-note muted small" id={`chat-deciding-${card.id}`}>
          Finish deciding, or press Esc to keep talking.
        </p>
      )}
    </section>
  );
}

const WHO: Record<ChatMessageDto["from"], string> = {
  you: "you",
  agent: "agent",
  hub: "president",
};

/** A message; `at` is undefined for the reply still streaming in. */
function Message({
  message,
}: {
  message: Pick<ChatMessageDto, "from" | "text"> & { at: string | undefined };
}) {
  return (
    <li className={`chat-message chat-${message.from}`}>
      <p className="chat-meta">
        {WHO[message.from]}
        {message.at && (
          <>
            ,{" "}
            <time dateTime={message.at} title={fullDate(message.at)}>
              {timeAgo(message.at)}
            </time>
          </>
        )}
      </p>
      {message.from === "agent" ? (
        <Markdown className="chat-text" imagesAsLinks>
          {message.text}
        </Markdown>
      ) : (
        <p className="chat-text">{message.text}</p>
      )}
    </li>
  );
}
