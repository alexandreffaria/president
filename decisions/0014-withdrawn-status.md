---
id: "0014"
title: How should an agent retract a card that is no longer relevant?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:14Z
created_by: claude (batch-1 writer)
tags: [format, lifecycle, status]
depends_on: []
recommendation:
  option: status
  why: >-
    A retraction should take the card out of your queue at once, say why, and stay
    reversible and visible. A status does all three, and it reuses the patterns deferred
    cards already have (a collapsed section, "Back to queue"). Deleting is simpler but
    leaves you wondering where a card went.
options:
  - id: status
    title: A withdrawn status
    summary: A fourth status, set by an agent with a reason (president withdraw <file> --reason ...); the card leaves the queue, appears in a collapsed "Withdrawn" section, and you can put it back.
    pros:
      - Out of your queue immediately, with the agent's reason on the card
      - Reversible and visible; the card and its history stay in the folder
      - Guarded like other agent writes (refused if you acted on the card meanwhile)
    cons:
      - A schema change every tool and doc must learn (status list, transitions, pending, UI filters)
      - Withdrawn cards pile up in decisions/ unless someone cleans them up
  - id: delete
    title: Let agents delete the file
    summary: The skill allows deleting an open card that is obsolete, with the reason in the commit message; git keeps the history.
    pros:
      - No format or code change, only a skill change
      - decisions/ holds only live questions
    cons:
      - The card vanishes from the hub with no explanation; if you had it open you see it disappear
      - Your notes on it are gone from the hub (only git has them), and getting it back means git surgery
      - A deletion you didn't see can't be undone from the hub
  - id: rewrite
    title: Keep as is; the agent rewrites the card to say so
    summary: No retraction at all; the agent uses president update to explain in the context that the question is moot, with an option such as "Drop this question" that it recommends.
    pros:
      - No change to president; works today
      - You stay the one who closes every card
    cons:
      - The card keeps a place in your queue until you deal with it
      - A fake "Drop this question" option is a workaround the card format wasn't designed for
---

## Context

**Today** a card's status is `open`, `deferred` or `resolved` (`CARD_STATUSES` in
`src/core/model.ts`). Agents can't change it: `president update` refuses a new version whose
`status` (or `resolution`, `feedback`, `seen_at`, `applied_at`) differs from the card's
(`HUMAN_FIELDS` in `src/cli/commands.ts`), and the skill's rules say "Only edit cards to apply the steps
above" and "Never resolve a card yourself". Nothing in the skill covers deleting a card. So when
the code moves on and a question stops mattering (the feature was dropped, another decision
answered it), the card stays in your queue until you decide, defer or reject it.

## Option status: A withdrawn status

```sh
president withdraw decisions/0009-dependent-cards-in-queue.md \
  --reason "The queue was rewritten in #0015; dependencies no longer affect ordering."
```

```yaml
status: withdrawn
withdrawn:
  at: 2026-11-14T10:00:00Z
  reason: The queue was rewritten in #0015; dependencies no longer affect ordering.
```

Queue: `▸ Withdrawn by agents (1)`. The card page shows the reason and a **Back to queue** button.

## Option delete: Let agents delete the file

Skill addition:

> If an open card no longer matters, delete its file and say why in the commit message
> (`git rm decisions/0009-dependent-cards-in-queue.md`, then commit with
> "Withdraw 0009, the queue was rewritten"). Never delete a card with notes from the
> human you haven't answered.

## Option rewrite: Keep as is; the agent rewrites the card to say so

```yaml
recommendation:
  option: drop
  why: The queue was rewritten in #0015, so this no longer matters.
options:
  - id: drop
    title: Drop this question
  # ...followed by the card's original options, unchanged
```
