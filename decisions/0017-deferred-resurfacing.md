---
id: "0017"
title: Should deferred cards come back to the queue on their own?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:17Z
created_by: claude (batch-1 writer)
tags: [queue, defer, lifecycle]
depends_on: []
recommendation:
  option: snooze
  why: >-
    Deferring usually means "not now", not "never", and a collapsed list you have to remember
    to open is where cards go to be forgotten. A snooze with a default of one week keeps d a
    single key, and lets you say "until I'm back from holiday" when you mean it. Pick
    on-change if most of your deferrals wait on an agent rather than on you.
options:
  - id: manual
    title: Keep it manual
    summary: Today's behaviour; a deferred card stays in the collapsed "Deferred" list until you open it and press "Back to queue".
    pros:
      - Nothing comes back unasked; your queue only grows from agents' new cards
      - Nothing to build, no dates to manage
    cons:
      - Deferred cards are easy to forget, and the agent that asked may stay blocked
      - A card parked for now and one parked until the redesign look the same
  - id: snooze
    title: Defer until a date (snooze)
    summary: d defers for a week by default; a small menu offers tomorrow, next week, next month or a date; the card stores defer_until and is back in the queue when that passes.
    pros:
      - Deferring says when you want to see it again, so it isn't forgotten
      - A default keeps it one key for the common case
      - No background job; the queue shows deferred cards whose date has passed
    cons:
      - A new field and a small menu to build, and a choice to make on each deferral if you want other than the default
      - Cards come back whether or not anything has changed, which can feel like nagging
  - id: auto-week
    title: Every deferred card returns after a week
    summary: No question asked; a deferral lasts 7 days from its defer entry, then the card is back in the queue.
    pros:
      - Same single key as today, no menu
      - Nothing deferred is lost for long
    cons:
      - Cards you parked for good reason (waiting on a release next month) come back every week
      - The only way to park something longer is to defer it again each week
  - id: on-change
    title: Back when an agent changes the card
    summary: A deferred card returns to the queue when an agent rewrites it with president update after the deferral (for example to answer the note you deferred it with), marked "changed since you deferred it".
    pros:
      - Cards come back only when there is something new to read, so it never nags
      - Fits the common "waiting on X" deferral; the agent that does X updates the card, and it is back
    cons:
      - A card waiting on you, not on an agent, never comes back, so it is forgotten as easily as today
      - Needs the hub to know when the card was deferred and when an agent last changed it (two new recorded times), and agents must know that updating a deferred card brings it back
---

## Context

**Today**: `d` (or Defer) sets `status: deferred` (`applyAction` in `src/core/actions.ts`;
defer is allowed only from `open`), with an optional note appended to `feedback` as
`type: defer`. The queue leaves deferred cards out (`buildQueue` keeps only `open` cards, in
`src/core/queue.ts`) and lists them in a collapsed "Deferred (n)" section at the bottom of the
queue page (`src/web/views/QueueView.tsx`). The card page says "Deferred. It stays out of the
queue until reopened." and offers **Back to queue**, which applies `reopen`
(`src/web/views/CardView.tsx`). Deferred cards can still be decided, noted or rejected directly.
Nothing tracks when a card was deferred except the defer feedback entry, which is written only
if you typed a note.

`president pending` doesn't list deferred cards as such; agents see a deferral only through its
note.

## Option manual: Keep it manual

```
▸ Deferred (3)
```

## Option snooze: Defer until a date (snooze)

```
Defer until:  [Next week ⏎]  Tomorrow  Next month  Pick a date…
```

```yaml
status: deferred
defer_until: 2026-11-18T13:00:00Z
```

The queue shows deferred cards whose `defer_until` has passed among the open ones, marked "back
from deferral". The file isn't rewritten when the date passes.

## Option auto-week: Every deferred card returns after a week

Deferring writes a `defer` feedback entry even without a note, and the queue brings the card back
7 days after it.

## Option on-change: Back when an agent changes the card

You defer #0007 with "Waiting until we know if the HTTP client throws on 404". An agent reads
that note in `president pending`, checks, and rewrites the card's context with the answer through
`president update`. The card is back in the queue:

```
#0007  How should the API client report errors?   changed since you deferred it
```

Deferring records when it happened (for example a `defer` entry even without a note), and
`president update` records when an agent last changed the card (for example an `updated_at`
field). The queue shows deferred cards whose `updated_at` is later than their deferral. An
agent's `president seen` doesn't count; only a rewrite of the card does.
