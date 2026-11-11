---
id: "202611116ff6"
title: Outside the hub's queue, how should a withdrawn card be treated?
status: open
kind: choice
priority: normal
created: 2026-11-11T18:21:17Z
created_by: claude (batch-3 writer)
tags: [queue, withdrawn, cli, lifecycle]
depends_on: ["0014", "0009", "0017"]
recommendation:
  option: labelled
  why: >-
    Saying in president pending and validate that a card was withdrawn, and why, costs a few
    words of output and lets every agent see it, so labelled and retired both do it. They
    differ on the dependents. A withdrawal often makes them moot too (map pins, once the map
    screen is dropped), and retired raises them among your ready cards before you have agreed
    with it; labelled keeps them at the bottom, marked, until you decide or put back the
    withdrawn card. Pick retired if you trust agents' withdrawals and would rather dependents
    never wait behind a collapsed list; hub-only only saves a little building.
options:
  - id: retired
    title: Withdrawn means out of play everywhere
    summary: president pending and validate say a card is withdrawn, and it no longer holds back the cards that depend on it.
    pros:
      - Cards waiting on a question that no longer matters come back up among the ready cards, with a mark saying why
      - Any agent sees from president pending and validate that a card was withdrawn and why, not only the one that withdrew it
    cons:
      - A dependent card can rise before you have agreed the withdrawal was right; if you put the card back, the dependent sinks again
      - Two commands and the queue learn a new field, a little more to build and test
  - id: labelled
    title: Labelled everywhere, dependents stay sunk
    summary: president pending and validate say a card is withdrawn and why; cards that depend on it stay sunk until you decide it or put it back.
    pros:
      - Any agent sees from president pending and validate that a card was withdrawn and why
      - Nothing rises in your queue before you agree the withdrawal was right
    cons:
      - Dependent cards can wait at the bottom behind a card hidden in a collapsed list
      - A little to build in two commands
  - id: hub-only
    title: Withdrawn only changes where the hub lists it
    summary: Only the hub's queue moves the card to Withdrawn; president pending and validate print it as an open card, and the cards that depend on it stay sunk until you decide it or put it back.
    pros:
      - Nothing changes for the rest of the queue until you have seen the withdrawal
      - The least to build; the commands stay as they are
    cons:
      - Dependent cards stay at the bottom behind a card that is hidden in a collapsed list, so they can wait a long time for no reason
      - Other agents running president pending or validate can't tell the card was withdrawn
---

## Context

**What 0014 decided.** On [0014](0014-withdrawn-status.md) you chose `field`: an agent retracts
an open or deferred card by adding, through `president update`,

```yaml
withdrawn:
  at: 2026-11-14T10:00:00Z
  reason: The queue was rewritten in #0015; dependencies no longer affect ordering.
```

The card's `status` doesn't change. The hub's queue leaves it out and lists it in a collapsed
"Withdrawn by agents (n)" section, where you can still decide it, note it, or put it back
(`docs/roadmap.md`, "Withdrawn cards in the hub" and "The `withdrawn` field").

**What is left open** (`docs/roadmap.md`, "Needs a card", item 3):

1. **The commands.** `president pending` and `president validate` don't know the field, so they
   show a withdrawn card as a plain open (or deferred) card. That was 0014's stated cost.
2. **Cards that depend on it.** On [0009](0009-dependent-cards-in-queue.md) you chose `sink`:
   a card whose `depends_on` names an undecided card goes below the ready cards. A withdrawn
   card is still `open`, so today's check (`openDependencies` in `src/core/queue.ts`, which
   counts any card not `resolved`) would keep its dependents sunk.
3. **Withdrawn and deferred at once.** With snooze ([0017](0017-deferred-resurfacing.md)), a
   card can be deferred until a date and then withdrawn. Is it listed under Deferred or
   Withdrawn, and does it come back when its date passes?

The options below answer 1 and 2 together. They are separate questions, so the options cover
each sensible pair: `labelled` (the commands say it, dependents stay sunk), `retired` (the
commands say it, dependents rise) and `hub-only` (neither). The fourth pair, dependents rise
while the commands still call the card open, is left out: it would take the risky step
(moving your queue on the agent's word) and skip the harmless one (telling other agents).
Since every sensible pair is here, one card is enough.

For 3, all three options list such a card under Withdrawn and ignore its return date while it
is withdrawn (the agent's later word wins; Back to queue removes the withdrawal and the date
applies again). If you'd rather it come back on its date, with the reason shown, say so in
your note.

Example: #0042 "Which map tiles should we use?" is withdrawn with the reason "We dropped
the map screen." #0047 "How should map pins look?" has `depends_on: ["0042"]`.

## Option retired: Withdrawn means out of play everywhere

Queue: #0047 is among the ready cards, marked "depends on #0042, withdrawn".

```
$ president validate
ok      0042-map-tiles.md (withdrawn: We dropped the map screen.)
ok      0047-map-pins.md
```

`president pending` lists a withdrawn card only when it would anyway (you added a note,
decided it), with "(withdrawn)" after its title.

## Option labelled: Labelled everywhere, dependents stay sunk

Queue: #0047 stays at the bottom, marked "depends on #0042, withdrawn", while #0042 sits under
"Withdrawn by agents (1)". `president validate` and `president pending` say what they say
under `retired`. If you agree the map screen is gone, you decide #0047 (or an agent withdraws
it too); if you put #0042 back, nothing has moved.

## Option hub-only: Withdrawn only changes where the hub lists it

Queue: #0047 stays at the bottom, marked "depends on #0042", while #0042 sits under
"Withdrawn by agents (1)". `president validate` and `president pending` print what they print
today.

## Technical detail (for the implementer)

- `retired`: `openDependencies` (`src/core/queue.ts`) skips dependencies that have a
  `withdrawn` field, and the card page's notice for a dependency says it was withdrawn;
  `validate` adds the reason to the `ok` line; `pending`'s text and `--json` output gain a
  `withdrawn` mark.
- `labelled`: `validate` and `pending` as in `retired`; `openDependencies` is unchanged, and
  only the dependency notice on the card page and in the queue says the dependency was
  withdrawn.
- All three: the queue ignores `defer_until` on a card with `withdrawn`, and Back to queue removes
  the field (with its feedback note, as the roadmap requires).

## Sources

- Cards [0014](0014-withdrawn-status.md) (option `field`, and its con "The card is still
  'open' to everything that doesn't know the field (president pending, validate, ...)"),
  [0009](0009-dependent-cards-in-queue.md) (`sink`), [0017](0017-deferred-resurfacing.md)
  (`snooze`).
- `docs/roadmap.md`, "Withdrawn cards in the hub (#0014)", "The `withdrawn` field (#0014)" and
  "Needs a card", item 3.
- Code: `src/core/queue.ts` (`openDependencies`, `buildQueue`), `src/cli/commands.ts`
  (`validate`, `pending`).
