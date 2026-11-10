/**
 * What the human has typed or picked on a card but not sent yet. Kept per card for the
 * whole session, so closing a panel, leaving the card (j, k, Esc, a link, undo) or an agent
 * changing the card never throws it away. A draft goes once it is sent.
 */
import { type RefObject, useCallback, useRef, useState } from "react";
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

const drafts = new Map<string, Draft>();
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
