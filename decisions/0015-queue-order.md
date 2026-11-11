---
id: "0015"
title: In what order should the queue show cards?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T13:22:15Z
created_by: claude (batch-1 writer)
tags: [queue, ordering]
depends_on: []
recommendation:
  option: priority-oldest
  why: >-
    Priority is the agent's signal that work is blocked, and oldest-first makes sure nothing
    starves within its priority; the project chips already give you the by-project view when you want it. Switch
    to by-project if you find that jumping between projects' contexts is what slows you down.
options:
  - id: priority-oldest
    title: Priority, then oldest first
    summary: Today's order across all projects; high before normal before low, and within a priority the card created first comes first.
    pros:
      - Blocked work (high priority) is always at the top, wherever it comes from
      - Within a priority nothing waits forever; the oldest card is always next
    cons:
      - Consecutive cards can jump between projects, so you switch context on every card
      - A card written a minute ago, while you still remember the conversation that led to it, sits behind week-old ones
  - id: by-project
    title: Grouped by project
    summary: Cards are grouped by project (the project with the most urgent card first), and inside each group sorted by priority, then oldest.
    pros:
      - You stay in one project's context for a run of cards, which is how related cards are usually written
      - Matches how you'd finish one project's questions before moving on
    cons:
      - A high-priority card in the second project waits behind normal cards of the first
      - Duplicates what the project filter chips already do
  - id: newest
    title: Priority, then newest first
    summary: High before normal before low, and within a priority the most recently written card first.
    pros:
      - The freshest questions come first, while the agent that asked is likely still working and you may remember why it asked
      - Fast feedback to agents in the middle of a task
    cons:
      - Old cards sink and can wait indefinitely while new ones keep arriving
      - The order changes under you every time an agent writes a card
resolution:
  choice: priority-oldest
  resolved_at: 2026-11-11T17:36:40Z
applied_at: 2026-11-11T18:09:32Z
---

## Context

**Today** `compareQueue` in `src/core/queue.ts` sorts the queue by priority (`high`, `normal`,
`low`), then by `created`, oldest first, then by project name and id so the order is stable.
`buildQueue` keeps only open cards that aren't waiting for new options; it doesn't look at
dependencies (that's #0009). When more than one project is registered, the queue page shows a
chip per project with its count, and clicking one filters the queue to that project
(`QueueView` in `src/web/views/QueueView.tsx`). `j`/`k` on a card follow the same order
(`CardView`). Cards with `priority` left out count as `normal`.

The skill tells agents to use `priority: high` "only when work is blocked on it".

Example: three projects, with these open cards.

| Card | Project | Priority | Written |
|---|---|---|---|
| A | shop | normal | 5 days ago |
| B | president | high | 2 days ago |
| C | shop | high | 10 min ago |
| D | blog | normal | 1 hour ago |
| E | president | normal | 3 days ago |

## Option priority-oldest: Priority, then oldest first

B, C, A, E, D

## Option by-project: Grouped by project

president (B, E), shop (C, A), blog (D). president comes first because its high card is the
oldest high card.

## Option newest: Priority, then newest first

C, B, D, E, A
