---
id: "0011"
title: Should you be able to add a note to a card you already decided?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T13:22:11Z
created_by: claude (batch-1 writer)
tags: [notes, lifecycle]
depends_on: []
recommendation:
  option: allow
  why: >-
    Most afterthoughts ("also update the README", "keep the old name as an alias") add to a
    decision rather than change it, and reopening for them sends the card back through the
    queue and makes the agent treat it as undecided. The pending machinery already lists
    unread notes on resolved cards, so this is a small change.
options:
  - id: reopen-only
    title: Keep it as is; reopen to add anything
    summary: Today's behaviour; a decided card only offers Reopen, and anything you want to add goes in the reopen note or after deciding again.
    pros:
      - A decision is final until reopened, so agents never have to merge an afterthought into it
      - Nothing to build
    cons:
      - A small addition costs a reopen, a decide again, and an agent replacing its earlier record
      - Reopening tells agents not to act on the card until you decide again, which stalls work that was fine
  - id: allow
    title: Allow plain notes on decided cards
    summary: Note (m) also works on resolved cards; the note is appended to feedback, the decision and applied_at stay, and president pending lists it under "New notes from the human".
    pros:
      - Afterthoughts reach the agent without disturbing the decision or its applied state
      - Uses the existing note, seen and token flow unchanged
    cons:
      - A note that really changes the decision ("actually, only for mobile") can slip through as a note, and the agent must judge whether to re-apply
      - The card's decision and its notes can drift apart over time
  - id: amend
    title: Allow notes that re-open the apply step
    summary: A note on a decided card keeps the decision but clears applied_at, so pending lists the card as "Resolved, not yet applied" again, with the note.
    pros:
      - The agent is told to revisit its work with the note in mind, not only to read it
      - The decision stays; only its application is redone
    cons:
      - Every note, even "thanks, looks good", makes an agent redo the apply step unless you choose the kind of note
      - Mixes two meanings into one action, which the format and pending text then have to explain
resolution:
  choice: allow
  resolved_at: 2026-11-11T17:35:33Z
applied_at: 2026-11-11T18:09:23Z
---

## Context

**Today** the note action is allowed only on open and deferred cards: `ALLOWED_FROM.note` is
`["open", "deferred"]` in `src/core/actions.ts`. On a resolved card, the action bar shows only
"This decision is made." and **Reopen** (`ActionBar` in `src/web/views/CardView.tsx`), and `m`
does nothing. Reopening appends a `reopen` entry with the previous resolution, removes
`resolution` and `applied_at`, and puts the card back in the queue; when you decide again,
`president pending` tells the agent "Decided again ... Replace the earlier record".

**What already works for resolved cards.** `president pending` lists any card with feedback newer
than its `seen_at`, whatever its status (`withNotes` in `src/cli/commands.ts`), and `seen`
works in every state (`ALLOWED_FROM.seen` is all statuses). So a note on a resolved card would
reach agents with no change to pending.

Example: you decided #0016 "rename the command" and then remember "keep `president` as an alias
for a release".

## Option reopen-only: Keep it as is; reopen to add anything

```
Decided: Rename the command, 2 hours ago. An agent has applied it.
This decision is made.  [Reopen]
```

## Option allow: Allow plain notes on decided cards

```
Decided: Rename the command, 2 hours ago. An agent has applied it.
This decision is made.  [Note… m]  [Reopen]
```

`president pending`:

```
New notes from the human. Act on them, then run its `done` command:
  /home/me/president/decisions/0016-rename-the-cli.md
    Should the president command be renamed, given an unrelated npm package with that name? (resolved)
    note 2026-11-12T10:00:00Z: Keep president as an alias for one release.
    done: president seen ... --token 4-...
```

## Option amend: Allow notes that re-open the apply step

Same button; after it, the card says "Waiting for an agent to apply it to the project." again,
and `pending` lists it under "Resolved, not yet applied" with the note.
