---
id: "20261112hq3k"
title: Does "Decide without summary" end the conversation's "not summarized" reminder?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:32:36Z
created_by: claude (PR 28 card writer)
tags: [pr-2, chat, decide, summary]
depends_on: ["0019", "20261111is21", "202611111ky9"]
recommendation:
  option: ends
  why: >-
    You only see "Decide without summary" after the summary box has opened, so pressing it is
    a deliberate "no summary for this one", the same thing "Close without summary" says, and
    0019, 0024 and the roadmap all say deciding ends a conversation. Keeping the reminder
    means a notice right after you said no, and one more reminder on a decided card, which
    202611111ky9 already noted is easy to miss. Esc keeps talking before deciding; Save and
    decide puts the chat on the card. Pick stays if you expect to press it meaning "decide now,
    summarize later".
options:
  - id: stays
    title: The reminder stays (as built)
    summary: >-
      Decide without summary records the decision and nothing else; the conversation stays
      "not summarized", so leaving shows the reminder and the decided card offers Write
      summary until you save one or close it without one.
    pros:
      - You can decide now and write the summary later, from the decided card
      - An afterthought from the conversation still has a way to reach the agent, as 202611111ky9 wanted for decided cards
      - Built and tested in pull request 28
    cons:
      - Right after you chose "without summary", a notice says the conversation isn't summarized
      - Decided cards collect reminders you reach only from the Log, and ending one takes a trip back to the card
      - '"Decide without summary" and "Close without summary" sound alike but do different things to the reminder'
  - id: ends
    title: Deciding without a summary also closes the conversation
    summary: >-
      Decide without summary records the decision and closes the conversation as "Close
      without summary" does; no reminder, no Write summary on the decided card, and nothing
      added to it.
    pros:
      - One click means "decided, and nothing from the chat for the agent"; no notice after it
      - Matches 0019 and 0024 ("A conversation ends when you close it or when you decide the card") and the two "without summary" buttons do the same thing to the conversation
      - Fewer stray reminders on decided cards
    cons:
      - If you meant "summarize later", the reminder is gone; you would need Save and decide instead (Esc only cancels deciding), or add a note to the decided card
      - A small change to build, and Undo has to bring the reminder back with the decision
resolution:
  choice: ends
  resolved_at: 2026-11-12T20:42:16Z
applied_at: 2026-11-13T01:50:43Z
---

## Context

Pull request 28 builds 0019's `wait`: deciding a card whose conversation isn't summarized
first writes a summary and shows the box **Save and decide ⏎**, **Decide without summary**,
**Esc** (20261111is21 does the same for "Decide this as my answer"). It also adds **Close
without summary** to the panel's summary box, which ends the "not summarized" reminder
without writing the card, because 202611111ky9 says the reminder lasts "until you close the
conversation, saving its summary or not".

What no card says: does **Decide without summary** end that reminder too? 0019 calls it
"today's Decide", which reads as "decide and nothing else"; 0019, 0024 and the roadmap also
say a conversation ends "when you close it or when you decide the card". Pull request 28
built the first reading: the reminder stays on the decided card.

Example: on #0042 you asked the agent whether the HTTP client throws on 404, and it does.
You pick B, press ⏎, read "Writing a summary…", and the box opens. You click **Decide
without summary**.

## Option stays: The reminder stays (as built)

```
Decided #0042: Return a result object.                         [Undo u]
Your conversation on #0042 isn't summarized; it's there when you come back.
```

Back on #0042 later (from the Log): "Conversation not summarized yet. [Write summary]".

## Option ends: Deciding without a summary also closes the conversation

```
Decided #0042: Return a result object.                         [Undo u]
```

Back on #0042 later: the messages are there, with no reminder. A new question starts a new
"not summarized" stretch as usual. Undo takes back the decision and brings the reminder back.

## Sources

- [0019](0019-decide-during-conversation.md) (`wait`): "a 'Decide without summary' button
  skips it"; context: "When a conversation ends (you close it, or you decide the card), the
  agent writes a short summary".
- [0024](0024-leaving-an-open-conversation.md), context: "A conversation ends when you close
  it or when you decide the card".
- [202611111ky9](202611111ky9-leaving-chat-on-decided-card.md) (`remind`), con: "a reminder
  until you close the conversation, saving its summary or not"; "Decided cards with pending
  reminders are easy to miss".
- `docs/roadmap.md`, section E, "Deciding while a conversation is open (#0019)": "**Decide
  without summary** is today's Decide."
- Pull request 28, description, "Needs a card", item 1, and its test "Decide without summary
  is today's Decide, and the reminder stays" (`test/web/chat.test.tsx`).
