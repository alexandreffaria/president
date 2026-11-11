---
id: "0012"
title: Should Undo erase an action without a trace, or leave a record in the card's history?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T13:22:12Z
created_by: claude (batch-1 writer)
tags: [undo, history, lifecycle]
depends_on: []
recommendation:
  option: hybrid
  why: >-
    The record exists for one reason: an agent may already have acted on what you undid.
    Decisions are what agents act on, and a note undone within its 10-second toast is almost
    always a typo nobody read; if an agent did read it, its seen or applied command already
    refuses because the card changed. So keep today's rule unless you want the history to be
    a full audit log.
options:
  - id: hybrid
    title: Keep today's rule
    summary: Undoing a note, neither, deferral or reopen restores the file byte for byte; undoing a decision restores it and adds a type undo entry.
    pros:
      - The history stays clean of typos and misclicks
      - Agents that may have acted on a decision are told to revert it
      - Already built and tested
    cons:
      - Two behaviours to explain (README and card-format.md both spell this out)
      - An agent that read an undone note through pending and acted on it before running seen gets no record of what was taken back, only a refusal
  - id: erase
    title: Always erase without a trace
    summary: Undo restores the card byte for byte for every action, decisions included.
    pros:
      - One simple rule; the card is exactly as if you never clicked
      - The history only shows what you meant to do
    cons:
      - An agent shown the decision may already have changed docs or code, and nothing in the card tells it to revert
      - Its applied command would refuse (the token no longer matches), but with no hint about what changed
  - id: record
    title: Always keep a record
    summary: Every undo restores the card and appends an undo entry naming what was taken back, notes and deferrals included.
    pros:
      - The card's history is a complete log of everything you did
      - Any agent that saw anything you took back finds out what, the same way for every action
    cons:
      - Typos and misclicks stay in the history forever, and each one shows up in president pending as something to read
      - An undone note still leaves its text in the file and in git, which may be exactly what you wanted gone
resolution:
  choice: hybrid
  resolved_at: 2026-11-11T17:36:01Z
applied_at: 2026-11-11T18:09:28Z
---

## Context

After any action on a card (decide, neither, note, defer, reopen), a toast offers **Undo** (`u`)
for 10 seconds (`src/web/toast.tsx`). What the code does
(`undoLastAction` in `src/server/cards.ts`):

- The hub keeps, in memory, the bytes of the card from before the last action on it, for 30
  minutes (`UNDO_TTL_MS`). It is lost if the hub restarts.
- Undo is refused if anything wrote the card after the action (an agent applying it, another
  tab), checked by content and by the file's identity and change time.
- **For a note, neither, deferral or reopen**, the old bytes are written back: no trace in the
  file. The text you sent comes back as a draft (`src/web/drafts.ts`).
- **For a decision**, the old bytes are written back *plus* a feedback entry
  (`afterUndoingDecision` in `src/core/actions.ts`):

  ```yaml
  - at: 2026-11-10T15:21:00Z
    type: undo
    note: Took back the decision "action" (Keep it under 8 words.).
    previous_resolution:
      choice: action
      note: Keep it under 8 words.
      resolved_at: 2026-11-10T15:20:00Z
  ```

  `president pending` then tells the agent: "The human took back the earlier decision ... If you
  recorded it in the docs or changed code for it, revert that".

Why the split: an agent may run `president pending` between your decision and your undo, and
start working without writing to the card. Its `applied` or `seen` command refuses later
because the token no longer matches (`checkAgentToken` in `src/core/pending.ts`, "The human may
have changed their decision or undone a note"), but only the undo entry says what to revert.

## Option hybrid: Keep today's rule

As described above.

## Option erase: Always erase without a trace

Undoing a decision writes back the old bytes only. An agent that acted on it learns from the
refused token that the card changed, rereads it, and has to work out on its own that the
decision is gone.

## Option record: Always keep a record

Undoing a note leaves:

```yaml
  - at: 2026-11-10T15:21:05Z
    type: undo
    note: Took back the note "Use teh blue one".
```
