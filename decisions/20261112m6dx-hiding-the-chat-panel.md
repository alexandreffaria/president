---
id: "20261112m6dx"
title: Should hiding the chat panel also close the conversation and offer its summary?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:15:53Z
created_by: claude (PR 25/27 card writer)
tags: [pr-2, chat, summary, panel]
depends_on: ["0002", "0024", "0020", "202611111ky9"]
recommendation:
  option: hide
  why: >-
    You will hide the panel often for reasons that have nothing to do with being done: to
    widen the options on an A/B card, or to read a long section. Asking for a summary each
    time costs a wait and an agent run, and the reminder you chose in 0024 already catches a
    conversation you never wrapped up. Pick ask if you'd rather every conversation be wrapped
    up the moment you put it away, while it is fresh; if you want ask without an agent run on
    every hide, answer with a note asking for a 0024-style one-key question first (Summarize,
    Just hide, Close without summary).
options:
  - id: hide
    title: Hiding only hides (as built)
    summary: >-
      The × ("Hide c") and the c key put the panel away and nothing else; you close a
      conversation from its own "Write summary" button.
    pros:
      - Hiding is instant and free, so you can widen an A/B card's options and bring the chat back with one key
      - Matches 0024, where leaving the card saves nothing and runs nothing
      - Built and tested in pull request 27
    cons:
      - Closing a conversation is a separate step you have to remember; until then the card says "Conversation not summarized yet."
      - Two similar-looking ways to put a conversation away (hide it, or close it), which you have to tell apart
  - id: ask
    title: Hiding a conversation with something new asks for the summary
    summary: >-
      Hiding the panel while it has messages not covered by a saved summary first writes the
      summary and shows the box (Save summary, Close without summary, Esc to keep it open);
      with nothing new, it hides at once. A lighter variant, like 0024's ask, would first ask
      with one key (Summarize, Just hide, Close without summary) before any agent run.
    pros:
      - The summary is written while the conversation is fresh, at the moment you are done with it
      - One gesture for "I'm done here"; no separate step to remember
    cons:
      - Every hide after a question costs a few seconds and an agent run, even when you only wanted more room
      - You can't hide the panel just for room (Esc keeps it open); hiding a conversation with something new means saving a summary, or closing without one, which drops its reminder
      - Leaving the card (j, the queue) still only reminds you, so the two ways out behave differently
resolution:
  choice: hide
  resolved_at: 2026-11-12T20:23:08Z
---

## Context

Pull requests 25 and 27 build the per-card chat. The panel (0002, `side`) has a "Hide c"
button and the `c` key. 0020 says "Closing the conversation offers the summary box", and 0024
and 202611111ky9 keep a "not summarized" reminder until you close the conversation. No card
says whether hiding the panel is closing the conversation. Pull request 27 treats it as only
hiding: the conversation stays "not summarized", and you close it with **Write summary**,
which shows whenever there are messages no saved summary covers.

What is already settled either way: 202611111ky9's chosen option accepts a reminder that lasts
"until you close the conversation, saving its summary or not", so whichever you pick, the
conversation needs a way to close without a summary (for example a **Close without summary**
button) that ends the reminder without writing to the card (today's Cancel only closes the
box). 202611111ky9 settles that you can close without saving, not where that control goes; if
it sits in the summary box, reaching it first costs an agent run writing the summary. Leaving the card is 0024's `remind` either way.

Example: on #0042 (an A/B card) you asked "does our HTTP client already throw on 404?", got
the answer, and press `c` to give the two options their full width.

## Option hide: Hiding only hides (as built)

```
[c]  The panel goes away; the options widen.
     Show the conversation  c   Conversation not summarized yet.
[c]  The panel is back as it was:
     Conversation not summarized yet.  [Write summary]
```

## Option ask: Hiding a conversation with something new asks for the summary

```
[c]  Writing a summary…
     ┌ Summary for the project's agent ───────────────────────────┐
     │ Discussed with the card's agent. Our HTTP client already    │
     │ throws on 404 (src/http.ts line 40) ...                     │
     │ [Save summary  Ctrl ⏎]  [Close without summary]  [Esc]      │
     └─────────────────────────────────────────────────────────────┘
Save or Close without summary: the panel hides. Esc: the panel stays open.
```

## Sources

- Pull request 27, `src/web/components/CardChat.tsx`: `onClose` "Hides the panel; the
  conversation stays as it is."; the box has Cancel (Esc) and Save summary (Ctrl ⏎).
- Pull requests 25 and 27, "Needs a card", item 1.
- [0020](0020-chat-on-decided-cards.md): "Closing the conversation offers the
  summary box". [202611111ky9](202611111ky9-leaving-chat-on-decided-card.md),
  `remind`'s con: "A quick look-up on an old decision also leaves a reminder until you close
  the conversation, saving its summary or not".
- [0024](0024-leaving-an-open-conversation.md) (`remind`; `ask`, asking before
  leaving, was not chosen). `docs/roadmap.md`, section E.
