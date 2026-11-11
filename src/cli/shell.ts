/**
 * Quoting for commands that president prints for an agent to run as is (the `done:` line).
 */

/**
 * `value` as one word in a POSIX shell (sh, bash, zsh): unchanged when it has only
 * characters no shell treats specially, otherwise in single quotes, inside which nothing
 * is special. A `'` in it is written as `'\''` (close the quotes, an escaped quote, open
 * them again).
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
