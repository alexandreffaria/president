---
id: "0009"
title: How should the queue treat a card that depends on an undecided card?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T13:22:09Z
created_by: claude (batch-1 writer)
tags: [queue, depends-on]
depends_on: []
recommendation:
  option: sink
  why: >-
    Deciding a dependent card first means deciding on assumptions the other card may
    overturn, so it should come later; but hiding it entirely makes it easy to lose, for
    example when the card it depends on is deferred. Sinking keeps it visible and in the
    j/k flow, just after the cards it waits for.
options:
  - id: warn
    title: Keep it in place, with a warning
    summary: Today's behaviour; the card keeps its place by priority and age, and shows "depends on" with the card id in the queue and a warning on the card.
    pros:
      - Nothing to build; you see every card where you expect it
      - You may know the dependency doesn't matter for your answer and decide anyway
    cons:
      - The queue can lead you to a dependent card before the card it depends on, so you decide on assumptions that may change
      - Only the order of creation keeps them in the right order, by chance
  - id: sink
    title: Sink it below the cards that are ready
    summary: Cards with an undecided dependency move to the end of the queue (still sorted by priority and age among themselves) and keep their warning; once the dependency is decided they move back.
    pros:
      - j/k reaches the deciding card before the cards that depend on it
      - Nothing disappears; the count and the list stay honest
    cons:
      - A high-priority dependent card can end up below low-priority cards
      - Cards move when another card is decided, which can surprise you mid-queue
  - id: hide
    title: Hide it until the dependency is decided
    summary: The queue leaves such cards out and lists them in a collapsed "Blocked" section, like "Waiting for new options" and "Deferred".
    pros:
      - The queue only holds cards you can decide well right now
      - The "Blocked" section shows at a glance what is waiting on what
    cons:
      - A card whose dependency is deferred, or broken, stays hidden until you notice
      - You can't decide it from the queue even when you know the dependency doesn't matter
resolution:
  choice: sink
  resolved_at: 2026-11-11T17:35:02Z
applied_at: 2026-11-11T18:09:18Z
---

## Context

A card can list `depends_on: ["0003"]`: cards in the same project that should be decided first
(`docs/card-format.md`). This batch uses it: #0003 depends on #0001, #0006 and #0007 on #0004.

**Today**:

- `buildQueue` in `src/core/queue.ts` ignores dependencies: open cards that aren't waiting for
  new options, sorted by priority, then oldest first (`compareQueue`).
- `openDependencies` lists dependencies that exist in the project and aren't resolved. A deferred
  dependency counts as undecided.
- The queue row shows "depends on #0003" (`QueueItem` in `src/web/views/QueueView.tsx`), and the
  card page shows "This depends on #0003, which isn't decided yet." while the card is open or
  deferred (`src/web/views/CardView.tsx`).
- A dependency that names no card of the project is shown as a separate warning
  (`unknownDependencies`).

## Option warn: Keep it in place, with a warning

```
Queue
  ● Who should commit and push your answers...            #0001  high
  ● Where should a card's conversation be stored?         #0003  high   depends on #0001
  ● What should the card's agent session be allowed to do? #0004 high
```

## Option sink: Sink it below the cards that are ready

```
Queue
  ● Who should commit and push your answers...            #0001  high
  ● What should the card's agent session be allowed to do? #0004 high
  ...
  ● Where should a card's conversation be stored?         #0003  high   depends on #0001
```

## Option hide: Hide it until the dependency is decided

```
Queue
  ● Who should commit and push your answers...            #0001  high
  ● What should the card's agent session be allowed to do? #0004 high

▸ Blocked (3)
    Where should a card's conversation be stored?   waits for #0001
```
