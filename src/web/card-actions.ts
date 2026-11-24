import { type RefObject, useRef, useState } from "react";
import type { CardAction } from "../core/actions.ts";
import type { CardDetailDto, CardDto } from "../core/api.ts";
import { api, RequestError } from "./api.ts";
import { decidedHere, forgetDecision, recordDecision } from "./app-writes.ts";
import type { Loaded } from "./card-load.ts";
import type { CardChat } from "./chat.ts";
import {
  type Draft,
  type Panel as DraftPanel,
  fillSummaryIfEmpty,
  patchDraftIf,
  restoreDraft,
  unsentText,
} from "./drafts.ts";
import { useFocusReturn } from "./focus.ts";
import { fullDate } from "./format.ts";
import { useHub } from "./hub.tsx";
import { cardPath, navigate } from "./router.tsx";
import { useDismissToasts, useToast, useToastShown } from "./toast.tsx";

export type Panel = DraftPanel | null;

/** What an action says once it is sent, from the card it produced. */
type Done = string | ((card: CardDetailDto) => string);

export interface ActOptions {
  leave?: boolean;
  done?: Done;
  sent?: Partial<Draft>;
  /** The panel to open again with the sent text if the action is undone. */
  panel?: DraftPanel;
  /** A decision that also closes the card's conversation (Decide without summary). */
  closeChat?: boolean;
}

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

/**
 * A decision waiting for the conversation's summary (#0019, 20261111is21): what Decide (or
 * "Decide this as my answer") was about to send, while the "Before deciding" box is open.
 */
interface PendingDecision {
  choice: string;
  note: string;
  sent: Partial<Draft>;
  panel: DraftPanel | undefined;
  /** The summary is being written. */
  writing: boolean;
  /** Why it couldn't be written. */
  error?: string;
  /**
   * Another summary run was already going (the panel's Write summary): no second one; its
   * summary fills the box when it is done, if the box is still empty.
   */
  summaryRunning?: boolean;
}

/**
 * The card view's actions (CardView): sending an action with its Undo, Decide and the
 * "Before deciding" box (#0019), saving a summary and Defer.
 */
export function useCardActions({
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
}: {
  project: string;
  id: string;
  card: CardDetailDto | undefined;
  fm: CardDetailDto["frontmatter"] | undefined;
  /** The version the human read. */
  seen: CardDetailDto | undefined;
  latest: RefObject<Draft>;
  cardChat: CardChat;
  revealed: boolean;
  undoGroup: string;
  viewGeneration: RefObject<number>;
  summaryRequest: RefObject<number>;
  leavingSummarized: RefObject<boolean>;
  setLoaded: (loaded: Loaded) => void;
  acknowledge: (card: CardDetailDto) => void;
  load: () => Promise<boolean>;
  focusAfterReading: RefObject<HTMLElement | null>;
  setFocusNotice: (focus: boolean) => void;
  afterThis: () => CardDto | undefined;
  goTo: (target: CardDto | undefined) => void;
  setPanel: (panel: Panel) => void;
  setDeferMenu: (open: boolean) => void;
}) {
  const hub = useHub();
  const toast = useToast();
  const dismissToasts = useDismissToasts();
  const toastShown = useToastShown();
  const [busy, setBusy] = useState(false);
  /** Decide is reading the conversation before deciding (it hadn't loaded yet). */
  const checkingChat = useRef(false);
  /** What opened the "Before deciding" box, for focus once Esc closes it. */
  const decideOpener = useRef<HTMLElement | null>(null);
  /** The action bar's Decide button (or the Neither panel's "Decide this as my answer"). */
  const decideButton = useRef<HTMLButtonElement>(null);
  /** The "Before deciding" box (#0019), open while a decision waits for the summary. */
  const [beforeDeciding, setBeforeDeciding] = useState<PendingDecision | null>(null);
  /** The conversation panel's Write summary is running (CardChat tells). */
  const panelWriting = useRef(false);

  // After Esc, focus goes back to what opened the box, or to Decide when that is gone.
  const refocusDecide = useFocusReturn(beforeDeciding, !beforeDeciding, () => {
    const opener = decideOpener.current;
    decideOpener.current = null;
    if (opener?.isConnected && opener !== document.body) opener.focus();
    else decideButton.current?.focus();
  });

  const act = async (action: CardAction, options: ActOptions = {}) => {
    if (!card || !seen || busy) return false;
    setBusy(true);
    const next = afterThis();
    // A new action on this card makes an older undo for it meaningless.
    dismissToasts(undoGroup);
    const generation = viewGeneration.current;
    // What the action sends, read now (this view is the card's current one): it is cleared
    // once sent only while the draft still holds it, and put back if the action is undone.
    const sent = options.sent ?? {};
    const wasSent = Object.fromEntries(
      Object.keys(sent).map((field) => [field, latest.current[field as keyof Draft]]),
    ) as Partial<Draft>;
    try {
      // The revision the human read, not the newest one: if the card changed since, the
      // server refuses, and they see what changed first.
      const res = await api.act(project, id, action, seen.revision, {
        closeChat: options.closeChat === true,
      });
      // Leaving: the reminder on leaving is due unless the hub says the conversation is
      // summarized (or closed) after this write.
      if (options.leave) leavingSummarized.current = res.unsummarized === false;
      // A decision's Undo window (see saveSummary) ends with any later action.
      if (action.type !== "resolve") forgetDecision(project, id);
      setLoaded({ state: "ok", card: res.card });
      // A view that has gone doesn't mark the card read in the stored draft: the view the
      // human is on now (if any) decides what they have read.
      if (generation === viewGeneration.current) acknowledge(res.card);
      // Through the store, field by field: this view may have gone (the human left the card
      // and came back), and what was typed or picked since, here or there, stays.
      if (options.sent) patchDraftIf(project, id, wasSent, options.sent);
      void hub.refresh();
      if (options.done) {
        const after = res.card.revision;
        // Every action can be undone (a note sent too early, a reopen by mistake), and an
        // undone Neither or Note (or an answer decided from the Neither panel) opens its
        // panel again with the text.
        const panelToRestore: DraftPanel | undefined =
          options.panel ??
          (action.type === "neither" || action.type === "note" ? action.type : undefined);
        // Undoing Ask for new options also stops its run (2026111459oa `trim`).
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
                forgetDecision(project, id);
                restoreDraft(project, id, wasSent, panelToRestore);
                navigate(cardPath(project, id));
                toast(
                  // An undone decision leaves a note in the history, so agents hear of it.
                  `Undone. #${id} is ${action.type === "resolve" ? "undecided again" : "back as it was"}${unsentText({ ...NO_DRAFT, ...wasSent }) ? ", with what you wrote" : ""}.`,
                );
              })
              .catch((error: Error) => {
                if (error instanceof RequestError && error.code === "syncing") {
                  // Nothing was undone while Sync pulls: keep the undo within reach, so it
                  // can be tried again once Sync ends.
                  toast(`Not undone yet: ${error.message}`, {
                    tone: "error",
                    action: undo,
                    group: undoGroup,
                  });
                  return;
                }
                toast(`Couldn't undo: ${error.message}`, { tone: "error" });
              });
          },
        };
        const done = typeof options.done === "string" ? options.done : options.done(res.card);
        toast(done, { action: undo, group: undoGroup });
      }
      // A view that has gone doesn't move the human on: they are wherever they went since.
      if (options.leave && generation === viewGeneration.current) {
        if (next) goTo(next);
        else {
          navigate("/");
          toast("That was the last card in the queue.");
        }
      }
      return true;
    } catch (error) {
      if (error instanceof RequestError && error.code === "conflict") {
        // A view that has gone neither reloads nor asks the human to try again: nothing was
        // sent, and the view they are on now shows the card as it is.
        if (generation !== viewGeneration.current) return false;
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

  /**
   * Records the decision, with the conversation's summary in the same write when given, or
   * closing the conversation without one (`closeChat`, Decide without summary: 20261112hq3k).
   */
  const resolve = async (
    choice: string,
    note: string,
    sent: Partial<Draft>,
    panel: DraftPanel | undefined,
    summary?: string,
    closeChat?: boolean,
  ) => {
    if (!card || !fm) return false;
    const option = fm.options.find((o) => o.id === choice);
    const label = option ? option.title : "your own answer";
    const ok = await act(
      { type: "resolve", choice, note: note.trim() || undefined, summary },
      {
        leave: true,
        done: `Decided #${id}: ${label}${summary !== undefined ? ", with the conversation's summary" : ""}.`,
        sent,
        ...(panel ? { panel } : {}),
        ...(closeChat ? { closeChat } : {}),
      },
    );
    if (ok) recordDecision(project, id);
    return ok;
  };

  /**
   * An agent summary (Decide's run, or Write summary in the panel) goes into the draft only
   * while the draft is empty: the agent never replaces text already in the summary box, so
   * what the human typed wins and the agent's summary is dropped. True when it was used.
   * Checked against the stored draft, not this view's: the run may end after the human left
   * the card and came back to a new view.
   */
  const takeAgentSummary = (summary: string): boolean => {
    if (fillSummaryIfEmpty(project, id, summary)) return true;
    if (!summary.trim()) {
      toast("The agent's summary came back empty; write one yourself.", { tone: "error" });
      return false;
    }
    toast("The agent's summary wasn't used: the summary box already has text.");
    return false;
  };

  /**
   * Decide, and "Decide this as my answer" from the Neither panel. When the card has a
   * conversation no saved summary covers on this machine (or one still answering), the
   * decision waits: "Writing a summary…", then the "Before deciding" box (#0019 `wait`,
   * 20261111is21 `wait`). False when nothing was decided (yet).
   */
  const decide = async (
    choice: string | undefined,
    note: string,
    sent: Partial<Draft>,
    panel?: DraftPanel,
  ) => {
    if (!card || !fm || !choice || busy || beforeDeciding || checkingChat.current) return false;
    const opener = document.activeElement;
    const generation = viewGeneration.current;
    let conversation = cardChat.chat;
    if (!conversation) {
      // Not loaded yet (a ⏎ right after the card showed): read it first, since it may hold
      // messages no summary covers.
      checkingChat.current = true;
      try {
        conversation = await api.chat(project, id);
      } catch (error) {
        if (generation !== viewGeneration.current) return false;
        toast(
          `Couldn't read this card's conversation (${(error as Error).message}), so nothing was decided; try again.`,
          { tone: "error" },
        );
        return false;
      } finally {
        checkingChat.current = false;
      }
      // The view left this card while the conversation was read: decide nothing.
      if (generation !== viewGeneration.current) return false;
    }
    const waits =
      conversation.unsummarized === true ||
      Boolean(conversation.running) ||
      cardChat.live !== undefined;
    if (!waits) return resolve(choice, note, sent, panel);
    decideOpener.current = opener instanceof HTMLElement ? opener : null;
    const pending = { choice, note, sent, panel };
    // The agent never replaces text already in the summary box: a draft there (whoever wrote
    // it, however old) is opened as it is, with no run. Only an empty box gets one.
    if (latest.current.summary.trim()) {
      setBeforeDeciding({ ...pending, writing: false });
      return false;
    }
    // A summary run is already going (Write summary in the panel): don't start a second one,
    // which the hub would refuse. The box opens to type in; that run's summary fills it if it
    // is still empty when it is done. The panel says it started one before the hub's copy does.
    if (conversation.running === "summary" || panelWriting.current) {
      setBeforeDeciding({ ...pending, writing: false, summaryRunning: true });
      return false;
    }
    const request = ++summaryRequest.current;
    setBeforeDeciding({ ...pending, writing: true });
    try {
      const { summary } = await cardChat.summarize({ revealed, revision: card.revision });
      if (request !== summaryRequest.current) return false;
      takeAgentSummary(summary);
      setBeforeDeciding({ ...pending, writing: false });
    } catch (error) {
      if (request !== summaryRequest.current) return false;
      setBeforeDeciding({ ...pending, writing: false, error: (error as Error).message });
    }
    return false;
  };

  /**
   * The "Before deciding" box's buttons. Decide without summary also closes the conversation
   * (20261112hq3k `ends`), as Close without summary does. Undo takes the decision back, with
   * the summary in the box and the "not summarized" reminder.
   */
  const finishDeciding = async (withSummary: boolean) => {
    const pending = beforeDeciding;
    if (!pending || pending.writing) return;
    const summary = latest.current.summary.trim();
    if (withSummary && !summary) return;
    const ok = await resolve(
      pending.choice,
      pending.note,
      { ...pending.sent, summary: "" },
      pending.panel,
      withSummary ? summary : undefined,
      !withSummary,
    );
    // Refused (the card changed, the hub is unreachable): back to the card, where the notice
    // says why; the summary stays in the box for the next Decide.
    setBeforeDeciding(null);
    // "Decide this as my answer": its Neither panel is done with.
    if (ok && pending.panel) setPanel(null);
  };

  /** Esc: back to the card without deciding; a summary written so far stays in the box. */
  const cancelDeciding = () => {
    summaryRequest.current++;
    refocusDecide.current = true;
    setBeforeDeciding(null);
  };

  /**
   * Saves an edited conversation summary as a `chat` entry (#0003, #0023), on decided cards
   * too (#0020), but never while the Undo notice of a decision made here is shown (#0006):
   * saving would take that Undo away.
   */
  const saveSummary = (summary: string) => {
    if (decidedHere(project, id) && toastShown(undoGroup)) {
      toast(
        `#${id} was decided a moment ago and can still be undone; save the summary once its Undo notice has closed.`,
        { tone: "error" },
      );
      return Promise.resolve(false);
    }
    return act(
      { type: "chat", note: summary },
      {
        done: "Summary saved.",
        sent: { summary: "" },
      },
    );
  };

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

  return {
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
  };
}
