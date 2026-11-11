---
id: "0020"
title: Should you be able to talk with the agent about a card you already decided?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T15:58:25Z
created_by: claude (batch-2 writer)
tags: [pr-2, chat, lifecycle]
depends_on: ["0003", "0011"]
recommendation:
  option: chat-saved
  why: >-
    Decide #0011 first; this card follows from it. Questions about a decision often come
    after it ("why did we pick this?", "does the README use the new name now?"), and when
    they lead somewhere the agent should hear about it. Saving the summary as a note on the
    decided card is the same thing as #0011's "allow", so pick this if you pick that. If
    #0011 picks amend, chat-saved still fits, but every saved summary sends the card back to
    the agent to re-apply. If #0011 stays "reopen to add anything", pick chat-unsaved
    instead.
options:
  - id: open-only
    title: Only on open and deferred cards
    summary: A decided card has no conversation area; to talk about it, you reopen it first.
    pros:
      - The rule is simple and matches today's (a decided card only offers Reopen)
      - Nothing is ever written to a decided card except by an agent applying it
    cons:
      - A quick question about a past decision costs a reopen, which sends the card back to the queue and tells agents to hold off
      - Past conversations on the card can't be continued once it is decided
  - id: chat-unsaved
    title: Allowed, but nothing is saved to the card
    summary: You can talk about a decided card, but the conversation ends without a summary and the card file is never changed by it.
    pros:
      - You can ask "why did we pick this?" or "does the README use the new name now?" without reopening
      - A decided card stays exactly as the applying agent left it
    cons:
      - Anything you conclude in that conversation never reaches the working agent, unless you reopen and write it down
      - Two kinds of conversation (saved on open cards, not saved on decided ones) to explain on the page
  - id: chat-saved
    title: Allowed, and saved like on open cards
    summary: You can talk about a decided card, and its summary is added to the card as a note the working agent reads; the decision stays as it is.
    pros:
      - Afterthoughts from a conversation reach the agent without reopening the decision
      - The conversation area works the same on every card
    cons:
      - Needs notes on decided cards, which is card 0011's question; it only fits if that card picks "allow" or "amend", and under amend every saved summary makes the agent redo the apply step
      - A summary that really changes the decision can slip in as a note, and the agent must judge whether to redo its work
resolution:
  choice: chat-saved
  resolved_at: 2026-11-11T17:38:39Z
applied_at: 2026-11-11T18:09:37Z
---

## Context

PR 2 adds a conversation with an agent on each card. When a conversation ends, a summary you
edit is added to the card's feedback ([#0003](0003-conversation-storage.md), option `summary`),
and the hub records which Claude Code session belongs to the card so it can continue it
(`session_id`, see below). This card asks whether any of that happens on a card you **already
decided**.

**What a decided card offers today.** Only **Reopen**: the page says "This decision is made."
(`ActionBar` in `src/web/views/CardView.tsx`). A note is allowed only on open and deferred cards
(`ALLOWED_FROM.note` in `src/core/actions.ts`), and an agent's `president update` never rewrites
a decided card. Whether you may add a note to a decided card is
[#0011](0011-notes-on-decided-cards.md), still open. A saved summary is a note in all but name
(see #0023), so this card depends on #0011.

**What the conversation can answer there.** The session can read the project's files as they
are now, but not their history ([#0004](0004-chat-session-permissions.md) gives it no git), so
it can't list what the agent changed. It can answer "why did we pick this?" from the card, and
"does the README use the new name now?" by reading the README.

**Why not decided yet.** The roadmap (`docs/roadmap.md`, merged with PR #5, "Cross-card
consequences") says to save summaries only on open or deferred cards until #0011 is decided.
The review of PR #5 asked the wider question: is the conversation there at all on a decided card,
and may the hub write to the card for it?

**How #0011's three answers play out here.** Under `reopen-only`, nothing can be added to a
decided card, so only `open-only` or `chat-unsaved` fit. Under `allow`, a saved summary is a
note that the agent reads; the decision and "applied" stay. Under `amend`, a saved summary also
clears "applied", so the agent redoes the apply step with the summary in mind, every time.

Example, on an invented card "#0043 Rename the command": you decided it last week. Today you
wonder whether the README uses the new name now, and want to ask.

## Option open-only: Only on open and deferred cards

```
Decided #0043: Rename the command, 5 days ago. An agent has applied it.
This decision is made.  [Reopen]
```

## Option chat-unsaved: Allowed, but nothing is saved to the card

```
Decided #0043: Rename the command, 5 days ago. An agent has applied it.
Discuss (not saved to the card; reopen to change the decision)
  [Ask about this decision...                      ]
```

## Option chat-saved: Allowed, and saved like on open cards

The same area as on an open card. Closing the conversation offers the summary box; saving it
adds a note to the decided card, and `president pending` lists it under "New notes from the
human" (it already lists notes on cards in any state, `withNotes` in `src/cli/commands.ts`).

## Technical detail (for the implementer)

- **`session_id`.** The roadmap stores the session in the card's `session_id` field, written by
  the hub when a conversation starts or can't be continued. On a decided card that is a write
  the decision's owner didn't make. If [#0021](0021-session-id-per-machine.md) keeps session ids
  out of the card, this question disappears and only the summary remains. Otherwise:
  `open-only` never writes it on decided cards; `chat-unsaved` keeps the session id in the hub's
  memory for that visit only; `chat-saved` writes it like on an open card.
- **Undo.** Any write to the card in the 10 seconds after a decision makes Undo fail
  (`undoLastAction` in `src/server/cards.ts`), so under `chat-saved` the hub must not start a
  conversation, or save anything, on a card decided less than 10 seconds ago from this page.
- A new action allowed on resolved cards (in `src/core/actions.ts`) carries the summary;
  #0011's answer sets whether it is the same `note` action.

## Sources

- Code: `src/core/actions.ts` (`ALLOWED_FROM`), `src/web/views/CardView.tsx` (`ActionBar`),
  `src/cli/commands.ts` (`withNotes`), `src/server/cards.ts` (`undoLastAction`),
  `src/core/schema.ts` (`session_id`, "Reserved for the chat panel").
- Cards #0003, #0004 (the session's tools: `Read,Grep,Glob,WebSearch,WebFetch`, no Bash), #0011
  (options `reopen-only`, `allow`, `amend`); `docs/roadmap.md` (on main since PR #5); PR #5
  review, finding D-4 and question Q3.
