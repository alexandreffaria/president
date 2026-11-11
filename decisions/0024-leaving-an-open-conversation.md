---
id: "0024"
title: What should happen to a conversation you leave without closing it?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T16:20:05Z
created_by: claude (batch-2 writer)
tags: [pr-2, chat, summary]
depends_on: ["0003", "0019"]
recommendation:
  option: remind
  why: >-
    Most of the time you leave a card to come back to it (moving through the queue, a
    reload), and nothing is lost in between: the conversation stays on this machine for 30
    days after you last used it, and a summary can be written from it any time in that window. A reminder keeps leaving instant
    and costs nothing until you ask for the summary. Pick ask if you often talk about a card
    once and never return to it, so the summary is written while the conversation is fresh;
    pick auto if you'd rather never think about it and accept an agent run each time.
options:
  - id: remind
    title: Remember it and remind you
    summary: Leaving saves nothing; the hub remembers that the card has a conversation without a summary, says so when you leave, and the card offers "Write summary" when you come back.
    pros:
      - Leaving stays instant, and no agent runs until you ask for the summary
      - Works the same after a closed tab or a hub restart, since the conversation is still on this machine
    cons:
      - If you never come back to the card, what you discussed never reaches the agent
      - By the time you write the summary, you may have forgotten what you concluded
      - The reminder is per machine; on another machine the card shows nothing, and a summary can only be written where you talked
      - After 30 days without use Claude Code deletes the conversation; the card can then only say it is gone, and what you discussed never reaches the agent
  - id: ask
    title: Ask before leaving
    summary: Leaving a card with an unsummarized conversation asks "Summarize before leaving?", with Summarize, Leave without summary, and Stay.
    pros:
      - The summary is written while the conversation is fresh in your head
      - You choose each time, so a throwaway question costs nothing
    cons:
      - One more question every time you move on from a card you talked about
      - Closing the tab or a hub restart can't ask (a browser only shows its own generic question there, with no buttons of president's), so those still need remind's reminder
      - Summarize makes you wait a few seconds for the summary before you can move on
  - id: auto
    title: Summarize automatically when you leave
    summary: Leaving starts the summary in the background; it waits on the card for you to read and save, and a notice says when it is ready.
    pros:
      - Nothing to remember; every conversation gets a summary written while it is fresh
      - Leaving stays one keypress
    cons:
      - An agent run, with its cost, every time you leave a card you talked about, even for a throwaway question or a quick look at the next card
      - You still have to read and save each summary (#0003), so unreviewed summaries can pile up
      - A summary still being written when you close the tab is fine, but one being written when the hub stops is lost and has to be written again
resolution:
  choice: remind
  resolved_at: 2026-11-11T17:38:57Z
applied_at: 2026-11-11T18:09:42Z
---

## Context

PR 2 adds a conversation with an agent on each card. When a conversation ends, the agent writes
a short summary, you edit it, and only what you save is added to the card
([#0003](0003-conversation-storage.md), option `summary`). That summary is all the project's
working agent learns about the conversation. A conversation ends when you close it or when you
decide the card; deciding is [#0019](0019-decide-during-conversation.md). This card is about the
other way out: you **leave** the card with the conversation still open, by moving to another
card or back to the queue, reloading, closing the tab, or restarting the hub. It covers open and
deferred cards; whether there is a conversation on a decided card at all is #0020.

**Nothing is lost by leaving, for 30 days.** The conversation stays in Claude Code's store on this machine,
30 days by default, and until then a summary can be written from it by continuing the same
session (`claude -p --resume <session-id> ... "summarize what we changed"` is the documented way
to ask an existing session for a summary). What can be lost is the summary itself: if none is
ever written, the working agent never hears what you discussed. On another machine the
conversation isn't available, so a summary has to be written on the machine where you talked.

**What the page does today when you leave.** If you typed something and didn't send it, leaving
shows "What you typed on #0042 is kept; it's there when you come back." The text is kept in the
page's memory (`src/web/drafts.ts`), so a reload loses it. Nothing asks before leaving.

**How this depends on #0019.** If you leave and later decide the card, #0019 decides what
happens to the summary: under its `wait`, Decide offers it first; under `drop`, deciding ends
the conversation without one; under `later`, it is offered after the Undo window. This card
only decides what happens between leaving and coming back.

Example, on an invented card "#0042 Should failed requests throw or return a result?": you
asked its agent whether the project's HTTP client already throws on 404, it checked, and you
press `j` to go to the next card without closing the conversation.

## Option remind: Remember it and remind you

Leaving shows, like the reminder for unsent text today:

```
Your conversation on #0042 isn't summarized; it's there when you come back.
```

Coming back to #0042 (also after a reload or a hub restart):

```
Discuss
  Conversation not summarized yet.  [Write summary]
  [Ask a follow-up...                                    ]
```

If the conversation has been deleted in the meantime, the card shows "This conversation is no
longer on this machine" instead of Write summary.

The hub keeps the list of cards with an unsummarized conversation on this machine, outside the
project (for example in `$XDG_STATE_HOME/president/`, by default `~/.local/state/president/`).

## Option ask: Ask before leaving

```
┌ Summarize before leaving? ─────────────────────────────────────┐
│ Your conversation on #0042 hasn't been summarized yet.          │
│                                                                 │
│ [Summarize ⏎]   [Leave without summary]   [Stay  Esc]           │
└─────────────────────────────────────────────────────────────────┘
```

Summarize shows "Writing a summary..." for a few seconds, then the summary box; Save adds it
to the card and moves on. Leave without summary keeps the conversation on this machine, as in
`remind`.

## Option auto: Summarize automatically when you leave

Leaving moves on at once. A few seconds later, wherever you are:

```
Summary of your conversation on #0042 is ready.  [Review]
```

Review opens the summary box on #0042; nothing is added to the card until you save it. The
summary waits in the hub (on this machine, outside the project) until you do.

## Technical detail (for the implementer)

- The summary is one more `claude -p --resume <session-id>` run in the card's read-only
  session (#0004), returned as text; the hub writes it as a feedback entry only after you save
  it (#0003). On open and deferred cards that write is already allowed (`ALLOWED_FROM.note` in
  `src/core/actions.ts`).
- "Leave" inside the page is the same moment the unsent-text reminder uses (the effect in
  `src/web/views/CardView.tsx` that runs when the card view goes away). Closing the tab can only
  trigger the browser's own `beforeunload` question, whose wording a page can't set.
- Under `remind` and `ask`, the hub needs to know which cards have a conversation without a
  summary on this machine: a small per-machine list, or the conversation's last message time
  compared with the card's last summary.
- Under `auto`, a closed tab or a reload reaches the hub only as the page disconnecting, and the
  two look the same: the hub summarizes on every reload too.

## Sources

- Code: `src/web/views/CardView.tsx` ("What you typed on #... is kept; it's there when you come
  back."), `src/web/drafts.ts` (drafts kept in memory), `src/core/actions.ts`
  (`ALLOWED_FROM.note`).
- Cards #0003, #0004, #0019, #0020; `docs/roadmap.md` (on main since PR #5), "The chat never
  applies decisions" (the open question about leaving the card or closing the tab).
- Claude Code docs, sessions: "Ask an existing session a question: pass a session ID to
  `claude -p --resume` to send a follow-up prompt, such as a summary request", with the example
  `claude -p --resume <session-id> --output-format json "summarize what we changed"`.
  https://code.claude.com/docs/en/sessions
- Claude Code docs, the .claude directory: transcripts are deleted after `cleanupPeriodDays`,
  "The default is 30 days". https://code.claude.com/docs/en/claude-directory
- Claude Code docs, settings reference, `cleanupPeriodDays`: "Set how many days Claude Code keeps
  session transcripts and other application data before deleting them", "a session you haven't
  used for longer than the retention period no longer appears in the `/resume` picker", default
  `30`. https://code.claude.com/docs/en/settings-reference#cleanupperioddays
- MDN, `beforeunload`, usage notes: browsers "only show a generic browser-specified string in
  the displayed dialog. This cannot be controlled by the webpage code."
  https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
- PR #6 review, finding B-6.
