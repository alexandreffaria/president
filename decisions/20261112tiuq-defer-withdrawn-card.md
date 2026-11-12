---
id: "20261112tiuq"
title: Should you be able to defer a card an agent has withdrawn?
status: resolved
kind: choice
priority: low
created: 2026-11-12T19:44:08Z
created_by: claude (PR 24 card writer)
tags: [withdrawn, defer, pr-24]
depends_on: ["0014", "202611116ff6", "0017"]
recommendation:
  option: hidden
  why: >-
    A withdrawn card is one the agent says no longer matters, so "not now" is rarely what you
    mean there; if you disagree with the agent, Back to queue and then d does it in two
    steps. hidden is also what pull request 24 already built, with nothing more to explain.
    Pick clears if you expect to often think "the agent is wrong, but I'll look later" and
    want that in one key; keeps is the most to explain for the rarest case.
options:
  - id: hidden
    title: No Defer on a withdrawn card (as built)
    summary: >-
      A withdrawn card's page offers no Defer buttons and d and D do nothing; Back to queue
      takes their place, and you can defer the card once it is back.
    pros:
      - Nothing to build; it is what pull request 24 does
      - Nothing on the page writes a date that would then be ignored
    cons:
      - Putting a withdrawn card off until later takes two steps (Back to queue, then d)
      - d silently does nothing on this one kind of card (a hint pointing to Back to queue would be easy to add)
  - id: clears
    title: Defer works, and takes the withdrawal away
    summary: >-
      d and D work as on any open card; deferring also removes the agent's withdrawal, so the
      card moves from Withdrawn by agents to Deferred until its date.
    pros:
      - One key for "I don't agree it's moot, but not now"
      - The keys work the same on every undecided card
    cons:
      - Deferring overrides the agent as a side effect, rather than through an explicit Back to queue
      - A new combined action to build, and its Undo
  - id: keeps
    title: Defer works, and the withdrawal stays
    summary: >-
      d and D set the date but the card stays under Withdrawn by agents; the date only counts
      once the withdrawal is removed (by Back to queue or by the agent).
    pros:
      - Records "if this comes back, not before then" without overruling the agent
      - Reuses the existing defer action unchanged
    cons:
      - You set a date that has no visible effect, which is easy to misread
      - The page must explain the stored date while it is ignored
resolution:
  choice: hidden
  resolved_at: 2026-11-12T19:55:27Z
---

## Context

[0014](0014-withdrawn-status.md) (`field`): an agent can mark an open or deferred card
`withdrawn`; the hub then lists it under a collapsed **Withdrawn by agents** section, and you
can still decide, note or reject it, or press **Back to queue**. [0017](0017-deferred-resurfacing.md)
(`snooze`): `d` defers a card for a week, `D` opens a menu of dates.
[202611116ff6](202611116ff6-withdrawn-cards-elsewhere.md) covers a card deferred *before* it
was withdrawn: its date is ignored while it is withdrawn and applies again after Back to queue.

Nothing says whether you can defer a card *while* it is withdrawn. Pull request 24 (the
Withdrawn section) hides `d`, `D` and the Defer buttons there; Back to queue takes their place.
Its reviewer marked this as undecided, so it is in the roadmap's "Needs a card" list. Low
stakes and easy to change later.

Example: the agent withdrew #0042 "Which map tiles should we use?" with "We dropped the map
screen." You think the map may come back next month.

## Option hidden: No Defer on a withdrawn card (as built)

```
Withdrawn by the agent: We dropped the map screen.
...options...
[Decide]  [Neither]  [Note… m]  [Back to queue]
```

You press Back to queue, the card is in the queue, then `D` → Next month.

## Option clears: Defer works, and takes the withdrawal away

```
[Decide]  [Neither]  [Note… m]  [Back to queue]  [Defer d]  [Defer until… D]
```

`D` → Next month: the card loses `withdrawn` and sits under **Deferred** until 12 December.
Toast: "Deferred #0042 until 12 Dec; it is no longer withdrawn."

## Option keeps: Defer works, and the withdrawal stays

Same buttons as clears. `D` → Next month: the card stays under **Withdrawn by agents**, and its
page adds "If it goes back to the queue, it stays deferred until 12 Dec." Back to queue then
puts it under Deferred, as 202611116ff6 already does for an older date.

## Technical detail (for the implementer)

- The `defer` action already accepts withdrawn cards (`ALLOWED_FROM.defer` covers open and
  deferred in `src/core/actions.ts`); only the page hides it (`canDefer` in
  `src/web/views/CardView.tsx` on pull request 24).
- `clears`: `defer` (or a new action) also deletes `withdrawn`. The status or `defer_until`
  change is enough for `preside update`'s guard to refuse an agent's older version, so no
  extra note is needed.

## Sources

- Review of pull request 24 (round 1), flagged question 2: "#0014 and the roadmap list decide,
  note and reject. 0017 says `d` works on open cards. 6ff6 only covers a card deferred
  *before* it was withdrawn. Hiding Defer is invented behaviour, but it is flagged, sensible
  (a date written now would be ignored) and easy to change".
- `docs/roadmap.md`, "Withdrawn cards in the hub (#0014)": "you can decide, note, or reject a
  withdrawn card as usual".
