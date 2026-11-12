---
id: "20261112irpn"
title: On a card with no pick, should the chat give its own view?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:15:53Z
created_by: claude (PR 25/27 card writer)
tags: [pr-2, chat, recommendation, bias]
depends_on: ["0008", "20261111mby8"]
recommendation:
  option: r-asks
  why: >-
    It keeps the rule you chose in 0008 and 20261111mby8 (form your view, then press r to hear
    the agent's) on every card, so r means the same thing everywhere, and nothing stays out of
    reach for good. Pick never if open cards are where you most want the answer to be yours
    alone; pick free if you think a chat with no written pick has nothing to anchor you on.
options:
  - id: never
    title: Never gives its own view (as built, with honest wording)
    summary: >-
      The chat stays neutral for good on such a card; asked, it says the card has no pick and
      that it keeps its own view out so the answer is yours.
    pros:
      - The answer on an open card is always yours, as 20261111fauj chose for Teach me on cards with no options
      - Nothing to build beyond fixing the line's wording
    cons:
      - You can never get the agent's view in the chat, even after you have formed your own
      - The chat dodges a question it could answer, with no key to change that
  - id: free
    title: Free, since there is no pick to protect
    summary: >-
      With no recommendation on the card, the chat answers as it does after r, and gives its
      own view when asked.
    pros:
      - The chat answers every question you ask it
      - Nothing to reveal and nothing to explain on the page
    cons:
      - Its first answer can anchor you before you have thought, which is what 0008 hid the pick for
      - "Two kinds of chat: neutral on cards with a pick, free on cards without"
  - id: r-asks
    title: r asks for its view
    summary: >-
      The chat stays neutral until you press r, which on a card with no pick tells it you
      want its view; the page then says "The agent's view is in the chat."
    pros:
      - One rule for every card; r always means "now tell me what you think"
      - You get the agent's view when you want it, after forming yours
    cons:
      - r does something new on these cards, to build and explain
      - The view comes as a chat message, not as a written pick on the card
resolution:
  choice: r-asks
  resolved_at: 2026-11-12T20:22:09Z
---

## Context

Under 20261111mby8 (`neutral`), the hub starts every chat message with a line saying whether
you have revealed the card's pick (its `recommendation`, which 0008 hides behind `r`). A card
can have no pick: an `open` card often has none, and an agent may leave it out. On such a card
the page shows no pick and `r` does nothing, but pull request 25 still sends the "not
revealed" line, which tells the chat "if asked which one to choose, say the pick is behind r".
So the chat stays neutral for good and points you at a key that shows nothing. No card covers
this. The wording is a fix the implementer owns; whether the chat gives a view is yours.

Example: the open card "What should the app say the first time someone opens it?" has no
options and no pick. You ask the chat "What would you write?"

## Option never: Never gives its own view (as built, with honest wording)

```
agent   This card has no pick, and I'll keep my own wording out of it so the answer is
        yours. What it has to do: one line that says what the app is for ...
```

## Option free: Free, since there is no pick to protect

```
agent   I'd write "Your decisions, one card at a time." It says what the app is for
        in five words ...
```

## Option r-asks: r asks for its view

Before `r`, as in `never`. After you press `r`, the page shows "The agent's view is in the
chat.", and the next answer gives it:

```
agent   You asked for my view: "Your decisions, one card at a time." ...
```

## Sources

- Pull request 25, `src/server/chat/prompts.ts`: `pickLine` returns "The human has not
  revealed the card's pick. Until they do, ... if asked which one to choose, say the pick is
  behind r" whenever nothing was revealed, a card without a `recommendation` included.
- `src/web/views/CardView.tsx`: the pick and its reveal show only when `fm.recommendation` is
  set.
- Pull requests 25 and 27, "Needs a card", item 3.
- [0008](0008-recommendation-placement.md) (`hidden`),
  [20261111mby8](20261111mby8-chat-and-hidden-pick.md) (`neutral`),
  [20261111fauj](20261111fauj-teach-me-without-options.md) (`scenario`; its reasoning:
  "Inventing candidate answers would put the agent's ideas in front of yours on exactly the
  cards where you were asked for your own words").
