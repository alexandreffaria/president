---
id: "0010"
title: Should you be able to give your own answer on choice and A/B cards?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:10Z
created_by: claude (batch-1 writer)
tags: [ux, action-bar, custom-answer]
depends_on: []
recommendation:
  option: neither-plus
  why: >-
    The moment you know your own answer is the moment you look at the options and think
    "none of these", which is exactly when the Neither panel is open. Adding "Decide this
    as my answer" there gives the feature with no new key and no new panel, and keeps the
    difference visible: ask for new options, or settle it now.
options:
  - id: open-only
    title: Keep it on open cards only
    summary: Today's behaviour; choice and A/B cards offer the options, Neither (new options) and a note, and only open cards take your own answer.
    pros:
      - Nothing to build; one clear rule per kind
      - Pushes agents to write good options, and you to say what's missing so they do
    cons:
      - When you already know the answer, you must say "neither", wait for an agent to write your answer as an option, then pick it
      - Or you pick the closest option and write the real answer in "Why?", which the agent may read as a nuance instead of a different answer
  - id: always
    title: An "Own answer" action on every card
    summary: A new key (for example o) opens a panel on any card to type an answer and decide it directly as a custom resolution.
    pros:
      - The fastest path when you know what you want, on any card
      - Same action everywhere, easy to learn
    cons:
      - A fourth action in the action bar (Decide, Neither, Note, Own answer) and another key
      - Easy to reach for instead of reading the options properly
  - id: neither-plus
    title: A second button in the Neither panel
    summary: The Neither panel keeps "Ask for new options" and gains "Decide this as my answer", which resolves the card with what you typed.
    pros:
      - No new key or panel; it appears exactly when you have rejected the options
      - Makes you choose explicitly between "try again" and "here is my answer"
    cons:
      - Hidden one step deeper than option always; you have to know it's in the Neither panel
      - The panel's question ("What's wrong with them?") needs rewording to fit both buttons
---

## Context

**The format already allows it.** Any card can be resolved with `choice: custom` and the answer
in the note: `applyAction` in `src/core/actions.ts` accepts `custom` on every kind, and the
schema checks only that a custom resolution has a note (`src/core/schema.ts`). Agents already
handle custom answers in `president pending` (`describeDecision` in `src/cli/commands.ts`).

**The UI offers it only on open cards.** In `ActionBar` (`src/web/views/CardView.tsx`) the
"Your answer" textarea is shown only when `fm.kind === "open"` and no suggestion is selected.
On choice and A/B cards the bar has: the selected option and an optional "Why?" field, Decide,
Neither (`n`, asks for new options), Note (`m`) and Defer (`d`).

## Option open-only: Keep it on open cards only

```
[2] Return a result object   [Why? (optional)          ]  Decide ⏎   Neither n  Note m  Defer d
```

## Option always: An "Own answer" action on every card

```
[2] Return a result object   [Why? (optional)  ]  Decide ⏎   Own answer o   Neither n  Note m  Defer d

(o opens)
Your answer, instead of the options:
[ Throw for programmer errors, return results for network failures.        ]
                                                         Close Esc   Decide Ctrl ⏎
```

## Option neither-plus: A second button in the Neither panel

```
(n opens)
None of these. What would you rather see, or what is your answer?
[ Throw for programmer errors, return results for network failures.        ]
                  Close Esc   Ask for new options Ctrl ⏎   Decide this as my answer
```
