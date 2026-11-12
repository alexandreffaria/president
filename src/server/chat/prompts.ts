/**
 * What the hub tells a card's session, besides the human's own words.
 *
 * - The instructions a session starts with (`--append-system-prompt` on its first run): which
 *   card it is about, that it only reads and researches, and that it never applies decisions
 *   (#0004, #0006).
 * - The line sent with every message about the card's pick (20261111mby8 `neutral`,
 *   2026111272fu `reset`). It goes with each message, not only in the system prompt, which
 *   Claude Code records once per conversation and reuses on every resume.
 * - The summary request (#0003, #0024) and, when Claude Code no longer has the session, the
 *   hub's copy it is written from (20261111paot).
 */
import { createHash } from "node:crypto";
import type { ChatMessageDto } from "../../core/api.ts";
import type { LoadedCard } from "../cards.ts";

export function sessionInstructions(card: LoadedCard): string {
  return [
    `You are talking with the human about one decision card in president, a hub where coding agents ask a human to decide things. The card is decisions/${card.fileName} in this project (project "${card.project}", card id ${card.id}). Read it before your first answer, and read it again whenever the human says it changed: its options, its sections and its \`feedback\` (the human's earlier notes; entries with \`type: chat\` summarize earlier conversations about it).`,
    "You can read this project's files and research the web. You can't change anything, and you never apply decisions or record them: the project's working agent does that later, from the card. When the human wants something done, say what they could put in a note or the conversation's summary for that agent.",
    "Each of the human's messages starts with a line from president in parentheses, \"(president: ...)\", saying whether the human has revealed the card's pick (its `recommendation`). Follow it.",
    "Answer plainly and briefly, and say where in the project or on the web each claim comes from.",
  ].join("\n\n");
}

/**
 * Which recommendation the human revealed, so a new one (new options after "neither") can be
 * told from it (2026111272fu). Undefined for a card without one.
 */
export function pickHash(card: Pick<LoadedCard, "frontmatter">): string | undefined {
  const pick = card.frontmatter.recommendation;
  if (!pick) return undefined;
  return createHash("sha256").update(JSON.stringify(pick)).digest("hex").slice(0, 16);
}

const NEUTRAL =
  "Until they do, explain and compare the options without naming the card's pick or recommending one of your own; if asked which one to choose, say the pick is behind r and keep your own view out of it until they have formed theirs.";

/**
 * The line about the pick for a conversation in which `revealed` (a pickHash) was revealed:
 * - never revealed: neutral;
 * - the card's current pick was revealed: free;
 * - an earlier pick was revealed and new options replaced it: neutral about the new one.
 */
export function pickLine(
  card: Pick<LoadedCard, "frontmatter">,
  revealed: string | undefined,
): string {
  const current = pickHash(card);
  if (revealed !== undefined && revealed === current) {
    return "The human has revealed the card's pick; you may discuss it freely and give your own view.";
  }
  if (revealed !== undefined) {
    return `The human revealed an earlier pick on this card, which the new options replaced; they have not revealed the new one. ${NEUTRAL}`;
  }
  return `The human has not revealed the card's pick. ${NEUTRAL}`;
}

/** A message as the session receives it: the pick line, then what the human wrote. */
export function withPickLine(line: string, text: string): string {
  return `(president: ${line})\n\n${text}`;
}

/**
 * What a session that starts over is told first, when this machine had a conversation it
 * no longer has, or the card has summaries of conversations held elsewhere (#0003, #0021).
 */
export function startOverNote(card: LoadedCard): string {
  const summaries = card.frontmatter.feedback.filter((entry) => entry.type === "chat");
  const intro =
    "An earlier conversation about this card isn't available here; this one starts from the card and its summaries.";
  if (summaries.length === 0) return intro;
  return [
    intro,
    "Summaries of earlier conversations (also in the card's feedback):",
    ...summaries.map((entry) => `- ${entry.at}: ${entry.note}`),
  ].join("\n");
}

export const SUMMARY_REQUEST = [
  "Write a short summary of this conversation for the project's working agent, who didn't hear it and will read it as a note from the human on the card.",
  "State what the human concluded and what they asked for (to check, change or keep in mind), not just what was discussed. Write it as the human's note, in a few plain sentences, for example: \"Discussed with the card's agent. I now see that ... Asked it to check whether ...\".",
  "Reply with the summary only.",
].join(" ");

/** The request for a summary of the messages after the last saved one, when there was one. */
export function summaryRequest(sinceLastSummary: boolean): string {
  return sinceLastSummary
    ? `${SUMMARY_REQUEST} A summary of the earlier part was already saved: cover only what came after it.`
    : SUMMARY_REQUEST;
}

/**
 * The summary request for a fresh one-off session, with the hub's copy of the messages
 * (20261111paot): Claude Code no longer has the conversation.
 */
export function summaryFromCopy(
  card: LoadedCard,
  messages: ChatMessageDto[],
  sinceLastSummary: boolean,
): string {
  const who = { you: "Human", agent: "Agent", hub: "president" } as const;
  const lines = messages.map((m) => `${who[m.from]}, ${m.at}:\n${m.text}`);
  return [
    `Below is a conversation about the decision card decisions/${card.fileName} in this project, as the human saw it. The agent that took part no longer remembers it.`,
    summaryRequest(sinceLastSummary),
    "The conversation:",
    ...lines,
  ].join("\n\n");
}
