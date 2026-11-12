---
id: "20261111is21"
title: Should "Decide this as my answer" wait for the conversation's summary, as Decide does?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:24Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, decide, summary]
depends_on: ["0019", "0010", "202611111ky9"]
recommendation:
  option: wait
  why: >-
    Your own answer is a decision like any other, and 0019's reason applies unchanged; the
    moment you decide is when you know what you concluded, and the summary is all the
    applying agent learns of the conversation. One rule for both ways of deciding is also
    easier to remember, and it doesn't rely on a later reminder, which card 202611111ky9
    may not keep on decided cards. Pick answer-only if what you type as your own answer
    usually already says everything the agent needs.
options:
  - id: wait
    title: Yes, it waits for the summary too
    summary: With an unsummarized conversation, "Decide this as my answer" first shows the agent's summary to edit, then saves the summary and your answer together; "Decide without summary" skips it.
    pros:
      - Both ways of deciding behave the same; nothing to remember
      - Your answer and the reasons from the conversation reach the agent together
      - Undo takes both back at once, as with Decide
    cons:
      - A few seconds' wait and one more agent run, even when your answer already says it all
      - Two boxes to fill in a row, your answer and then the summary
  - id: answer-only
    title: No, your answer is enough
    summary: '"Decide this as my answer" decides at once with what you typed; the conversation is left unsummarized and, if card 202611111ky9 keeps reminders on decided cards, reminded about later.'
    pros:
      - Deciding with your own words stays one click
      - You wrote the answer yourself, so it usually already holds what you concluded
    cons:
      - Two ways of deciding a card behave differently
      - Reasons from the conversation that aren't in your answer reach the agent only if you later write the summary, and if card 202611111ky9 chooses quiet, nothing reminds you to
---

## Context

**What is decided.**

- [0010](0010-custom-answer-on-choice-cards.md) (`neither-plus`): the Neither panel (`n`) has
  two buttons, **Ask for new options** and **Decide this as my answer**, which resolves the
  card with `choice: custom` and what you typed.
- [0019](0019-decide-during-conversation.md) (`wait`): when the card has a conversation without
  a summary on this machine, **Decide** first shows "Writing a summary...", then a box with
  the summary to edit and **Save and decide**, **Decide without summary** and **Esc**. Save
  and decide is one write that adds the summary and records the decision, so Undo takes both
  back.

**The gap.** 0019 only talks about Decide. "Decide this as my answer" also resolves the card,
and whether it waits the same way is open (`docs/roadmap.md`, "Deciding while a conversation
is open", and "Needs a card", item 10).

**What happens to a conversation left unsummarized.** Under
[0024](0024-leaving-an-open-conversation.md) the hub remembers it and the card offers "Write
summary" later; on a decided card that is the subject of the
[card on leaving a decided card's conversation](202611111ky9-leaving-chat-on-decided-card.md).

Example: on #0042 you talked with the agent, then press `n` and type "Throw for programmer
errors, return results for network failures." and click **Decide this as my answer**.

## Option wait: Yes, it waits for the summary too

```
┌ Before deciding: summary of your conversation ─────────────┐
│ Checked that the HTTP client throws on 404; agreed network  │
│ failures should be results, bugs should throw.              │
│ [Save and decide  ⏎]   [Decide without summary]   [Esc]      │
└──────────────────────────────────────────────────────────────┘
```

Your answer is the decision's note; the summary is a separate entry, as with Decide.

## Option answer-only: No, your answer is enough

The card is decided at once with your answer. If
[card 202611111ky9](202611111ky9-leaving-chat-on-decided-card.md) keeps reminders on decided
cards (`remind`), leaving shows "Your conversation on #0042 isn't summarized; it's there when
you come back." If it chooses `quiet`, you leave with no notice and nothing reminds you later.

## Technical detail (for the implementer)

- `wait`: the same `resolve` action as Save and decide, with `choice: custom`, the answer as
  the note and the summary as a `chat` entry, in one write, so `undoLastAction`'s
  `ours.action === "resolve"` check covers it (`src/server/cards.ts`).
- `answer-only`: today's `resolve` with `custom`; the conversation goes on the "not summarized"
  list, unless card 202611111ky9's `quiet` leaves resolved cards off that list.

## Sources

- Cards [0010](0010-custom-answer-on-choice-cards.md) (`neither-plus`),
  [0019](0019-decide-during-conversation.md) (`wait`),
  [0024](0024-leaving-an-open-conversation.md) (`remind`).
- `docs/roadmap.md`, "Your own answer from the Neither panel (#0010)", "Deciding while a
  conversation is open (#0019)" and "Needs a card", item 10.
- Code: `src/core/actions.ts` (`resolve` accepts `custom` with a note), `src/server/cards.ts`
  (`undoLastAction`), `src/web/views/CardView.tsx` (the Neither panel).
