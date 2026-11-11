---
id: "0019"
title: What should happen when you decide a card while a conversation about it is open?
status: open
kind: choice
priority: normal
created: 2026-11-11T15:58:25Z
created_by: claude (batch-2 writer)
tags: [pr-2, chat, decide, undo]
depends_on: ["0003", "0011"]
recommendation:
  option: wait
  why: >-
    The summary is the only part of the conversation the applying agent ever sees (#0003,
    #0006), and the moment you decide is when you know what you concluded. Writing it with
    the decision keeps Undo working as today and doesn't depend on #0011. The cost is one
    extra step and one agent run on cards you discussed; "Decide without summary" keeps the
    fast path. Pick later if you want Enter to stay one keypress everywhere and #0011 allows
    notes on decided cards. What happens when you leave a card without deciding is a separate
    question, #0024.
options:
  - id: wait
    title: Decide waits for the summary
    summary: With a conversation open, Decide first shows the agent's summary for you to edit, then saves the summary and the decision together; a "Decide without summary" button skips it.
    pros:
      - The decision and what you concluded reach the agent together, before it applies anything
      - Undo takes back both at once, exactly as today
      - Works whatever card 0011 decides
    cons:
      - Deciding a discussed card is no longer one keypress; you wait a few seconds for the summary and read it
      - Writing the summary is one more agent run, with its cost, each time you decide a discussed card
  - id: drop
    title: Decide right away and drop the summary
    summary: Decide works as today; an open conversation ends without a summary, and anything you want the agent to know goes in the decision's "Why?" note.
    pros:
      - Deciding stays one keypress, with nothing new to learn
      - Nothing extra to build or pay for
    cons:
      - What you learned in the conversation reaches the agent only if you type it into "Why?"
      - Easy to forget; the agent then applies the decision without the reasons or requests you discussed
  - id: later
    title: Decide right away, save the summary after
    summary: Decide works as today and the agent writes the summary in the background; once the 10-second Undo has passed, you edit it and it is added to the decided card as a note.
    pros:
      - Deciding stays one keypress and you keep the summary
      - You review the summary when you have a moment, not in the middle of deciding
    cons:
      - Needs card 0011 to allow notes on decided cards (or an exception just for summaries)
      - Writing the summary is one more agent run, with its cost, as in wait
      - An agent can apply the decision before the summary arrives, then has to revisit its work when the note comes in
      - The summary to review pops up on a later card, away from the one it is about
---

## Context

PR 2 adds a conversation with an agent on each card. When a conversation ends (you close it, or
you decide the card), the agent writes a short summary, you edit it, and it is added to the card
([#0003](0003-conversation-storage.md), option `summary`). That summary is all the project's
working agent learns about the conversation, since it applies the decision later from the card
alone ([#0006](0006-who-applies-decisions.md), option `working`). This card is about the moment
you decide while a conversation is open. What happens when you leave the card, close the tab or
restart the hub **without** deciding is [#0024](0024-leaving-an-open-conversation.md).

**How deciding works today.** You pick an option and press Enter (or click Decide). The card is
rewritten at once, the page moves to the next card in the queue, and a notice offers **Undo**
for 10 seconds (`decide` and `act` in `src/web/views/CardView.tsx`, `src/web/toast.tsx`). Undo
only works if nothing else has written the card since the decision (`undoLastAction` in
`src/server/cards.ts`). So a summary can't be saved onto the card during those 10 seconds
without making Undo fail: it has to be saved **with** the decision, or **after** the Undo window.
Decide also has an optional "Why?" field, saved as the decision's note, which
`president pending` prints next to the decision.

**Why not decided yet.** An earlier draft of `docs/roadmap.md` in PR #5 said the summary is
saved before the decision or in the same write. The review of PR #5 noted that this changes
what Decide feels like and wasn't part of any card, and that "after" is possible if notes on
decided cards are allowed ([#0011](0011-notes-on-decided-cards.md), still open); the merged
roadmap now leaves it open and points to this card. That is why this card depends on #0011:
option `later` only works if #0011 allows it.

Example, on an invented card "#0042 Should failed requests throw or return a result?": you
asked its agent whether the project's HTTP client already throws on 404, it checked, and you're
now convinced. You pick option B and press Enter.

## Option wait: Decide waits for the summary

```
┌ Before deciding: summary of your conversation ─────────────┐
│ I now see that B's extra code is one line per call with a   │
│ helper. Asked the agent to check whether our HTTP client     │
│ already throws on 404: it does, so wrap it once.             │
│                                                              │
│ [Save and decide  ⏎]   [Decide without summary]   [Esc]      │
└──────────────────────────────────────────────────────────────┘
```

"Writing a summary..." shows for a few seconds first. One write adds the summary to the card's
History and records the decision; Undo removes both and puts the summary back in the box.

Variant: the summary prefills the decision's "Why?" field instead of becoming a separate entry;
say so in your note if you prefer that. (Then #0023, which asks how a summary entry is marked,
wouldn't matter for summaries written when you decide.)

## Option drop: Decide right away and drop the summary

Enter decides as today. The notice says "Decided #0042: Return a result object. The
conversation wasn't summarized." The conversation is still on this machine, but nothing about
it is added to the card.

## Option later: Decide right away, save the summary after

Enter decides and moves on as today. About 10 seconds later, wherever you are:

```
Summary of your conversation on #0042 is ready.  [Review]
```

Review opens the same box as in `wait`, with "Save as a note on #0042". The note reaches the
agent through `president pending` like any note on a decided card.

## Sources

- Code: `src/web/views/CardView.tsx` (`decide`, `act` with `leave: true`, the "Why? (optional)"
  field), `src/web/drafts.ts` (the "Why?" with a decision), `src/web/toast.tsx` (10-second notice
  when it has an action), `src/server/cards.ts` (`undoLastAction`), `src/core/actions.ts`
  (`ALLOWED_FROM.note` is open and deferred only), `src/cli/commands.ts` (pending prints the
  decision's note after the choice).
- Cards #0003, #0006, #0011, #0023, #0024; `docs/roadmap.md` (on main since PR #5), "The chat
  never applies decisions"; PR #5 review, finding D-5 and question Q2.
- Claude Code docs, sessions: `claude -p --resume <session-id> --output-format json "summarize
  what we changed"` is the documented way to "send a follow-up prompt, such as a summary
  request" to an existing session. https://code.claude.com/docs/en/sessions
