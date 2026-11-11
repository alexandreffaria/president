---
id: "202611112hzh"
title: When snooze ships, what should happen to a deferred card that has no return date?
status: open
kind: choice
priority: normal
created: 2026-11-11T18:21:16Z
created_by: claude (batch-3 writer)
tags: [queue, defer, lifecycle]
depends_on: ["0017"]
recommendation:
  option: back-now
  why: >-
    You chose snooze because a list you have to remember to open is where cards get
    forgotten, and cards deferred before snooze are exactly the ones sitting in that list.
    Bringing them back once, marked, lets you snooze each with one key (a week) or decide it,
    and it is the simplest rule to build. Pick stay if you deferred some cards "for good" and
    want them left alone until you say so.
options:
  - id: stay
    title: They stay deferred until you bring them back
    summary: A deferred card without a date keeps today's behaviour; it waits in the collapsed Deferred list, marked "no return date", until you press Back to queue or snooze it.
    pros:
      - Nothing comes back that you didn't ask for; a card parked for good stays parked
      - No surprise in the queue on the day snooze ships
    cons:
      - Those cards keep the problem snooze was chosen to fix; they are easy to forget
      - Two kinds of deferred card to explain on the page, with a date and without
  - id: back-now
    title: They come back to the queue once
    summary: No date counts as a date already passed; the card appears in the queue marked "back from deferral", and d snoozes it again for a week.
    pros:
      - Every deferred card ends up with a return date or a decision; nothing stays forgotten
      - The simplest rule; the queue needs no special case
    cons:
      - On the day snooze ships, every old deferral lands in your queue at once
      - A card someone deferred by hand comes straight back, even if they meant it to stay out
  - id: hub-dates
    title: The hub gives them a week from when it first sees them
    summary: The first time the hub finds a deferred card without a date, it writes a return date one week later into the card, as if you had pressed d that day.
    pros:
      - Matches snooze's default literally; every card gets the same week
      - Nothing comes back on the day snooze ships; old deferrals return a week later, and the page shows the date until then
    cons:
      - The hub changes card files without you doing anything, which it never does today
      - Two machines that each see the card first write different dates, and Sync stops with a conflict on that card
      - The card says you chose that date, when you didn't
---

## Context

**What snooze adds.** On [0017](0017-deferred-resurfacing.md) you chose `snooze`: `d` defers
a card for a week, a small menu offers other dates, and the card stores the date in a new field,
`defer_until`. Once the date passes, the queue shows the card again, marked "back from
deferral". The file isn't rewritten when the date passes; the queue works it out
(`docs/roadmap.md`, "Snooze").

**The gap.** Some deferred cards have no `defer_until`: every card deferred before snooze
ships, and any card set to `status: deferred` by hand. The roadmap leaves open what they do
("Needs a card", item 2).

**Why "a week" has no obvious start.** Today a deferral leaves no record of when it happened,
unless you typed a note with it: the `defer` action adds a `feedback` entry only when there is a
note (`applyAction` in `src/core/actions.ts`), and the hub's `d` sends none (`defer` in
`src/web/views/CardView.tsx`). So for most old deferrals there is no date to count a week
from.

**What there is today.** On this machine only one project is registered (president), and it
has no deferred cards. The demo project (`examples/demo-project`) has one,
`0003-first-run-copy.md`, deferred on 2026-11-08 with the note "I want to see the trip screen
working before I write words for it." That card is the example below.

**What the page says today.** A deferred card shows "Deferred. It stays out of the queue until
reopened." with **Back to queue** (`src/web/views/CardView.tsx`), and the queue lists it under a
collapsed "Deferred (n)" (`src/web/views/QueueView.tsx`).

## Option stay: They stay deferred until you bring them back

```
▸ Deferred (1)
   #0003  What should the app say the first time someone opens it?   no return date
```

On the card: "Deferred, with no return date. [Back to queue] [Snooze…]".

## Option back-now: They come back to the queue once

```
#0003  What should the app say the first time someone opens it?   back from deferral
```

Pressing `d` on it snoozes it until a week from now, like any card.

## Option hub-dates: The hub gives them a week from when it first sees them

If snooze ships on 18 November, the first hub start after that adds to the card:

```yaml
defer_until: 2026-11-25T09:00:00Z
```

and the card is back in the queue on 25 November.

## Technical detail (for the implementer)

- `stay`: the queue treats a missing `defer_until` as "never"; `back-now`: as "already
  passed". Both are one line in the queue code and never write the card.
- `hub-dates` is a write the human didn't make. It would need its own action (not Undo-able,
  since nobody pressed anything), and if two machines write it before syncing, both change the
  same new line, which stops Sync ("Not synced: 0003 changed on both machines").
- Under every option, `d` on such a card sets a real `defer_until` (`ALLOWED_FROM.defer` gains
  `deferred`, as the roadmap's Snooze section already requires).

## Sources

- Card [0017](0017-deferred-resurfacing.md), option `snooze`; `docs/roadmap.md`, "Snooze
  (#0017)" ("Not decided: what a deferred card **without** `defer_until` does") and "Needs a
  card", item 2.
- Code: `src/core/actions.ts` (`defer` appends feedback only with a note;
  `ALLOWED_FROM.defer` is `["open"]`), `src/web/views/CardView.tsx` (`d` sends no note; the
  "Deferred. It stays out of the queue until reopened." notice), `src/web/views/QueueView.tsx`
  (the "Deferred (n)" list), `src/core/queue.ts` (`buildQueue` keeps only open cards).
- `examples/demo-project/decisions/0003-first-run-copy.md`; the registry on this machine
  (`~/.config/president/projects/`), checked 2026-11-11: one project, president, with no
  deferred card.
