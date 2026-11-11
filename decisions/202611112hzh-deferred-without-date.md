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
    and it is the simplest rule to build, with nothing new to store. The pile it brings back
    is small today (the one registered project has no deferred card). Pick hub-dates if you
    expect many deferred cards by the time snooze ships and want a week's notice before they
    return; pick stay if you deferred some cards "for good" and want them left alone until
    you say so.
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
    title: They get the default week, counted by the hub
    summary: The card comes back a week after you deferred it when the card records that day (a deferral with a note), otherwise a week after the hub first sees it; the hub keeps that day in its own per-machine state, and the card file is unchanged.
    pros:
      - Every deferred card gets snooze's default week, counted from the deferral itself whenever the card records it
      - A card with no record of its deferral comes back a week after snooze ships, not on the day, and the page shows its return date until then
      - The card file is never changed, so nothing new travels with Sync
    cons:
      - On another machine the card can come back on a different day, since each hub counts from when it first saw the card
      - One more per-machine record to keep
      - Cards with no record of their deferral still come back together, a week after snooze ships, and a card deferred by hand comes back too
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

## Option hub-dates: They get the default week, counted by the hub

Say snooze ships on 18 November. #0003 was deferred on 8 November with a note, so the card
records that day: its week ended on 15 November, and it is back in the queue at once, marked
"back from deferral". An invented #0042, deferred with `d` (no note, so no date in the card),
is first seen by the hub on 18 November:

```
▸ Deferred (1)
   #0042  Should failed requests throw or return a result?   back on 25 Nov
```

The card file doesn't change. The hub notes "president, 0042, first seen 18 November" in its
own state folder on this machine; on your other machine, whose hub first sees #0042 on 20
November, it comes back on 27 November.

## Technical detail (for the implementer)

- `stay`: the queue treats a missing `defer_until` as "never"; `back-now`: as "already
  passed". Both are one line in the queue code and never write the card.
- `hub-dates`: the queue's return date for a deferred card without `defer_until` is the `at`
  of its last `defer` feedback entry plus 7 days when there is one and no `reopen` entry came
  after it, otherwise "first seen" plus 7 days. "First seen" is kept per machine in
  president's state folder (`$XDG_STATE_HOME/president/`, like 0021's session store), keyed
  by project and card id, and written the first time the hub reads the card deferred without
  a date. The card is never written, so there is no new action and nothing for Undo or Sync.
  Once you press `d` or Back to queue, the card's own state takes over and the record can be
  dropped.
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
- Card [0021](0021-session-id-per-machine.md), option `local` (the hub's per-machine store in
  `$XDG_STATE_HOME/president/`), which `hub-dates` would reuse.
- `examples/demo-project/decisions/0003-first-run-copy.md` (its `defer` entry has
  `at: 2026-11-08T21:15:00Z`); the registry on this machine
  (`~/.config/president/projects/`), checked 2026-11-11: one project, president, with no
  deferred card.
