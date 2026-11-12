import { useCallback, useEffect, useRef, useState } from "react";
import type { CardAction } from "../../core/actions.ts";
import type { BrokenCardDto, CardDetailDto, CardDto, NewOptionsRunDto } from "../../core/api.ts";
import { CUSTOM_CHOICE } from "../../core/model.ts";
import {
  buildQueue,
  isBackFromDeferral,
  isWaitingOnAgent,
  openDependencies,
  unknownDependencies,
} from "../../core/queue.ts";
import { api, RequestError } from "../api.ts";
import { decidedRecently, recordDecision, wroteHere } from "../app-writes.ts";
import { describeChanges } from "../card-changes.ts";
import { useCardChat, useMinWidth } from "../chat.ts";
import { CardChat } from "../components/CardChat.tsx";
import { CardId } from "../components/CardId.tsx";
import { FeedbackHistory } from "../components/FeedbackHistory.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { OptionCard } from "../components/OptionCard.tsx";
import {
  type Draft,
  type Panel as DraftPanel,
  restoreDraft,
  takePanel,
  unsentText,
  useDraft,
} from "../drafts.ts";
import {
  clockTime,
  fullDate,
  KIND_LABEL,
  optionLabel,
  PRIORITY_LABEL,
  timeAgo,
} from "../format.ts";
import { useHub } from "../hub.tsx";
import { type KeyMap, useKeyboard, useKeyLayer } from "../keyboard.ts";
import { holdUndo, releaseUndo, startWhenUndoCloses } from "../new-options.ts";
import { cardPath, Link, navigate } from "../router.tsx";
import { dateInputValue, nextMonth, startOfDay, tomorrow } from "../snooze.ts";
import { useDismissToasts, useToast } from "../toast.tsx";

type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "broken"; broken: BrokenCardDto }
  | { state: "ok"; card: CardDetailDto };

type Panel = DraftPanel | null;

/** What an action says once it is sent, from the card it produced. */
type Done = string | ((card: CardDetailDto) => string);

interface ActOptions {
  leave?: boolean;
  done?: Done;
  sent?: Partial<Draft>;
  /** The panel to open again with the sent text if the action is undone. */
  panel?: DraftPanel;
}

/**
 * Who changed the card since the human last read it: an agent (or someone editing the file),
 * or the human themselves in another president tab.
 */
const CHANGED_BY_TEXT: Record<ChangedBy, string> = {
  agent: "An agent changed this card while you had it open.",
  "other-tab": "You changed this card in another president tab.",
  // Card 20261112xp4s (from-sync): how the change arrived, not who made it.
  sync: "Sync just brought in a newer version of this card from the online copy.",
};

/** Who or what changed the open card: another president tab, this hub's Sync, or an agent. */
type ChangedBy = "agent" | "other-tab" | "sync";

const NO_DRAFT: Draft = {
  seen: undefined,
  selected: undefined,
  decisionNote: "",
  answer: "",
  neither: "",
  note: "",
  chat: "",
  summary: "",
};

/** Below this window width the conversation sits in the page's flow, not beside it (#0002). */
const SIDE_PANEL_MIN_PX = 1100;

/** How many views of each card are mounted ("project/id"). */
const openViews = new Map<string, number>();

export function CardView({ project, id }: { project: string; id: string }) {
  const hub = useHub();
  const toast = useToast();
  const dismissToasts = useDismissToasts();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  // `latest` is read inside async callbacks, where `draft` would be stale.
  const [draft, updateDraft, latest] = useDraft(project, id);
  const [panel, setPanel] = useState<Panel>(null);
  /** The Defer menu (#0017): other dates than `d`'s week. */
  const [deferMenu, setDeferMenu] = useState(false);
  /**
   * The agent's pick is shown (#0008, hidden until asked). Lasts until the human leaves the
   * card (20261111nsaj, visit): the view is mounted per card, and nothing is stored.
   */
  const [revealed, setRevealed] = useState(false);
  const revealButton = useRef<HTMLButtonElement>(null);
  const agentsTake = useRef<HTMLElement>(null);
  /** Set when the reveal removes the focused button: focus then goes to the agent's take. */
  const focusTake = useRef(false);
  const reveal = (fromButton: boolean) => {
    focusTake.current = fromButton || document.activeElement === revealButton.current;
    setRevealed(true);
  };
  useEffect(() => {
    if (!revealed || !focusTake.current) return;
    focusTake.current = false;
    agentsTake.current?.focus();
  }, [revealed]);
  const [busy, setBusy] = useState(false);
  const [changedBy, setChangedBy] = useState<ChangedBy | null>(null);
  /** Set when a change on disk cleared the option the human had picked. */
  const [choiceCleared, setChoiceCleared] = useState(false);
  /** That option, put back if the card returns to the version it was picked on. */
  const clearedPick = useRef<string | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const noticeButton = useRef<HTMLButtonElement>(null);
  /** Where focus was when a send was refused, to go back to once the change is read. */
  const focusAfterReading = useRef<HTMLElement | null>(null);
  const [focusNotice, setFocusNotice] = useState(false);
  const version = (hub.versions[project] ?? 0) + hub.reconnects;
  const undoGroup = `undo:${project}/${id}`;
  /** The card's conversation on this machine (E). */
  const cardChat = useCardChat(project, id);
  const wide = useMinWidth(SIDE_PANEL_MIN_PX);
  /**
   * The conversation panel is shown: open by default once the card has a conversation
   * (#0002), then as the human toggles it (`c`) during this visit.
   */
  const [chatOpen, setChatOpen] = useState<boolean>();
  const chatLoaded = cardChat.chat !== undefined;
  /** The new-options run of the card's latest "neither" (#0007), while it concerns the card. */
  const newOptions = cardChat.chat?.newOptions;
  // A "neither" always leaves a conversation, its message pending at first (202611111gpm).
  const hasConversation =
    (cardChat.chat?.messages.length ?? 0) > 0 ||
    (newOptions !== undefined && newOptions.state !== "written");
  useEffect(() => {
    if (chatLoaded) setChatOpen((open) => open ?? hasConversation);
  }, [chatLoaded, hasConversation]);
  /** For the notice on leaving (#0024): read when the view goes away. */
  const unsummarized = useRef(false);
  unsummarized.current = cardChat.chat?.unsummarized === true;

  const queue = buildQueue(hub.cards, hub.projectFilter);
  const position = queue.findIndex((c) => c.project === project && c.id === id);

  /** The human has read this version: from now on actions are taken on it. */
  const acknowledge = useCallback(
    (card: CardDetailDto) => {
      updateDraft({ seen: card });
      setChangedBy(null);
      setChoiceCleared(false);
      clearedPick.current = undefined;
    },
    [updateDraft],
  );

  /** "I've read it": then back to what they were doing when the send was refused. */
  const readIt = (card: CardDetailDto) => {
    acknowledge(card);
    const back = focusAfterReading.current;
    focusAfterReading.current = null;
    // After the notice (which has focus) is gone.
    setTimeout(() => {
      if (back?.isConnected) back.focus();
      else heading.current?.focus();
    }, 0);
  };

  // A refused send moves focus to the notice, so the human can read it and go on.
  useEffect(() => {
    if (focusNotice && changedBy) {
      noticeButton.current?.focus();
      setFocusNotice(false);
    }
  }, [focusNotice, changedBy]);

  /** Loads the card; true if it changed in a way the human has to read again. */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const seen = latest.current.seen;
      const res = await api.card(project, id, seen?.revision);
      if (!res.ok) {
        setLoaded({ state: "broken", broken: res.broken });
        return false;
      }
      const card = res.card;
      setLoaded({ state: "ok", card });
      if (seen?.revision === card.revision) {
        // Back at the version the human read (a reload mid-pull caught the card in between,
        // say): nothing is unread, so no notice either, and a pick the in-between version
        // cleared comes back.
        if (clearedPick.current && !latest.current.selected) {
          updateDraft({ selected: clearedPick.current });
        }
        clearedPick.current = undefined;
        setChangedBy(null);
        setChoiceCleared(false);
        return false;
      }
      // First load, our own action (here, or undone from a toast), or nothing the human has
      // to look at again (an agent marking notes read): nothing to point out.
      if (
        !seen ||
        wroteHere(project, id, card.revision) ||
        describeChanges(seen, card).length === 0
      ) {
        acknowledge(card);
        return false;
      }
      // The human hasn't read this version: actions keep carrying the revision they read,
      // so the server refuses them until they acknowledge the change. The server knows
      // whether only president (the human, in another tab) changed it since.
      // A reload while a Sync pulls (the watcher) can come before the Sync knows what it
      // brought in; the reload on the Sync's own `cards` event picks the sentence again.
      setChangedBy(card.writtenByPresident ? "other-tab" : card.changedBySync ? "sync" : "agent");
      if (latest.current.selected) {
        // The options may now mean something else: never keep a choice made on the old text.
        clearedPick.current = latest.current.selected;
        updateDraft({ selected: undefined });
        setChoiceCleared(true);
      }
      return true;
    } catch (error) {
      setLoaded({ state: "error", message: (error as Error).message });
      return false;
    }
  }, [project, id, acknowledge, updateDraft, latest]);

  // Load on open and again whenever this project's files change on disk.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refetch trigger
  useEffect(() => {
    void load();
  }, [load, version]);

  const card = loaded.state === "ok" ? loaded.card : undefined;
  const fm = card?.frontmatter;
  const seen = draft.seen;

  // A new pick (new options after "neither") is hidden again, even if the old one was shown
  // during this visit (2026111272fu `reset`).
  const pick = fm?.recommendation ? JSON.stringify(fm.recommendation) : undefined;
  const shownPick = useRef(pick);
  useEffect(() => {
    if (shownPick.current !== pick) setRevealed(false);
    shownPick.current = pick;
  }, [pick]);
  /**
   * The panel shown. A card decided elsewhere (another tab, Sync) while the Neither panel is
   * open can't take its actions any more, so it isn't shown; the text stays as a draft.
   */
  const shownPanel: Panel = fm?.status === "resolved" && panel === "neither" ? null : panel;
  const changes = card && seen && changedBy ? describeChanges(seen, card) : [];

  // Forget a selection whose option an agent removed.
  useEffect(() => {
    if (fm && draft.selected && !fm.options.some((o) => o.id === draft.selected)) {
      updateDraft({ selected: undefined });
    }
  }, [fm, draft.selected, updateDraft]);

  // An undo put back the text of a "neither": open its panel again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draft` changes when an undo restores it
  useEffect(() => {
    const restored = takePanel(project, id);
    if (restored) setPanel(restored);
  }, [project, id, draft]);

  // Move focus to the new card's title, so keyboard and screen reader users start there.
  const ready = loaded.state !== "loading";
  useEffect(() => {
    if (ready) heading.current?.focus();
  }, [ready]);

  // Leaving the card with unsent text keeps it (drafts.ts); say so, so nobody retypes it.
  useEffect(() => {
    const key = `${project}/${id}`;
    openViews.set(key, (openViews.get(key) ?? 0) + 1);
    return () => {
      openViews.set(key, (openViews.get(key) ?? 1) - 1);
      // Checked a moment later: React's StrictMode unmounts and mounts again at once.
      setTimeout(() => {
        if (openViews.get(key)) return;
        if (unsentText(latest.current)) {
          toast(`What you typed on #${id} is kept; it's there when you come back.`);
        }
        // #0024 (and 202611111ky9 on decided cards): leaving saves nothing and runs nothing.
        if (unsummarized.current) {
          toast(`Your conversation on #${id} isn't summarized; it's there when you come back.`);
        }
      }, 0);
    };
  }, [project, id, toast, latest]);

  const goTo = (target: CardDto | undefined) => {
    if (target) navigate(cardPath(target.project, target.id));
  };
  /** Where to go once this card leaves the queue. */
  const afterThis = (): CardDto | undefined => {
    if (position === -1) return queue.find((c) => !(c.project === project && c.id === id));
    return queue[position + 1] ?? queue[position - 1];
  };

  const act = async (action: CardAction, options: ActOptions = {}) => {
    if (!card || !seen || busy) return false;
    setBusy(true);
    const next = afterThis();
    // A new action on this card makes an older undo for it meaningless.
    dismissToasts(undoGroup);
    try {
      // The revision the human read, not the newest one: if the card changed since, the
      // server refuses, and they see what changed first.
      const res = await api.act(project, id, action, seen.revision);
      setLoaded({ state: "ok", card: res.card });
      acknowledge(res.card);
      // What the action sent, to put back as a draft if it is undone.
      const sent = options.sent ?? {};
      const wasSent = Object.fromEntries(
        Object.keys(sent).map((field) => [field, latest.current[field as keyof Draft]]),
      ) as Partial<Draft>;
      if (options.sent) updateDraft(options.sent);
      void hub.refresh();
      if (options.done) {
        const after = res.card.revision;
        // Every action can be undone (a note sent too early, a reopen by mistake), and an
        // undone Neither or Note (or an answer decided from the Neither panel) opens its
        // panel again with the text.
        const panelToRestore: DraftPanel | undefined =
          options.panel ??
          (action.type === "neither" || action.type === "note" ? action.type : undefined);
        // Ask for new options: the run starts only once this Undo notice is gone, so an Undo
        // before then leaves nothing anywhere (20261112160s `wait-out`).
        const note =
          action.type === "neither"
            ? res.card.frontmatter.feedback.findLast((f) => f.type === "neither")?.at
            : undefined;
        if (note) holdUndo(project, id, note);
        const onClose = note ? () => startWhenUndoCloses(project, id, note) : undefined;
        const undo = {
          label: "Undo",
          key: "u",
          run: () => {
            api
              .undo(project, id, after)
              .then(() => {
                hub.cardsChanged(project);
                return hub.refresh();
              })
              .then(() => {
                if (note) releaseUndo(project, id, note);
                restoreDraft(project, id, wasSent, panelToRestore);
                navigate(cardPath(project, id));
                toast(
                  // An undone decision leaves a note in the history, so agents hear of it.
                  `Undone. #${id} is ${action.type === "resolve" ? "undecided again" : "back as it was"}${unsentText({ ...NO_DRAFT, ...wasSent }) ? ", with what you wrote" : ""}.`,
                );
              })
              .catch((error: Error) => {
                if (error instanceof RequestError && error.code === "syncing") {
                  // Nothing was undone, and Sync is about to push the decision: keep the
                  // undo within reach, so it can be tried again once Sync ends.
                  toast(`Not undone yet: ${error.message}`, {
                    tone: "error",
                    action: undo,
                    group: undoGroup,
                    ...(onClose ? { onClose } : {}),
                  });
                  return;
                }
                // 20261112dfik `refuse-undo`: another tab started the run for this note.
                const runStarted = error instanceof RequestError && error.code === "run_started";
                toast(`Couldn't undo: ${error.message}${runStarted ? "." : ""}`, {
                  tone: "error",
                });
                // The note stays sent, so its run starts (if it hasn't already).
                onClose?.();
              });
          },
        };
        const done = typeof options.done === "string" ? options.done : options.done(res.card);
        toast(done, { action: undo, group: undoGroup, ...(onClose ? { onClose } : {}) });
      }
      if (options.leave) {
        if (next) goTo(next);
        else {
          navigate("/");
          toast("That was the last card in the queue.");
        }
      }
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.code === "conflict") {
        const from = document.activeElement;
        const mustRead = await load();
        if (mustRead) {
          focusAfterReading.current = from instanceof HTMLElement ? from : null;
          setFocusNotice(true);
        }
        toast(
          mustRead
            ? "This card changed since you read it, so nothing was sent. See what changed at the top of the card; what you typed is kept."
            : "This card was updated on disk (nothing you need to read again), so nothing was sent. Please try again.",
          { tone: "error" },
        );
      } else {
        toast((error as Error).message, { tone: "error" });
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const isActive = fm?.status === "open" || fm?.status === "deferred";
  const options = fm?.options ?? [];
  const selected = draft.selected;

  const decide = async (
    choice: string | undefined,
    note: string,
    sent: Partial<Draft>,
    panel?: DraftPanel,
  ) => {
    if (!card || !fm || !choice) return false;
    const option = fm.options.find((o) => o.id === choice);
    const label = option ? option.title : "your own answer";
    const ok = await act(
      { type: "resolve", choice, note: note.trim() || undefined },
      { leave: true, done: `Decided #${id}: ${label}.`, sent, ...(panel ? { panel } : {}) },
    );
    if (ok) recordDecision(project, id);
    return ok;
  };

  /**
   * Saves an edited conversation summary as a `chat` entry (#0003, #0023), on decided cards
   * too (#0020), but never inside the Undo window of a decision made here (#0006).
   */
  const saveSummary = (summary: string) => {
    if (decidedRecently(project, id)) {
      toast(
        `#${id} was decided a moment ago and can still be undone; save the summary once its Undo notice has closed.`,
        { tone: "error" },
      );
      return Promise.resolve(false);
    }
    return act({ type: "chat", note: summary }, { done: "Summary saved.", sent: { summary: "" } });
  };

  /** `d` and the Defer menu work on open cards and on cards back from deferral (#0017). */
  const canDefer = card !== undefined && (fm?.status === "open" || isBackFromDeferral(card));

  /**
   * Defers the card until `until`, or for a week (the hub's default) without it, unless the
   * human typed something for it that isn't sent.
   */
  const defer = (until?: Date) => {
    // Deferring would leave what they typed behind, unsent, on a card out of the queue.
    if (unsentText(latest.current)) {
      toast("You have typed something on this card that isn't sent. Send or clear it first.");
      return;
    }
    setDeferMenu(false);
    void act(until ? { type: "defer", until: until.toISOString() } : { type: "defer" }, {
      leave: true,
      done: (after) => {
        const back = after.frontmatter.defer_until;
        return back ? `Deferred #${id} until ${fullDate(back)}.` : `Deferred #${id}.`;
      },
    });
  };

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!isActive || !option) return false;
    updateDraft({ selected: option.id });
    return undefined;
  };

  const openPanel = (next: Panel) => {
    setPanel(next);
  };
  /** Closes the Neither/Note panel. What was typed stays as a draft. */
  const closePanel = () => {
    if (panel && latest.current[panel].trim()) {
      toast(
        `Your ${panel === "neither" ? "answer" : "note"} is kept as a draft; press ${panel === "neither" ? "n" : "m"} to finish it.`,
      );
    }
    setPanel(null);
  };

  const keys: KeyMap = {
    j: () => goTo(position === -1 ? queue[0] : queue[position + 1]),
    k: () => goTo(position === -1 ? queue.at(-1) : queue[position - 1]),
    enter: () => {
      if (!selected) return false;
      void decide(selected, draft.decisionNote, { selected: undefined, decisionNote: "" });
    },
    n: () => {
      if (!isActive || options.length === 0) return false;
      openPanel("neither");
    },
    m: () => {
      // Notes work on decided cards too (#0011).
      if (!fm) return false;
      openPanel("note");
    },
    d: () => {
      if (!canDefer) return false;
      defer();
    },
    r: () => {
      if (!fm?.recommendation || revealed) return false;
      reveal(false);
    },
    escape: () => navigate("/"),
    // Shows or hides the conversation (#0002).
    c: () => {
      if (!chatLoaded) return false;
      setChatOpen((open) => !open);
    },
  };
  // Shift+d opens the Defer menu (#0017); `d` itself never waits for a second key.
  keys.D = () => {
    if (!canDefer) return false;
    setDeferMenu(true);
  };
  for (let i = 0; i < 9; i++) keys[String(i + 1)] = () => selectIndex(i);
  if (fm?.kind === "ab") {
    keys.a = () => selectIndex(0);
    keys.b = () => selectIndex(1);
  }
  useKeyboard(keys, loaded.state !== "loading");
  // While the Neither/Note panel is open, nothing else on the page reacts to keys.
  useKeyLayer({ escape: closePanel }, shownPanel !== null);
  // The same for the Defer menu (it holds no text, so Esc just closes it).
  useKeyLayer({ escape: () => setDeferMenu(false) }, deferMenu && canDefer && shownPanel === null);

  if (loaded.state === "loading") return <p className="muted">Loading…</p>;
  if (loaded.state === "error") {
    return (
      <div className="empty">
        <p>{loaded.message}</p>
        <Link to="/">Back to the queue</Link>
      </div>
    );
  }
  if (loaded.state === "broken") return <BrokenCard broken={loaded.broken} />;
  if (!card || !fm) return null;

  const sections = new Map(card.sections.options.map((s) => [s.id, s.markdown]));
  const blockers = openDependencies(card, hub.cards);
  const unknown = hub.loaded ? unknownDependencies(card, hub.cards) : [];
  const chosen = fm.resolution?.choice;
  const recommended = fm.recommendation
    ? options.findIndex((o) => o.id === fm.recommendation?.option)
    : -1;

  return (
    <div
      className={`page card-page${fm.kind === "ab" ? " card-page-wide" : ""}${chatOpen && wide ? " card-page-chat" : ""}`}
    >
      <nav className="card-nav" aria-label="Queue navigation">
        <Link to="/" className="button button-quiet">
          ← Queue
        </Link>
        {position !== -1 && (
          <span className="muted small">
            {position + 1} of {queue.length}
          </span>
        )}
        <span className="card-nav-arrows">
          <button
            type="button"
            className="button button-quiet"
            disabled={position <= 0}
            onClick={() => goTo(queue[position - 1])}
          >
            Previous <kbd>k</kbd>
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={queue.length === 0 || position === queue.length - 1}
            onClick={() => goTo(position === -1 ? queue[0] : queue[position + 1])}
          >
            Next <kbd>j</kbd>
          </button>
        </span>
      </nav>

      <header className="card-header">
        <p className="card-meta">
          <span>{project}</span>
          <CardId id={card.id} />
          <span>{KIND_LABEL[fm.kind]}</span>
          <span className={`priority-label priority-label-${fm.priority}`}>
            {PRIORITY_LABEL[fm.priority]}
          </span>
          <span>
            by {fm.created_by},{" "}
            <time dateTime={fm.created} title={fullDate(fm.created)}>
              {timeAgo(fm.created)}
            </time>
          </span>
        </p>
        <h1 className="card-title" ref={heading} tabIndex={-1}>
          {fm.title}
          {position !== -1 && (
            <span className="sr-only">
              , card {position + 1} of {queue.length}
            </span>
          )}
        </h1>
        {fm.tags.length > 0 && (
          <p className="tags">
            {fm.tags.map((t, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: tags may repeat
              <span key={i} className="tag">
                {t}
              </span>
            ))}
          </p>
        )}
      </header>

      {changedBy && (
        <div
          className={`notice ${choiceCleared ? "notice-warn" : "notice-info"} notice-dismissable`}
          role="alert"
        >
          <div className="notice-body">
            <p>
              {changedBy === "agent" && newOptions?.state === "written"
                ? // The hub wrote them, from the card's session (#0007).
                  `New options, written from your note at ${clockTime(newOptions.note)}.`
                : CHANGED_BY_TEXT[changedBy]}{" "}
              {choiceCleared
                ? "Your choice was cleared. Read it again before deciding."
                : changedBy === "sync"
                  ? "Read what changed before you act on it."
                  : "What you see now is the new version. Read what changed before you act on it."}
            </p>
            {changes.length > 0 && (
              <ul className="changes">
                {changes.map((change, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: descriptions may repeat
                  <li key={i}>{change}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="button" ref={noticeButton} onClick={() => readIt(card)}>
            I've read it
          </button>
        </div>
      )}
      <StatusNotice
        card={card}
        newOptions={changedBy && newOptions?.state === "written" ? undefined : newOptions}
      />
      {blockers.length > 0 && isActive && (
        <p className="notice notice-warn">
          This depends on {blockers.map((b) => `#${b}`).join(", ")}, which{" "}
          {blockers.length === 1 ? "isn't" : "aren't"} decided yet.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="notice notice-warn">
          This card lists {unknown.map((b) => `#${b}`).join(", ")} in depends_on, but{" "}
          {unknown.length === 1 ? "that isn't another card" : "those aren't other cards"} in{" "}
          {project}. Ask an agent to fix it.
        </p>
      )}

      <Markdown className="card-context">{card.sections.context}</Markdown>

      {options.length > 0 && (
        <section aria-labelledby="options-heading">
          {fm.kind === "open" ? (
            <h2 id="options-heading" className="section-heading">
              Suggestions
            </h2>
          ) : (
            <h2 id="options-heading" className="sr-only">
              Options
            </h2>
          )}
          <div className={fm.kind === "ab" ? "options options-ab" : "options"}>
            {options.map((option, index) => (
              <OptionCard
                key={option.id}
                option={option}
                index={index}
                kind={fm.kind}
                details={sections.get(option.id)}
                recommended={revealed && index === recommended}
                selected={selected === option.id}
                chosen={chosen === option.id}
                selectable={isActive}
                onSelect={() => updateDraft({ selected: option.id })}
              />
            ))}
          </div>
        </section>
      )}

      {fm.recommendation &&
        recommended !== -1 &&
        (revealed ? (
          <aside
            className="recommendation"
            aria-label="Agent recommendation"
            ref={agentsTake}
            tabIndex={-1}
          >
            <h2 className="section-heading">The agent's take</h2>
            <p>
              <strong>
                {optionLabel(recommended, fm.kind)}. {options[recommended]?.title}
              </strong>
              {" — "}
              {fm.recommendation.why}
            </p>
          </aside>
        ) : (
          // #0008: hidden until asked, so the human forms a view of their own first.
          <p className="recommendation-reveal">
            <button
              type="button"
              className="button button-quiet"
              ref={revealButton}
              onClick={() => reveal(true)}
            >
              Show the agent's pick <kbd>r</kbd>
            </button>
          </p>
        ))}

      <Markdown className="card-appendix">{card.sections.appendix}</Markdown>

      <FeedbackHistory feedback={fm.feedback} seenAt={fm.seen_at} />
      {chatOpen ? (
        <CardChat
          card={card}
          chat={cardChat}
          context={{ revealed, revision: card.revision }}
          layout={wide ? "side" : "inline"}
          draft={draft}
          onDraft={updateDraft}
          onClose={() => setChatOpen(false)}
          onSaveSummary={saveSummary}
        />
      ) : (
        chatLoaded && (
          <p className="chat-closed">
            <button type="button" className="button" onClick={() => setChatOpen(true)}>
              {hasConversation ? "Show the conversation" : "Ask about this card"} <kbd>c</kbd>
            </button>
            {cardChat.chat?.unsummarized && (
              <span className="muted small"> Conversation not summarized yet.</span>
            )}
          </p>
        )
      )}

      <p className="muted small file-path">
        File: <code>{card.path}</code>
      </p>

      <ActionBar
        card={card}
        busy={busy}
        draft={draft}
        onDraft={updateDraft}
        panel={shownPanel}
        onPanel={(next) => (next ? openPanel(next) : closePanel())}
        onDiscard={() => {
          if (panel) updateDraft({ [panel]: "" });
          setPanel(null);
        }}
        onDecide={decide}
        onAct={act}
        canDefer={canDefer}
        onDefer={defer}
        deferMenu={deferMenu}
        onDeferMenu={setDeferMenu}
      />
    </div>
  );
}

function StatusNotice({
  card,
  newOptions,
}: {
  card: CardDetailDto;
  /** The new-options run (#0007), unless the "changed" notice already speaks of it. */
  newOptions: NewOptionsRunDto | undefined;
}) {
  const fm = card.frontmatter;
  if (fm.status === "open" && newOptions?.state === "written") {
    return (
      <p className="notice notice-info">
        New options, written from your note at {clockTime(newOptions.note)}.
      </p>
    );
  }
  if (isWaitingOnAgent(card) && newOptions?.state === "started") {
    return <p className="notice notice-info">Writing new options…</p>;
  }
  if (fm.status === "resolved" && fm.resolution) {
    const option = fm.options.find((o) => o.id === fm.resolution?.choice);
    return (
      <div className="notice notice-done">
        <p>
          <strong>Decided:</strong>{" "}
          {option
            ? option.title
            : fm.resolution.choice === CUSTOM_CHOICE
              ? "own answer"
              : fm.resolution.choice}
          {", "}
          <time dateTime={fm.resolution.resolved_at} title={fullDate(fm.resolution.resolved_at)}>
            {timeAgo(fm.resolution.resolved_at)}
          </time>
          .{" "}
          {fm.applied_at
            ? "An agent has applied it."
            : "Waiting for an agent to apply it to the project."}
        </p>
        {fm.resolution.note && <p className="resolution-note">{fm.resolution.note}</p>}
      </div>
    );
  }
  // Open, or back from deferral (R1-1): either way it waits on the agent.
  if (isWaitingOnAgent(card)) {
    return (
      <p className="notice notice-info">
        You asked for different options. An agent will rewrite this card; you can still pick one of
        these.
      </p>
    );
  }
  if (fm.status === "deferred") {
    // #0017 snooze; a deferred card without a date counts as due (202611112hzh, back-now).
    const until = fm.defer_until;
    if (!isBackFromDeferral(card)) {
      return (
        <p className="notice notice-info">
          Deferred until{" "}
          <time dateTime={until} title={until && timeAgo(until)}>
            {until && fullDate(until)}
          </time>
          . It comes back to the queue then.
        </p>
      );
    }
    return (
      <p className="notice notice-info">
        Back from deferral
        {until ? (
          <>
            : you deferred it until{" "}
            <time dateTime={until} title={timeAgo(until)}>
              {fullDate(until)}
            </time>
          </>
        ) : (
          ": it was deferred with no return date"
        )}
        . Press <kbd>d</kbd> to defer it again for a week.
      </p>
    );
  }
  return null;
}

function ActionBar(props: {
  card: CardDetailDto;
  busy: boolean;
  draft: Draft;
  onDraft: (patch: Partial<Draft>) => void;
  panel: Panel;
  onPanel: (panel: Panel) => void;
  onDiscard: () => void;
  onDecide: (
    choice: string | undefined,
    note: string,
    sent: Partial<Draft>,
    panel?: DraftPanel,
  ) => Promise<boolean>;
  onAct: (action: CardAction, options?: ActOptions) => Promise<boolean>;
  canDefer: boolean;
  onDefer: (until?: Date) => void;
  deferMenu: boolean;
  onDeferMenu: (open: boolean) => void;
}) {
  const { card, busy, draft, panel } = props;
  const { selected, answer } = draft;
  const fm = card.frontmatter;
  const neitherButton = useRef<HTMLButtonElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const deferMenuButton = useRef<HTMLButtonElement>(null);
  const lastPanel = useRef<Panel>(null);
  const lastMenu = useRef(false);

  useEffect(() => {
    // When a panel closes, put focus back on the button that opens it.
    if (!panel && lastPanel.current === "neither") neitherButton.current?.focus();
    else if (!panel && lastPanel.current === "note") noteButton.current?.focus();
    lastPanel.current = panel;
  }, [panel]);
  useEffect(() => {
    if (!props.deferMenu && lastMenu.current) deferMenuButton.current?.focus();
    lastMenu.current = props.deferMenu;
  }, [props.deferMenu]);

  if (panel) {
    const neither = panel === "neither";
    const text = draft[panel];
    /** #0010: settle the card with what was typed, as a custom answer. */
    const decideAsAnswer = async () => {
      if (!text.trim()) return;
      const ok = await props.onDecide(CUSTOM_CHOICE, text, { neither: "" }, "neither");
      if (ok) props.onPanel(null);
    };
    const submit = async () => {
      if (!text.trim()) return;
      const sent = { [panel]: "" };
      const ok = await props.onAct(
        { type: neither ? "neither" : "note", note: text },
        neither
          ? { leave: true, done: `Asked for new options on #${card.id}.`, sent }
          : { done: "Note added.", sent },
      );
      if (ok) props.onPanel(null);
    };
    return (
      <div className="action-bar action-bar-open">
        <form
          className="action-bar-inner action-panel"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="panel-text" className="action-panel-label">
            {neither
              ? "None of these. What would you rather see, or what is your answer?"
              : "Add a note for the agent"}
          </label>
          <textarea
            id="panel-text"
            // biome-ignore lint/a11y/noAutofocus: the panel opens on purpose to type into
            autoFocus
            rows={3}
            value={text}
            onChange={(event) => props.onDraft({ [panel]: event.target.value })}
            onKeyDown={(event) => {
              // Esc is handled by the panel's key layer (CardView), wherever focus is.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="action-panel-buttons">
            {text.trim() && (
              <button type="button" className="button button-quiet" onClick={props.onDiscard}>
                Discard
              </button>
            )}
            <button type="button" className="button" onClick={() => props.onPanel(null)}>
              Close <kbd>Esc</kbd>
            </button>
            <button type="submit" className="button button-primary" disabled={busy || !text.trim()}>
              {neither ? "Ask for new options" : "Add note"} <kbd>Ctrl ⏎</kbd>
            </button>
            {neither && (
              <button
                type="button"
                className="button"
                disabled={busy || !text.trim()}
                onClick={() => void decideAsAnswer()}
              >
                Decide this as my answer
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  if (fm.status === "resolved") {
    // #0011: a note on a decided card keeps the decision and whether it was applied.
    return (
      <div className="action-bar">
        <div className="action-bar-inner">
          <span className="muted">This decision is made.</span>
          <span className="action-bar-secondary">
            <button
              ref={noteButton}
              type="button"
              className="button"
              disabled={busy}
              onClick={() => props.onPanel("note")}
            >
              Note… <kbd>m</kbd>
            </button>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void props.onAct({ type: "reopen" }, { done: `Reopened #${card.id}.` })
              }
            >
              Reopen
            </button>
          </span>
        </div>
      </div>
    );
  }

  if (props.deferMenu && props.canDefer) {
    return (
      <DeferMenu busy={busy} onDefer={props.onDefer} onClose={() => props.onDeferMenu(false)} />
    );
  }

  const selectedIndex = fm.options.findIndex((o) => o.id === selected);
  const selectedOption = fm.options[selectedIndex];

  const isOpenKind = fm.kind === "open";
  const customAnswer = isOpenKind && !selectedOption;
  return (
    <div className="action-bar">
      <form
        className="action-bar-inner"
        onSubmit={(event) => {
          event.preventDefault();
          if (customAnswer) {
            void props.onDecide(answer.trim() ? CUSTOM_CHOICE : undefined, answer, { answer: "" });
          } else {
            void props.onDecide(selected, draft.decisionNote, {
              selected: undefined,
              decisionNote: "",
            });
          }
        }}
      >
        {customAnswer ? (
          <textarea
            className="answer"
            aria-label="Your answer"
            placeholder={
              fm.options.length > 0 ? "Pick a suggestion or write your answer" : "Your answer"
            }
            rows={2}
            value={answer}
            onChange={(event) => props.onDraft({ answer: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
        ) : (
          <>
            <span className="choice-summary">
              {selectedOption ? (
                <>
                  <span className="option-key">{optionLabel(selectedIndex, fm.kind)}</span>
                  <span className="choice-title">{selectedOption.title}</span>
                </>
              ) : (
                <span className="muted">
                  Pick an option <kbd>1</kbd>–<kbd>{Math.min(fm.options.length, 9)}</kbd>
                </span>
              )}
            </span>
            <input
              className="decision-note"
              aria-label="Why (optional)"
              placeholder="Why? (optional)"
              value={draft.decisionNote}
              disabled={!selectedOption}
              onChange={(event) => props.onDraft({ decisionNote: event.target.value })}
            />
          </>
        )}
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || (customAnswer ? !answer.trim() : !selectedOption)}
        >
          Decide <kbd>{customAnswer ? "Ctrl ⏎" : "⏎"}</kbd>
        </button>
        <span className="action-bar-secondary">
          {fm.options.length > 0 && (
            <button
              ref={neitherButton}
              type="button"
              className="button"
              disabled={busy}
              onClick={() => props.onPanel("neither")}
            >
              Neither… <kbd>n</kbd>
            </button>
          )}
          <button
            ref={noteButton}
            type="button"
            className="button"
            disabled={busy}
            onClick={() => props.onPanel("note")}
          >
            Note… <kbd>m</kbd>
          </button>
          {props.canDefer ? (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => props.onDefer()}
              >
                Defer a week <kbd>d</kbd>
              </button>
              <button
                ref={deferMenuButton}
                type="button"
                className="button"
                disabled={busy}
                onClick={() => props.onDeferMenu(true)}
              >
                Defer until… <kbd>D</kbd>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() =>
                void props.onAct(
                  { type: "reopen" },
                  { done: `Moved #${card.id} back to the queue.` },
                )
              }
            >
              Back to queue
            </button>
          )}
        </span>
      </form>
    </div>
  );
}

/** #0017: "Defer until: [Next week] Tomorrow  Next month  Pick a date…" */
function DeferMenu(props: { busy: boolean; onDefer: (until?: Date) => void; onClose: () => void }) {
  const { busy } = props;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const now = new Date();
  const earliest = dateInputValue(tomorrow(now));
  const pickedDay = startOfDay(picked);
  const pickedOk = pickedDay !== undefined && picked >= earliest;
  return (
    <div className="action-bar action-bar-open">
      <form
        className="action-bar-inner defer-menu"
        aria-labelledby="defer-menu-label"
        onSubmit={(event) => {
          event.preventDefault();
          if (pickedOk) props.onDefer(pickedDay);
        }}
      >
        <span className="action-panel-label" id="defer-menu-label">
          Defer until:
        </span>
        <button
          type="button"
          className="button button-primary"
          // biome-ignore lint/a11y/noAutofocus: the menu opens on purpose; Enter takes the default
          autoFocus
          disabled={busy}
          onClick={() => props.onDefer()}
        >
          Next week <kbd>⏎</kbd>
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => props.onDefer(tomorrow(new Date()))}
        >
          Tomorrow
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => props.onDefer(nextMonth(new Date()))}
        >
          Next month
        </button>
        {picking ? (
          <>
            <input
              type="date"
              aria-label="Date to bring the card back"
              // biome-ignore lint/a11y/noAutofocus: shown on purpose to pick a date
              autoFocus
              min={earliest}
              value={picked}
              onChange={(event) => setPicked(event.target.value)}
            />
            <button type="submit" className="button" disabled={busy || !pickedOk}>
              Defer
            </button>
          </>
        ) : (
          <button type="button" className="button" disabled={busy} onClick={() => setPicking(true)}>
            Pick a date…
          </button>
        )}
        <button type="button" className="button button-quiet" onClick={props.onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </form>
    </div>
  );
}

function BrokenCard({ broken }: { broken: BrokenCardDto }) {
  return (
    <div className="page">
      <nav className="card-nav">
        <Link to="/" className="button button-quiet">
          ← Queue
        </Link>
      </nav>
      <h1 className="card-title">This card is broken</h1>
      <p>
        <code>{broken.fileName}</code> in <strong>{broken.project}</strong> couldn't be read:
      </p>
      <ul className="broken">
        {broken.errors.map((error, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages may repeat
          <li key={i}>{error}</li>
        ))}
      </ul>
      <p className="muted">
        Ask an agent to fix the file. This page updates as soon as it's saved.
      </p>
    </div>
  );
}
