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
 * - The new-options request after "neither" (#0007), with the `--json-schema` its answer
 *   follows: a message for the conversation next to the options (202611111gpm), which never
 *   names the new pick (2026111272fu `reset`).
 * - What the panel's Teach me and More info buttons ask for (#0005, 20261111fauj).
 */
import { createHash } from "node:crypto";
import type { ChatAsk, ChatMessageDto } from "../../core/api.ts";
import { CUSTOM_CHOICE, OPTION_ID_PATTERN } from "../../core/model.ts";
import { unseenFeedback } from "../../core/pending.ts";
import type { FeedbackEntry, Frontmatter } from "../../core/schema.ts";
import type { LoadedCard } from "../cards.ts";

export function sessionInstructions(card: LoadedCard): string {
  return [
    `You are talking with the human about one decision card in president, a hub where coding agents ask a human to decide things. The card is decisions/${card.fileName} in this project (project "${card.project}", card id ${card.id}). Read it before your first answer, and read it again whenever the human says it changed: its options, its sections and its \`feedback\` (the human's earlier notes; entries with \`type: chat\` summarize earlier conversations about it).`,
    "You can read this project's files and research the web. You can't change anything, and you never apply decisions or record them: the project's working agent does that later, from the card. When the human wants something done, say what they could put in a note or the conversation's summary for that agent.",
    "Each of the human's messages starts with a line from president in parentheses, \"(president: ...)\", saying whether the human has revealed the card's pick (its `recommendation`), or that the card has none. Follow it.",
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
 * What a card without a pick (no `recommendation`) is told: there is nothing to reveal, so
 * nothing false is said about `r`. It stays neutral; whether the chat may give its own view
 * on such a card is an open question for the human (docs/roadmap.md, "Needs a card").
 */
export const NO_PICK =
  "This card has no pick (no `recommendation`), so there is nothing for the human to reveal. Explain and compare the options without recommending one of your own; if asked which one to choose, say the card has no pick and keep your own view out of it.";

/**
 * The line about the pick for a conversation in which `revealed` (a pickHash) was revealed:
 * - the card has no pick: neutral, saying so;
 * - never revealed: neutral;
 * - the card's current pick was revealed: free;
 * - an earlier pick was revealed and new options replaced it: neutral about the new one.
 */
export function pickLine(
  card: Pick<LoadedCard, "frontmatter">,
  revealed: string | undefined,
): string {
  const current = pickHash(card);
  if (current === undefined) return NO_PICK;
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

/** The card's latest "neither" note, the one a new-options run answers. */
export function lastNeither(card: Pick<LoadedCard, "frontmatter">): FeedbackEntry | undefined {
  return card.frontmatter.feedback.findLast((entry) => entry.type === "neither");
}

/** Which options and pick a card has, to tell the ones the hub wrote from later ones. */
export function optionsHash(frontmatter: Pick<Frontmatter, "options" | "recommendation">): string {
  return createHash("sha256")
    .update(JSON.stringify([frontmatter.options, frontmatter.recommendation ?? null]))
    .digest("hex")
    .slice(0, 16);
}

/** How many options a card of this kind takes (the card checks, schema.ts; keys 1 to 9). */
export function optionCount(card: Pick<LoadedCard, "frontmatter">): { min: number; max: number } {
  switch (card.frontmatter.kind) {
    case "ab":
      return { min: 2, max: 2 };
    case "choice":
      return { min: 2, max: 9 };
    default:
      return { min: 1, max: 9 };
  }
}

/**
 * The `--json-schema` of a new-options run: the message shown in the conversation, the
 * options (each with an optional `## Option` section, its `details`) and the new pick
 * (202611111gpm).
 */
export function newOptionsSchema(card: Pick<LoadedCard, "frontmatter">): object {
  const { min, max } = optionCount(card);
  const text = { type: "string", minLength: 1 };
  return {
    type: "object",
    properties: {
      message: {
        ...text,
        description:
          "For the human, shown in the conversation: how the new options answer their note. Never say which option you recommend.",
      },
      options: {
        type: "array",
        minItems: min,
        maxItems: max,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              pattern: OPTION_ID_PATTERN.source,
              description: `A short lowercase slug such as "on-device"; not "${CUSTOM_CHOICE}".`,
            },
            title: { ...text, description: "One line." },
            summary: { ...text, description: "One sentence, on one line." },
            pros: { type: "array", items: text, description: "At most 2, each a short phrase." },
            cons: { type: "array", items: text, description: "At most 2, each a short phrase." },
            details: {
              ...text,
              description:
                "Optional; leave it out by default, and the option gets no section on the card. Markdown for the option's own section: a tiny example (a few lines of copy, code or a sketch), only when the choice is about how something looks or reads and the summary can't show it. Use ### or smaller headings, and close every code fence.",
            },
          },
          required: ["id", "title", "summary", "pros", "cons"],
          additionalProperties: false,
        },
      },
      recommendation: {
        type: "object",
        properties: {
          option: { type: "string", description: "The id of the option you recommend." },
          why: { ...text, description: "Why, in one or two sentences." },
        },
        required: ["option", "why"],
        additionalProperties: false,
      },
    },
    required: ["message", "options", "recommendation"],
    additionalProperties: false,
  };
}

/**
 * What a new-options run is asked (#0007): new options from the card and its unseen feedback,
 * the "neither" note first. `retry` is why the previous attempt couldn't be written.
 */
export function newOptionsRequest(card: LoadedCard, note: FeedbackEntry, retry?: string): string {
  const others = unseenFeedback(card.frontmatter).filter((entry) => entry !== note);
  const { min, max } = optionCount(card);
  const count = min === max ? `exactly ${min}` : `${min} to ${max}`;
  return [
    `Neither: the human rejected every option on this card and asked for new ones. Their note, at ${note.at}:`,
    note.note,
    ...(others.length > 0
      ? [
          "Their other notes since an agent last read the card:",
          others.map((entry) => `- ${entry.type ?? "note"}, ${entry.at}: ${entry.note}`).join("\n"),
        ]
      : []),
    ...(retry
      ? [`Your previous answer couldn't be written to the card: ${retry}. Fix that this time.`]
      : []),
    `Read the card again (decisions/${card.fileName}), research what you need, and write new options that answer the note: ${count} options (the card's kind is "${card.frontmatter.kind}") and your pick among them. Keep the card short: only what the human needs to choose. Give an option \`details\` (its own section) only for a tiny example when the choice is about how something looks or reads. They replace the card's options, their sections and its recommendation. president writes them to the card; you change nothing yourself.`,
    "Your `message` is shown to the human in this conversation: explain how the new options answer the note; don't say which you recommend. Your pick goes only in `recommendation`, which the human sees only when they ask for it.",
  ].join("\n\n");
}

/**
 * What the panel's buttons ask for (#0002's sketch: Teach me, More info). The hub's copy shows
 * the button's name as the human's message; the session gets the request.
 */
export const ASK_LABEL: Record<ChatAsk, string> = {
  teach: "Teach me",
  research: "More info",
};

/** The request behind a button, for this card. */
export function askRequest(ask: ChatAsk, card: Pick<LoadedCard, "frontmatter">): string {
  return ask === "teach" ? teachMeRequest(card) : MORE_INFO_REQUEST;
}

/**
 * Teach me (#0005 `worked`): one realistic scenario from the project, a prediction asked for
 * first, each option walked through it with where they differ, and what it leaves out. On a
 * card with no options (20261111fauj `scenario`): the same shape minus the comparison, and no
 * answers drafted by the agent. An `open` card that lists suggestions gets #0005's format on
 * them as is. The hub picks by `options.length === 0`, as the Neither button does.
 */
export function teachMeRequest(card: Pick<LoadedCard, "frontmatter">): string {
  const intro =
    "Teach me: I want to understand the background before I decide. Give me a worked example, in this order:";
  const tail =
    "Keep to this one scenario; we can go on talking afterwards. Follow the line about the pick: this is a lesson, not a recommendation.";
  if (card.frontmatter.options.length === 0) {
    return [
      intro,
      "1. Pick one realistic scenario from this project (read its files to find one) that an answer to this card would really have to handle.",
      '2. First ask me what I would want to happen in it, under the heading "First, a guess:".',
      "3. Then walk through, step by step, what any answer has to cope with in that scenario.",
      '4. Say what the scenario leaves out, under "What this leaves out:".',
      "The card has no options: it asks for my own answer. Don't draft candidate answers of your own, not even as examples; my ideas should come before yours.",
      tail,
    ].join("\n");
  }
  const options = card.frontmatter.kind === "open" ? "suggestions" : "options";
  return [
    intro,
    `1. Pick one realistic scenario from this project (read its files to find one) where the card's ${options} would play out differently.`,
    `2. First ask me to predict which of the ${options} handles it better, under the heading "First, a guess:", before any explanation.`,
    `3. Then walk each of the ${options} through the scenario step by step, as a table with one column per option, and point out where they differ, under "What made the difference:".`,
    '4. Say what the scenario leaves out, under "What this leaves out:".',
    tail,
  ].join("\n");
}

/**
 * More info / research (foundations.md, "Card interactions": "from primary sources, with
 * quotes"), a button of its own next to Teach me (#0005, #0002). Its answer is 20261112e1ik
 * `findings`: the two or three facts the decision turns on, each answered in a sentence or
 * two and backed by a quoted primary source and its link, then what couldn't be verified.
 */
export const MORE_INFO_REQUEST = [
  "More info: research this card's question further, from primary sources: this project's own files, official documentation, specifications and standards, papers.",
  'Under the heading "What this turns on:", name the two or three facts this decision turns on, as numbered questions.',
  "Answer each in a sentence or two, and back each answer with the passage that matters, quoted from a primary source, and its link or file path.",
  "Then, under \"Couldn't verify:\", say what you looked for and couldn't find or verify.",
  "Follow the line about the pick: report what the sources say without recommending an option.",
].join(" ");
