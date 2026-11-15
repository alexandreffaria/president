import { useEffect, useRef, useState } from "react";
import type { CardDto } from "../../core/api.ts";
import { KEYED_OPTIONS } from "../../core/model.ts";
import {
  buildQueue,
  describeDependencies,
  isBackFromDeferral,
  isWithdrawn,
  openDependencies,
  unknownDependencies,
} from "../../core/queue.ts";
import { type Panel, useCardActions } from "../card-actions.ts";
import { describeChanges } from "../card-changes.ts";
import { type ChangedBy, useCardLoad } from "../card-load.ts";
import { useCardChat, useMinWidth } from "../chat.ts";
import { ActionBar } from "../components/ActionBar.tsx";
import { BeforeDeciding } from "../components/BeforeDeciding.tsx";
import { BrokenCard } from "../components/BrokenCard.tsx";
import { CardChat } from "../components/CardChat.tsx";
import { CardId } from "../components/CardId.tsx";
import { FeedbackHistory } from "../components/FeedbackHistory.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { OptionCard } from "../components/OptionCard.tsx";
import { StatusNotice } from "../components/StatusNotice.tsx";
import { takePanel, unsentText, useDraft } from "../drafts.ts";
import { useFocusReturn } from "../focus.ts";
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
import { cardPath, Link, navigate } from "../router.tsx";
import { useToast } from "../toast.tsx";

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

/** Below this window width the conversation sits in the page's flow, not beside it (#0002). */
const SIDE_PANEL_MIN_PX = 1100;

/** How many views of each card are mounted ("project/id"). */
const openViews = new Map<string, number>();

// The order of the effects below (including those inside useFocusReturn, useCardLoad and
// useCardActions) is the order they were written in before the split; keep it.
export function CardView({ project, id }: { project: string; id: string }) {
  const hub = useHub();
  const toast = useToast();
  // `latest` is read inside async callbacks, where `draft` would be stale.
  const [draft, updateDraft, latest] = useDraft(project, id);
  const [panel, setPanel] = useState<Panel>(null);
  /** The Defer menu (#0017): other dates than `d`'s week. */
  const [deferMenu, setDeferMenu] = useState(false);
  /**
   * The agent's pick is shown (#0008, hidden until asked). Lasts until the human leaves the
   * card (20261111nsaj, visit) or starts a new conversation (20261112lvbu): the view is
   * mounted per card, and nothing is stored. On a card without a pick, r asks the chat for
   * the agent's view instead (20261112irpn `r-asks`), and this says it was asked.
   */
  const [revealed, setRevealed] = useState(false);
  const revealButton = useRef<HTMLButtonElement>(null);
  const agentsTake = useRef<HTMLElement>(null);
  /** Set when the reveal removes the focused button: focus then goes to the agent's take. */
  const focusTake = useFocusReturn(revealed, revealed, () => agentsTake.current?.focus());
  const reveal = (fromButton: boolean) => {
    focusTake.current = fromButton || document.activeElement === revealButton.current;
    // No pick: the view comes in the chat, so the panel opens, its message box focused.
    if (!card?.frontmatter.recommendation && chatOpen !== true) {
      focusTake.current = false;
      openChat();
    }
    setRevealed(true);
  };
  const heading = useRef<HTMLHeadingElement>(null);
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
  // The card has a new-options run (also while it waits for a reply): one note at a time.
  const optionsRun = cardChat.chat?.optionsRun === true;
  // A "neither" always leaves a conversation, before its message is saved too (202611111gpm).
  const hasConversation =
    (cardChat.chat?.messages.length ?? 0) > 0 ||
    (newOptions !== undefined && newOptions.state !== "written");
  useEffect(() => {
    if (chatLoaded) setChatOpen((open) => open ?? hasConversation);
  }, [chatLoaded, hasConversation]);
  /** Set when the human opens the panel (c, the button): focus goes to the message box. */
  const focusChat = useRef(false);
  const chatToggle = useRef<HTMLButtonElement>(null);
  /** Set when the panel hides with focus inside it: focus goes to the button that shows it. */
  const focusChatToggle = useFocusReturn(chatOpen, !chatOpen, () => chatToggle.current?.focus());
  const openChat = () => {
    focusChat.current = true;
    setChatOpen(true);
  };
  const hideChat = () => {
    focusChatToggle.current = document.activeElement?.closest(".chat") != null;
    setChatOpen(false);
  };
  /**
   * For the notice on leaving (#0024): read when the view goes away. A message this tab has
   * sent counts at once, as it does on the hub, before the copy says so.
   */
  const unsummarized = useRef(false);
  unsummarized.current =
    cardChat.chat?.unsummarized === true ||
    (cardChat.live?.saved.some((m) => m.from === "you") ?? false);
  /**
   * Set as a decision leaves the card when the hub answered that its conversation is
   * summarized now (its summary saved with it, or closed without one: 20261112hq3k), so no
   * reminder. A message the summary doesn't cover keeps the reminder.
   */
  const leavingSummarized = useRef(false);
  /** Counts summary requests, so one answered after Esc is ignored. */
  const summaryRequest = useRef(0);
  /** Bumped when this view leaves its card (unmount, another card): a Decide in flight stops. */
  const viewGeneration = useRef(0);
  // Its cleanup runs on unmount, which is also a card change: the view is keyed per card.
  useEffect(
    () => () => {
      viewGeneration.current++;
      summaryRequest.current++;
    },
    [],
  );

  const queue = buildQueue(hub.cards, hub.projectFilter);
  const position = queue.findIndex((c) => c.project === project && c.id === id);

  const {
    loaded,
    setLoaded,
    changedBy,
    choiceCleared,
    acknowledge,
    readIt,
    load,
    noticeButton,
    focusAfterReading,
    setFocusNotice,
  } = useCardLoad({ project, id, version, updateDraft, latest, viewGeneration, heading });

  const card = loaded.state === "ok" ? loaded.card : undefined;
  const fm = card?.frontmatter;
  const seen = draft.seen;

  // A new pick (new options after "neither") is hidden again, even if the old one was shown
  // during this visit (2026111272fu `reset`). On a card without a pick, new options end the
  // view asked for with r, as the hub does (20261112irpn): it was asked on the old ones.
  const pick = fm
    ? fm.recommendation
      ? JSON.stringify(fm.recommendation)
      : JSON.stringify(fm.options)
    : undefined;
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
        if (unsummarized.current && !leavingSummarized.current) {
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

  const {
    busy,
    act,
    decide,
    finishDeciding,
    cancelDeciding,
    takeAgentSummary,
    saveSummary,
    defer,
    beforeDeciding,
    setBeforeDeciding,
    decideButton,
    panelWriting,
  } = useCardActions({
    project,
    id,
    card,
    fm,
    seen,
    latest,
    cardChat,
    revealed,
    undoGroup,
    viewGeneration,
    summaryRequest,
    leavingSummarized,
    setLoaded,
    acknowledge,
    load,
    focusAfterReading,
    setFocusNotice,
    afterThis,
    goTo,
    setPanel,
    setDeferMenu,
  });

  const isActive = fm?.status === "open" || fm?.status === "deferred";
  const options = fm?.options ?? [];
  const selected = draft.selected;

  /**
   * `d` and the Defer menu work on open cards and on cards back from deferral (#0017). Not on
   * a withdrawn card: its date would be ignored while it is withdrawn (202611116ff6), and its
   * action bar offers Back to queue instead.
   */
  const canDefer =
    card !== undefined && !isWithdrawn(card) && (fm?.status === "open" || isBackFromDeferral(card));

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
      if (!isActive || options.length === 0 || optionsRun) return false;
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
      // On a card without a pick, r asks the chat for the agent's view (20261112irpn), once
      // the conversation is there to ask in.
      if (!fm || revealed || (!fm.recommendation && !chatLoaded)) return false;
      reveal(false);
    },
    escape: () => navigate("/"),
    // Shows or hides the conversation (#0002).
    c: () => {
      if (!chatLoaded) return false;
      if (chatOpen) hideChat();
      else openChat();
    },
  };
  // Shift+d opens the Defer menu (#0017); `d` itself never waits for a second key.
  keys.D = () => {
    if (!canDefer) return false;
    setDeferMenu(true);
  };
  for (let i = 0; i < KEYED_OPTIONS; i++) keys[String(i + 1)] = () => selectIndex(i);
  if (fm?.kind === "ab") {
    keys.a = () => selectIndex(0);
    keys.b = () => selectIndex(1);
  }
  useKeyboard(keys, loaded.state !== "loading");
  // While the Neither/Note panel is open, nothing else on the page reacts to keys.
  // The "Before deciding" box (#0019) replaces them while it is open, with its own layer.
  useKeyLayer({ escape: closePanel }, shownPanel !== null && !beforeDeciding);
  // The same for the Defer menu (it holds no text, so Esc just closes it).
  useKeyLayer(
    { escape: () => setDeferMenu(false) },
    deferMenu && canDefer && shownPanel === null && !beforeDeciding,
  );

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
          This depends on {describeDependencies(card, blockers, hub.cards)}, which{" "}
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

      {/* No pick (20261112irpn `r-asks`): r asks the chat for the agent's own view. */}
      {!fm.recommendation &&
        chatLoaded &&
        (revealed ? (
          <p
            className="recommendation-reveal"
            ref={(el) => {
              agentsTake.current = el;
            }}
            tabIndex={-1}
          >
            The agent's view is in the chat.
          </p>
        ) : (
          <p className="recommendation-reveal">
            <button
              type="button"
              className="button button-quiet"
              ref={revealButton}
              onClick={() => reveal(true)}
            >
              Ask for the agent's view <kbd>r</kbd>
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
          onAgentSummary={takeAgentSummary}
          onWriting={(writing, error) => {
            panelWriting.current = writing;
            // The run the "Before deciding" box was waiting for has ended: it no longer says
            // a summary is coming, and says why when the run failed.
            if (!writing) {
              setBeforeDeciding((pending) =>
                pending?.summaryRunning
                  ? { ...pending, summaryRunning: false, ...(error ? { error } : {}) }
                  : pending,
              );
            }
          }}
          onClose={hideChat}
          focusOnOpen={focusChat}
          onSaveSummary={saveSummary}
          deciding={beforeDeciding !== null}
          onNewConversation={() => setRevealed(false)}
        />
      ) : (
        chatLoaded && (
          <p className="chat-closed">
            <button type="button" className="button" ref={chatToggle} onClick={openChat}>
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

      {beforeDeciding ? (
        <BeforeDeciding
          writing={beforeDeciding.writing}
          error={beforeDeciding.error}
          summaryRunning={beforeDeciding.summaryRunning === true}
          summary={draft.summary}
          onSummary={(summary) => updateDraft({ summary })}
          busy={busy}
          onSaveAndDecide={() => void finishDeciding(true)}
          onDecideWithout={() => void finishDeciding(false)}
          onCancel={cancelDeciding}
        />
      ) : (
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
          decideButton={decideButton}
          onAct={act}
          canDefer={canDefer}
          onDefer={defer}
          deferMenu={deferMenu}
          onDeferMenu={setDeferMenu}
          optionsRun={optionsRun}
        />
      )}
    </div>
  );
}
