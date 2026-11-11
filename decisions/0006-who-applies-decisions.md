---
id: "0006"
title: Who should apply a decision to the project's docs and code?
status: open
kind: choice
priority: high
created: 2026-11-11T13:22:06Z
created_by: claude (batch-1 writer)
tags: [pr-2, chat, workflow]
depends_on: ["0004"]
recommendation:
  option: working
  why: >-
    The working agent is the one that knows the branch, the plan and the code, and it already
    has a safe path (pending, applied, tokens, undo entries). Applying from the chat would
    need write permissions on a browser-started session (#0004) and can cut short the
    10-second undo window if it writes fast. If you find decisions waiting too long, "per-card"
    adds an explicit "apply now" without changing the default.
options:
  - id: chat
    title: The card's chat session applies it right away
    summary: When you decide, the card's session records the decision in the project's docs, does small follow-up edits, and runs president applied.
    pros:
      - The docs are up to date seconds after you decide, even if no agent is working on that project
      - The session has just discussed the card with you, so it knows the reasoning behind your choice
    cons:
      - Needs write permissions for a browser-started session (option "docs", "ask" or "full" on card 0004)
      - Edits land in whatever branch is checked out, possibly next to a working agent's uncommitted changes
      - If it writes within Undo's 10-second window, Undo is refused, and a decision undone after it started must also revert the docs it wrote
      - The working agent may still have the old assumption in its head until it next runs pending
  - id: working
    title: The project's working agent applies it later
    summary: Keep today's design; the decision waits as "Waiting for an agent to apply it" until an agent in that project runs president pending and applies it.
    pros:
      - The agent doing the work changes the docs and code, on its branch, as part of its plan
      - Already built and tested, with tokens that refuse stale applies and undo entries that tell agents to revert
      - Undo stays available for its usual 10 seconds
    cons:
      - Nothing happens until an agent runs in that project; in a quiet project a decision can wait days
      - The agent that applies it didn't hear your conversation about the card, only what is in the card
  - id: per-card
    title: You choose per decision
    summary: Decide keeps today's behaviour; a second button, "Decide and apply now", hands the decision to the card's session immediately.
    pros:
      - Quiet projects and doc-only decisions get applied at once; code-heavy ones wait for the working agent
      - The default stays the tested path
    cons:
      - Two ways to decide, and you have to judge which one each time
      - Still needs the write permissions and the undo handling of option chat for the cards where you use it
---

## Context

**Today** (the design in `skills/decision-cards/SKILL.md`, "Applying resolved cards"): when you
decide, the hub only rewrites the card (`status: resolved`, `resolution`). The card page then
says "Waiting for an agent to apply it to the project." (`StatusNotice` in
`src/web/views/CardView.tsx`). Later, an agent working in that project runs
`president pending`, which lists resolved cards without `applied_at` (`needsApplying` in
`src/core/pending.ts`). The agent records the decision in the project's docs, does the work,
and runs the `done:` line (`president applied <file> --token <token>`), which sets
`applied_at`. The token refuses if you changed the decision meanwhile.

**Undo interacts with this.** After deciding, a toast offers Undo for 10 seconds, paused while
the pointer is over it or it has focus (`src/web/toast.tsx`), and `u` works only while that notice is shown.
That is the only way to undo from the page. The server would accept an undo for 30 minutes
(`UNDO_TTL_MS` in `src/server/cards.ts`), but nothing in the page offers it after the toast is
gone, and the server refuses it once anything else has written the card, such as an agent
applying it. Undoing a decision adds an `undo` feedback entry so an agent that saw it
reverts its work.

PR 2 adds a per-card Claude Code session that has discussed the card with you. This card
decides whether that session should also apply your decision. It depends on #0004, because
applying needs permissions beyond reading.

## Option chat: The card's chat session applies it right away

You press Decide; the hub sends the session:

```
The human decided "result" on card 0007 with the note "keep the error codes few".
Record it in docs/decisions.md, make the follow-up doc edits, then run:
president applied decisions/0007-api-errors.md --token 3-0k3j5h2g9fd
```

The card shows "Applying..." and then "Applied by the card's agent" with the diff of `docs/`.

## Option working: The project's working agent applies it later

No change. The card shows "Waiting for an agent to apply it to the project." until the next
agent session in the project runs `president pending`:

```
Resolved, not yet applied. Record the decision in the docs and act on it (and on any notes), then run its `done` command:
  /home/me/app/decisions/0007-api-errors.md
    How should the API client report errors? -> result (keep the error codes few)
    done: president applied /home/me/app/decisions/0007-api-errors.md --token 3-0k3j5h2g9fd
```

## Option per-card: You choose per decision

```
[ Decide ⏎ ]  [ Decide and apply now ⇧⏎ ]  Neither n  Note m  Defer d
```

"Decide" behaves as today; "Decide and apply now" does what option chat describes.
