import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { BrokenCardDto, CardDetailDto } from "../core/api.ts";
import { api } from "./api.ts";
import { wroteHere } from "./app-writes.ts";
import { describeChanges } from "./card-changes.ts";
import type { Draft } from "./drafts.ts";

export type Loaded =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "broken"; broken: BrokenCardDto }
  | { state: "ok"; card: CardDetailDto };

/** Who or what changed the open card: another president tab, this hub's Sync, or an agent. */
export type ChangedBy = "agent" | "other-tab" | "sync";

/**
 * The card view's loading (CardView): the card as loaded, whether it changed since the human
 * read it, and "I've read it". Loads on open and whenever `version` changes.
 */
export function useCardLoad({
  project,
  id,
  version,
  updateDraft,
  latest,
  viewGeneration,
  heading,
}: {
  project: string;
  id: string;
  /** Bumped when this project's files change on disk (or the hub reconnects). */
  version: number;
  updateDraft: (patch: Partial<Draft>) => void;
  latest: RefObject<Draft>;
  /** Bumped when this view leaves its card: a load in flight is then dropped. */
  viewGeneration: RefObject<number>;
  /** The card's title, for focus after "I've read it" when the old focus is gone. */
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [changedBy, setChangedBy] = useState<ChangedBy | null>(null);
  /** Set when a change on disk cleared the option the human had picked. */
  const [choiceCleared, setChoiceCleared] = useState(false);
  /** That option, put back if the card returns to the version it was picked on. */
  const clearedPick = useRef<string | undefined>(undefined);
  const noticeButton = useRef<HTMLButtonElement>(null);
  /** Where focus was when a send was refused, to go back to once the change is read. */
  const focusAfterReading = useRef<HTMLElement | null>(null);
  const [focusNotice, setFocusNotice] = useState(false);

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
      const generation = viewGeneration.current;
      const res = await api.card(project, id, seen?.revision);
      // The view left this card while it loaded: the new view loads it itself.
      if (generation !== viewGeneration.current) return false;
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
  }, [project, id, acknowledge, updateDraft, latest, viewGeneration]);

  // Load on open and again whenever this project's files change on disk.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the refetch trigger
  useEffect(() => {
    void load();
  }, [load, version]);

  return {
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
  };
}
