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
  option: field
  why: >-
    A retraction should take the card out of your queue at once, say why, and stay
    reversible and visible. A withdrawn field does all three through the president update
    agents already use, with its guard, and leaves the card answerable if you disagree; a
    status needs a new command and new transition rules, though with a status, update's guard
    already covers your putting a card back (with the field, the Back to queue button has to
    add a feedback entry for that). Pick status if
    you want "withdrawn" to be a real state that every tool knows. Deleting is simpler but
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
  - id: field
    title: A withdrawn field, status unchanged
    summary: The agent adds withdrawn (when and why) to the card with president update, which already lets agents add their own fields; the hub moves such cards to a collapsed "Withdrawn" section with the reason, and you can still answer them.
    pros:
      - No new status, command or transitions; it uses update and its guard (refused if you acted on the card meanwhile)
      - Out of your queue immediately, with the agent's reason on the card
      - Reversible either way, as the agent can remove the field with another update, or you can answer the card anyway
    cons:
      - The card is still "open" to everything that doesn't know the field (president pending, validate, a search for status open), so the hub and the docs must still learn it
      - Putting it back in the queue yourself needs a new hub action that removes the agent's field (answering it directly works without one)
      - Putting it back isn't covered by update's guard, which only compares status, resolution, feedback, seen_at and applied_at; an agent's update made from an earlier read would withdraw it again unless putting it back also adds a feedback entry
      - Withdrawn cards pile up in decisions/, as with a status
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

Agents can already add fields of their own, though: "Any other field is allowed and is kept
untouched when president updates the card, so agents can add their own bookkeeping to an open or
deferred card (through `president update`" (`docs/card-format.md`). The hub ignores such fields
today, so one only takes effect once the hub learns to read it (option field).

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

## Option field: A withdrawn field, status unchanged

The agent writes its new version of the card with this added, and runs `president update`:

```yaml
status: open
withdrawn:
  at: 2026-11-14T10:00:00Z
  reason: The queue was rewritten in #0015; dependencies no longer affect ordering.
```

Queue: `▸ Withdrawn by agents (1)`. The card page shows "Withdrawn by the agent: The queue was
rewritten..." above the options, which still work. An agent that changes its mind removes the
field with another `president update`. A **Back to queue** button would remove the field and
also add a note to `feedback` (for example "Back in the queue"), because `update` only refuses
an agent's version when a field it compares differs, and it doesn't compare `withdrawn`.

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
