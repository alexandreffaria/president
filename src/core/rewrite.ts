/**
 * What an agent's rewrite of a card may change, shared by `preside update` (cli/commands.ts)
 * and the hub's own new-options run (#0007, server/chat/service.ts): what the human owns must
 * be in the rewrite exactly as it is in the card now, so a note added since the rewrite was
 * made (or a decision, an undo) shows up as a difference and the card is left alone.
 */
import { deepEqual } from "./equal.ts";
import type { Frontmatter } from "./schema.ts";

/** What the human (and president) own in a card; an agent's rewrite keeps these as they are. */
export const HUMAN_FIELDS = [
  "status",
  "resolution",
  "feedback",
  "applied_at",
  "seen_at",
  "defer_until",
] as const;

/** How what the human owns differs from the card (`now`) to an agent's rewrite (`mine`). */
export function humanChanges(now: Frontmatter, mine: Frontmatter): string[] {
  const changes: string[] = [];
  const isPrefix = (short: Frontmatter["feedback"], long: Frontmatter["feedback"]) =>
    deepEqual(long.slice(0, short.length), short);
  const entries = (list: Frontmatter["feedback"]) =>
    list.map((f) => `${f.type ?? "note"} ${f.at}: ${continued(f.note, "    ")}`);
  if (now.feedback.length > mine.feedback.length && isPrefix(mine.feedback, now.feedback)) {
    const added = now.feedback.slice(mine.feedback.length);
    changes.push(
      `feedback: the human added ${added.length} ${added.length === 1 ? "entry" : "entries"} since you read the card:`,
      ...entries(added),
    );
  } else if (now.feedback.length < mine.feedback.length && isPrefix(now.feedback, mine.feedback)) {
    const gone = mine.feedback.slice(now.feedback.length);
    changes.push(
      `feedback: the human took back ${gone.length} ${gone.length === 1 ? "entry" : "entries"} since you read the card; drop ${gone.length === 1 ? "it" : "them"} from your version, and undo anything you changed for ${gone.length === 1 ? "it" : "them"}:`,
      ...entries(gone),
    );
  } else if (!deepEqual(now.feedback, mine.feedback)) {
    changes.push("feedback: your version's entries are not the card's; copy them unchanged");
  }
  for (const field of HUMAN_FIELDS) {
    if (field === "feedback" || deepEqual(now[field], mine[field])) continue;
    changes.push(
      `${field}: the card has ${describe(now[field])}, your version ${describe(mine[field])}`,
    );
  }
  return changes;
}

function describe(value: unknown): string {
  if (value === undefined) return "none";
  if (typeof value === "string") return `"${value}"`;
  const choice = (value as { choice?: unknown }).choice;
  return choice === undefined ? JSON.stringify(value) : `a decision ("${String(choice)}")`;
}

/**
 * Text that may span lines, with each line after the first indented to where a card's
 * notes start, so a note's own lines can't be mistaken for the output's structure.
 */
export function continued(text: string, indent = "      "): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => (i === 0 || line === "" ? line : indent + line))
    .join("\n");
}
