---
id: "20261113oew6"
title: Should the card format allow at most 9 options?
status: resolved
kind: choice
priority: low
created: 2026-11-13T03:03:09Z
created_by: claude-code
tags: [card-format, keyboard]
depends_on: []
recommendation:
  option: warn
  why: >-
    No card today has more than 5 options, so any limit is about cards agents write later.
    A warning tells the agent at validate time that options 10 and up have no key, and
    neither breaks a card already in your queue nor hides an option. Pick cap-9 if you'd
    rather agents never write such a card at all; the cost is that a 10-option card stops
    showing until someone fixes it.
options:
  - id: cap-9
    title: "Cap at 9: validate reports an error"
    summary: >-
      card-format says 2 to 9 options; preside validate and preside update reject a card
      with 10 or more, like any other broken card.
    pros:
      - One limit everywhere, the same as the keys and the hub-written options
      - An agent can't write a card whose last options have no key
    cons:
      - A 10-option card already in a project becomes an error card in the hub until it is fixed
      - Forbids long lists that are still usable by click
  - id: warn
    title: "Warn only: validate prints a warning"
    summary: >-
      card-format says the keyboard covers up to 9; validate and update print a warning for
      10 or more, and the hub still shows every option.
    pros:
      - Agents hear about it (the skill already requires validate with no warning)
      - Nothing already written breaks or disappears
    cons:
      - A card with 10+ options can still reach the queue, with options you can only click
      - One more rule to build (a few lines in the schema checks and a test)
  - id: no-cap
    title: Leave the format as it is (as built)
    summary: >-
      card-format keeps "2 or more"; only the options the hub writes after a "neither" are
      capped (PR 29, open, not merged yet).
    pros:
      - No work, nothing changes for existing cards
    cons:
      - An agent can write 12 options and nothing tells it that options 10 to 12 have no key
resolution:
  choice: warn
  resolved_at: 2026-11-13T13:01:01Z
---

## Context

The hub's card view picks options with keys `1` to `9` (`a`/`b` on A/B cards). An option
after the 9th still shows and can be chosen with its button (click, or Tab and Enter), but
no key picks it, and its button shows a `10` key hint that does nothing. The format only
says "2 or more" (2 to 4 is best), and validate only checks the low end. PR 29 (open, not merged
yet) caps the options the hub writes after a "neither" at 9 (exactly 2 on `ab` cards). No card in this
project's `decisions/` has more than 5 options.

Example: a card with 10 options, before you decide it:

```
cap-9    preside validate: error  options: at most 9 options, found 10
warn     preside validate: ok
         warning  options: 10 options; the keyboard picks only 1-9
no-cap   preside validate: ok
```

In the hub, with warn or no-cap, option 10 shows `Choose 10 [10]`; pressing `1` then `0`
picks option 1.

## Sources

- `src/web/views/CardView.tsx`: `for (let i = 0; i < 9; i++) keys[String(i + 1)] = () => selectIndex(i);`
- `src/web/components/OptionCard.tsx`: every option has a `Choose <label>` button with `onClick={props.onSelect}`.
- `src/core/schema.ts`: checks `kind "choice" needs at least 2 options`, no upper limit.
- `docs/card-format.md`: "pick one of 2 or more options (2 to 4 is best; the keyboard covers up to 9)".
- `README.md` key table: "`1`–`9` (`a`/`b` on A/B cards) | select an option".
- Pull request 29 (open): `optionCount` in `src/server/chat/prompts.ts` returns at most 9.
