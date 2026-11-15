/**
 * Words about the new-options run (#0007) that the hub saves in the conversation and the
 * page shows, kept in one place.
 */

/**
 * When the run failed or its options were refused: nothing was written (202611111gpm).
 * `waits`: the card still waits on the note (not decided or rewritten meanwhile).
 */
export function newOptionsFailure(error: string, waits = true): string {
  return `Couldn't write new options: ${error}.${waits ? " The card waits for the project's agent, as before." : ""}`;
}
