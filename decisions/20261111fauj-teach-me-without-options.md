---
id: "20261111fauj"
title: What should Teach me give on an open card that has no options to compare?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:26Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, teach-me, learning]
depends_on: ["0005"]
recommendation:
  option: scenario
  why: >-
    It keeps what you chose in 0005 (one real scenario, a prediction first, a step-by-step
    walk-through, what it leaves out) and only drops the comparison there is nothing to
    compare. Inventing candidate answers would put the agent's ideas in front of yours on
    exactly the cards where you were asked for your own words. Pick sketches if you find a
    blank answer box harder than reacting to drafts.
options:
  - id: scenario
    title: One scenario and what any answer must handle
    summary: The agent picks one realistic scenario, asks what you'd want to happen in it, then walks through what an answer has to cope with there, and says what the scenario leaves out.
    pros:
      - Same shape as Teach me on every other card, minus the comparison
      - Gives you what you need to answer without putting words in your mouth
    cons:
      - Without options to contrast, you learn less about the differences that matter than on a choice card
      - One scenario can still mislead if it isn't typical
  - id: sketches
    title: The agent drafts a few answers and compares them
    summary: The agent writes two or three candidate answers itself, labelled as its own sketches, and runs 0005's worked example on them.
    pros:
      - The full worked example, comparison included
      - Reacting to drafts is often easier than starting from a blank box
    cons:
      - The agent's drafts anchor you on a card where you were asked for your own answer, the same worry that led you to hide the agent's pick (0008)
      - It is close to writing options the card's author chose not to write
  - id: off
    title: No Teach me on these cards
    summary: Cards with no options don't show the Teach me button; More info and questions still work.
    pros:
      - Nothing to design or build for a rare case
      - No risk of a lesson that doesn't fit the card
    cons:
      - The one kind of card that leaves the most to you gets the least help
      - A button that comes and goes depending on the card is confusing
---

## Context

**What 0005 decided.** On [0005](0005-teach-me-format.md) you chose `worked`: the first answer
to **Teach me** picks one realistic scenario from the project, asks you to predict which option
handles it better, walks each option through it step by step (one column per option), points
out where they differ, and says what the scenario leaves out (`docs/roadmap.md`, "Teach me: a
worked example").

**The gap.** An `open` card asks for an answer in your own words, and may leave `options` out
entirely (`docs/card-format.md`, "Kinds": "`options` may be left out; if present they are
suggestions"). On such a card there is nothing to predict between or compare (`docs/roadmap.md`,
"Needs a card", item 12). An `open` card that does list suggestions can use 0005's format on
them as is.

**How common.** Rare so far: none of president's own cards is `open`; the demo project's
`0003-first-run-copy.md` is one, with no options. It is the example below: "What should the app
say the first time someone opens it?", with the context "calm and practical, like a good trail
guide, not a fitness app" and three directions to react to.

## Option scenario: One scenario and what any answer must handle

> **First, a guess:** a hiker installs the app at the trailhead with one bar of signal and
> opens it. What do you want them to do in the next ten seconds?
>
> **Walking through it:** the screen is empty; the line must (1) say what the app is for in
> under ten words, (2) point at the one button, (3) not promise a sync that won't happen
> offline. The three directions on the card each cover some of these: "Plan here. It all works
> without signal." covers 1 and 3...
>
> **What this leaves out:** someone opening it at home with time to read, who might want more.

## Option sketches: The agent drafts a few answers and compares them

> **My sketches** (not the card's options): (a) "Where are you headed?" (b) "Plan your route.
> It works offline." (c) "Add your first trip."
>
> **First, a guess:** at the trailhead with one bar of signal, which works best?
>
> | | (a) | (b) | (c) |
> |---|---|---|---|
> | Says what the app is for | no | yes | partly |
> ...

## Option off: No Teach me on these cards

```
Discuss
  [More info]   [Ask...                                    ]
```

## Technical detail (for the implementer)

- The hub chooses the prompt by whether the card has options (`fm.options.length === 0`), as
  the Neither button already does (`src/web/views/CardView.tsx`).
- `sketches` labels the drafts in the conversation only; they are never written to the card.

## Sources

- Card [0005](0005-teach-me-format.md), option `worked`; card
  [0008](0008-recommendation-placement.md) (`hidden`).
- `docs/card-format.md`, "Kinds"; `docs/roadmap.md`, "Teach me: a worked example (#0005)" and
  "Needs a card", item 12.
- `examples/demo-project/decisions/0003-first-run-copy.md`; `decisions/` (no `kind: open` card).
- Code: `src/web/views/CardView.tsx` (Neither is offered only when the card has options).
