---
id: "202611111ky9"
title: What should happen when you leave a conversation on a decided card without closing it?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:23Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, summary, lifecycle]
depends_on: ["0024", "0020", "0011"]
recommendation:
  option: remind
  why: >-
    In 0020 you chose a conversation that works the same on every card, and a conversation
    after a decision is where afterthoughts that change the agent's work come up ("we should
    also rename the config key"). The same reminder as on open cards keeps those from being
    lost and costs nothing until you ask for the summary. Pick quiet if your questions on
    decided cards are mostly look-ups ("why did we pick this?") that need no summary.
options:
  - id: remind
    title: Remind you, as on open cards
    summary: Leaving saves nothing; the hub remembers the card has a conversation without a summary, says so when you leave, and the decided card offers Write summary when you come back.
    pros:
      - One rule for every card; nothing to learn
      - An afterthought that should reach the agent isn't lost because the card happened to be decided
    cons:
      - A quick look-up on an old decision also leaves a reminder until you close the conversation, saving its summary or not
      - Decided cards with pending reminders are easy to miss, since decided cards aren't in the queue
  - id: quiet
    title: Leave quietly
    summary: Leaving a conversation on a decided card saves nothing and leaves no reminder; to send a summary you close the conversation before leaving.
    pros:
      - Look-ups on past decisions leave no trace and no nagging
      - Fewer reminders overall
    cons:
      - A conclusion you reached but didn't close the conversation for never reaches the agent
      - Open and decided cards behave differently when you leave, which you have to remember
---

## Context

**What is decided.**

- [0020](0020-chat-on-decided-cards.md) (`chat-saved`): you can talk about a decided card, and
  closing the conversation offers the summary box; a saved summary is added to the decided card
  for the working agent to read, and the decision stays. This works because
  [0011](0011-notes-on-decided-cards.md) (`allow`) lets notes go on decided cards.
- [0024](0024-leaving-an-open-conversation.md) (`remind`): on **open and deferred** cards,
  leaving a conversation without closing it saves nothing; the hub remembers that the card has
  a conversation without a summary, says "Your conversation on #0042 isn't summarized; it's
  there when you come back.", and the card offers "Write summary" later.

**The gap.** 0024 covered open and deferred cards only. What leaving does on a **decided** card
is open (`docs/roadmap.md`, "Leaving a conversation without closing it", and "Needs a card",
item 9).

**Where you'd see it.** Decided cards aren't in the queue; you reach them from the Log
(`src/web/views/LogView.tsx`) or a link. Under `remind`, a reminder on a decided card shows
only when you open that card again, or in whatever list the hub keeps of unsummarized
conversations.

Example: #0043 "Rename the command" was decided last week. You ask its agent whether the README
uses the new name now; it says yes, but the help text still says the old one. You press Esc to
the queue.

## Option remind: Remind you, as on open cards

```
Your conversation on #0043 isn't summarized; it's there when you come back.
```

Back on #0043: "Conversation not summarized yet. [Write summary]". The saved summary reaches
the agent in `president pending` under "New notes from the human".

## Option quiet: Leave quietly

Esc goes to the queue with no notice. Back on #0043, the conversation is shown (0018) with no
reminder; closing it still offers the summary box.

## Technical detail (for the implementer)

- `remind`: the per-machine "not summarized" list from 0024 includes decided cards; saving the
  summary uses the action 0020 allows on resolved cards, with the Undo-window rule (nothing
  saved to a card decided less than 10 seconds ago).
- `quiet`: the list leaves out cards whose status is `resolved`.

## Sources

- Cards [0024](0024-leaving-an-open-conversation.md) (`remind`, "For open and deferred
  cards"), [0020](0020-chat-on-decided-cards.md) (`chat-saved`),
  [0011](0011-notes-on-decided-cards.md) (`allow`).
- `docs/roadmap.md`, "Leaving a conversation without closing it (#0024)", "Talking about a
  decided card (#0020)" and "Needs a card", item 9.
- Code: `src/web/views/LogView.tsx` (decided cards are listed in the Log, not the queue),
  `src/core/queue.ts` (`buildQueue` keeps open cards only).
