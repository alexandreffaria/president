/**
 * What the human has typed or picked on a card but not sent yet. Kept per card for the
 * whole session, so closing a panel, leaving the card (j, k, Esc, a link, undo) or an agent
 * changing the card never throws it away. A draft goes once it is sent, and comes back if
 * the action that sent it is undone.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { CardDetailDto } from "../core/api.ts";

export interface Draft {
  /** The version of the card the human last read; actions carry its revision. */
  seen: CardDetailDto | undefined;
  selected: string | undefined;
  /** The optional "Why?" with a decision. */
  decisionNote: string;
  /** An answer in the human's own words (open cards). */
  answer: string;
  /** The Neither and Note panels' text. */
  neither: string;
  note: string;
  /** A message to the card's session, not sent yet. */
  chat: string;
  /** A conversation summary being edited, not saved yet (#0003). */
  summary: string;
}

const EMPTY: Draft = {
  seen: undefined,
  selected: undefined,
  decisionNote: "",
  answer: "",
  neither: "",
  note: "",
  chat: "",
  summary: "",
};

export type Panel = "neither" | "note";

const drafts = new Map<string, Draft>();
/** Views showing each card's draft, told when it is restored from outside. */
const listeners = new Map<string, Set<(draft: Draft) => void>>();
/** A panel to open when the card is next shown (its text was restored by an undo). */
const panels = new Map<string, Panel>();
const key = (project: string, id: string) => `${project}\0${id}`;

/** Typed text that hasn't been sent. */
export function unsentText(draft: Draft): boolean {
  return [
    draft.decisionNote,
    draft.answer,
    draft.neither,
    draft.note,
    draft.chat,
    draft.summary,
  ].some((t) => t.trim());
}

function worthKeeping(draft: Draft): boolean {
  return unsentText(draft) || draft.selected !== undefined;
}

/** For tests: forget every draft. */
export function clearDrafts(): void {
  drafts.clear();
  panels.clear();
}

/** The card's stored draft (empty when there is none). */
export function storedDraft(project: string, id: string): Draft {
  return drafts.get(key(project, id)) ?? EMPTY;
}

/**
 * Every change goes through here: only the fields in `patch` change, on the stored draft as
 * it is now (never a view's copy of it, which may be older: a view that has gone, or one
 * that awaited a request while the human typed elsewhere). A draft left with nothing worth
 * keeping is forgotten. Open views of the card are told, except `except` (the view writing,
 * which updates itself).
 */
function patchStored(k: string, patch: Partial<Draft>, except?: (draft: Draft) => void): Draft {
  const next = { ...(drafts.get(k) ?? EMPTY), ...patch };
  if (worthKeeping(next)) drafts.set(k, next);
  else drafts.delete(k);
  for (const listener of listeners.get(k) ?? []) if (listener !== except) listener(next);
  return next;
}

/**
 * Puts back what an action sent, once it is undone: the text and choice are a draft again,
 * and `panel` (the Neither panel) opens when the card is shown.
 */
export function restoreDraft(
  project: string,
  id: string,
  patch: Partial<Draft>,
  panel?: Panel,
): void {
  const k = key(project, id);
  if (panel) panels.set(k, panel);
  patchStored(k, patch);
}

export type TextField = "decisionNote" | "answer" | "neither" | "note" | "chat" | "summary";

/**
 * Puts back text a request didn't send (it was refused): into the stored draft, ahead of
 * anything typed in that box since, which is kept too. No other field is touched.
 */
export function putBack(project: string, id: string, field: TextField, text: string): void {
  const current = storedDraft(project, id)[field];
  patchStored(key(project, id), { [field]: current.trim() ? `${text}\n\n${current}` : text });
}

/**
 * Puts `text` in one field of the card's stored draft only while that field is empty: what
 * is in the box is never replaced, and no other field is touched. Read from the store, not a
 * view, so a result that lands after the view that asked for it has gone (the human left the
 * card and came back) still sees what was typed since. True when it was put in; never for
 * empty text.
 */
export function fillIfEmpty(project: string, id: string, field: TextField, text: string): boolean {
  if (!text.trim()) return false;
  if (storedDraft(project, id)[field].trim()) return false;
  patchStored(key(project, id), { [field]: text });
  return true;
}

/** fillIfEmpty for the summary box: an agent's summary, or one an undo brings back. */
export function fillSummaryIfEmpty(project: string, id: string, summary: string): boolean {
  return fillIfEmpty(project, id, "summary", summary);
}

/**
 * Sets each field of `patch` only while the stored draft still holds what `was` says it held
 * (compare-and-set): clearing what a request sent, once it is done, leaves alone what was
 * typed or picked since. Fields `was` doesn't name are set as they are.
 */
export function patchDraftIf(
  project: string,
  id: string,
  was: Partial<Draft>,
  patch: Partial<Draft>,
): void {
  const current = storedDraft(project, id);
  const changes = Object.fromEntries(
    Object.entries(patch).filter(
      ([field]) => !(field in was) || current[field as keyof Draft] === was[field as keyof Draft],
    ),
  ) as Partial<Draft>;
  if (Object.keys(changes).length > 0) patchStored(key(project, id), changes);
}

/** Clears the summary box only while it still holds `dropped` (Close without summary). */
export function clearSummaryIf(project: string, id: string, dropped: string): void {
  patchDraftIf(project, id, { summary: dropped }, { summary: "" });
}

/** The panel restoreDraft asked to open for this card, if any (once). */
export function takePanel(project: string, id: string): Panel | undefined {
  const k = key(project, id);
  const panel = panels.get(k);
  panels.delete(k);
  return panel;
}

/**
 * The card's draft, a function that changes part of it (and keeps it for later), and a ref
 * that always holds the latest draft (for callbacks that outlive a render).
 */
export function useDraft(
  project: string,
  id: string,
): [Draft, (patch: Partial<Draft>) => void, RefObject<Draft>] {
  const k = key(project, id);
  const [draft, setDraft] = useState<Draft>(() => drafts.get(k) ?? EMPTY);
  const latest = useRef(draft);
  /** This view's listener, once subscribed. */
  const self = useRef<((draft: Draft) => void) | null>(null);
  /** Set when the view unmounts (and cleared again by StrictMode's second mount). */
  const gone = useRef(false);
  useEffect(() => {
    const listener = (next: Draft) => {
      // Keep what this view knows the human read; the rest comes from the store.
      const merged = { ...next, seen: latest.current.seen };
      latest.current = merged;
      setDraft(merged);
    };
    self.current = listener;
    gone.current = false;
    const set = listeners.get(k) ?? new Set();
    set.add(listener);
    listeners.set(k, set);
    return () => {
      gone.current = true;
      self.current = null;
      set.delete(listener);
      if (set.size === 0) listeners.delete(k);
    };
  }, [k]);
  const update = useCallback(
    (patch: Partial<Draft>) => {
      // Stored right away, not in a state updater: the view may unmount before it renders
      // again (a decision moves on to the next card), and the store must not keep sent text.
      // Only the given fields change, on the stored draft: a view that has gone (an await
      // ended after the human left the card and came back) never writes its older copy over
      // what was typed in the new view.
      if (gone.current) {
        patchStored(k, patch);
        return;
      }
      // The version this view read is kept with the draft (the next view of the card starts
      // from it, to tell what changed since); that one field is this view's own.
      const next = patchStored(
        k,
        { seen: latest.current.seen, ...patch },
        self.current ?? undefined,
      );
      latest.current = next;
      setDraft(next);
    },
    [k],
  );
  return [draft, update, latest];
}
