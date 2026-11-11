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
}

const EMPTY: Draft = {
  seen: undefined,
  selected: undefined,
  decisionNote: "",
  answer: "",
  neither: "",
  note: "",
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
  return [draft.decisionNote, draft.answer, draft.neither, draft.note].some((t) => t.trim());
}

function worthKeeping(draft: Draft): boolean {
  return unsentText(draft) || draft.selected !== undefined;
}

/** For tests: forget every draft. */
export function clearDrafts(): void {
  drafts.clear();
  panels.clear();
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
  const next = { ...(drafts.get(k) ?? EMPTY), ...patch };
  if (worthKeeping(next)) drafts.set(k, next);
  if (panel) panels.set(k, panel);
  for (const listener of listeners.get(k) ?? []) listener(next);
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
  useEffect(() => {
    const listener = (next: Draft) => {
      // Keep what this view knows the human read; the rest comes from the store.
      const merged = { ...next, seen: latest.current.seen };
      latest.current = merged;
      setDraft(merged);
    };
    const set = listeners.get(k) ?? new Set();
    set.add(listener);
    listeners.set(k, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(k);
    };
  }, [k]);
  const update = useCallback(
    (patch: Partial<Draft>) => {
      // Stored right away, not in a state updater: the view may unmount before it renders
      // again (a decision moves on to the next card), and the store must not keep sent text.
      const next = { ...latest.current, ...patch };
      latest.current = next;
      if (worthKeeping(next)) drafts.set(k, next);
      else drafts.delete(k);
      setDraft(next);
    },
    [k],
  );
  return [draft, update, latest];
}
