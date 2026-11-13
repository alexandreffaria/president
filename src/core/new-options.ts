/**
 * Words about the new-options run (#0007) that the hub saves in the conversation and the
 * page shows, kept in one place.
 */

/** When the run failed or its options were refused: nothing was written (202611111gpm). */
export function newOptionsFailure(error: string): string {
  return `Couldn't write new options: ${error}. The card waits for the project's agent, as before.`;
}
