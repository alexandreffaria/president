/**
 * The "neither" notes whose Undo notice this tab shows (20261112160s `wait-out`): their run
 * starts when the notice closes, so this tab says "Sending when Undo closes". Any other page
 * (another tab, this one after a reload) doesn't hold the notice and offers Start now
 * instead (20261112dfik `refuse-undo`). Kept only in memory: a reload forgets the notice too.
 */
import { useSyncExternalStore } from "react";
import { api } from "./api.ts";

const held = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const key = (project: string, id: string, note: string) => `${project}\0${id}\0${note}`;

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** This tab shows the Undo notice for the note recorded at `note`. */
export function holdUndo(project: string, id: string, note: string): void {
  held.add(key(project, id, note));
  changed();
}

/** The notice is gone (closed, or its Undo used). */
export function releaseUndo(project: string, id: string, note: string): void {
  if (held.delete(key(project, id, note))) changed();
}

/**
 * The notice closed without Undo: the run starts now. Nothing to say if it had already
 * started from another tab or the note is gone; a failure shows in the conversation.
 */
export function startWhenUndoCloses(project: string, id: string, note: string): void {
  releaseUndo(project, id, note);
  api.startNewOptions(project, id, { note }).catch(() => {
    // The hub is unreachable: the record still says "to start", so the card offers Start now.
  });
}

/** Whether this tab shows the Undo notice for the note recorded at `note`. */
export function useHoldsUndo(project: string, id: string, note: string | undefined): boolean {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  return note !== undefined && held.has(key(project, id, note));
}

/** For tests: forget every held notice. */
export function clearHeldUndos(): void {
  held.clear();
  changed();
}
