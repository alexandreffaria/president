---
id: "0008"
title: Where should the agent's recommendation appear on a card?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:08Z
created_by: claude (batch-1 writer)
tags: [ux, recommendation, bias]
depends_on: []
recommendation:
  option: hidden
  why: >-
    The point of president is that you make the call, and the agent writing the card has its
    own leanings (often toward what is easier to build). Forming a view before seeing its pick
    is the design that measurably reduced overreliance on AI advice, for the price of one key
    per card. If you find yourself always revealing it first, switch to "after"; that is a
    sign the recommendation is the most useful part for you.
options:
  - id: after
    title: After the options (today)
    summary: Keep today's layout; the recommended option carries a "Recommended" tag, and "The agent's take" with the reasoning follows the options.
    pros:
      - You read every option before the reasoning, and the tag saves time on easy cards
      - Nothing to build
    cons:
      - The tag sits on the option itself, so you see the pick while you read the options; the "after" is only for the reasoning
      - Anchoring; the first option you see marked as preferred shapes how you read the others
  - id: hidden
    title: Hidden until you ask
    summary: No tag and no "agent's take" until you press a key (for example r) or a "Show the agent's pick" button; once revealed, it stays shown on that card.
    pros:
      - You form your own view first, then compare it with the agent's
      - Disagreements with the agent become visible to you, which is exactly when a second look pays off
    cons:
      - One more step on every card, when on many you would just agree
      - People rate such designs lower even when they help, so it may feel slower and more annoying than it is
  - id: first
    title: First, before the options
    summary: The agent's pick and its reasoning appear right after the context, and the options follow as the supporting detail.
    pros:
      - Fastest for cards where you trust the agent; read the pick, skim the rest, decide
      - Reads like a proposal with alternatives, a familiar format
    cons:
      - The strongest anchoring; the options are read as arguments for or against the pick
      - Makes it easy to approve without reading, which defeats the point of asking you
---

## Context

**Today** (`src/web/views/CardView.tsx` and `src/web/components/OptionCard.tsx`), a card reads:

1. Context
2. The options; the one named in `recommendation.option` shows a **Recommended** tag in its header
3. **The agent's take**: "B. Return a result object — Most of our calls fail in expected ways..."
   (`recommendation.why`)
4. Sources, history, the Discuss placeholder

So the pick is already visible while you read the options (the tag); only the reasoning comes
after. The skill asks agents for "A recommendation with reasoning, in `recommendation`, separate
from the options" and to describe "every option the way its best advocate would".

**Research** (sources below): anchoring makes estimates lean toward the first value seen
(Tversky & Kahneman 1974). In AI-assisted decisions, designs that made people think before
seeing the AI's suggestion, including one where they decided first and could then update after
seeing it, "significantly reduced overreliance", but people "assigned the least favorable
subjective ratings to the designs that reduced the overreliance the most" (Buçinca, Malaya &
Gajos 2021).

## Option after: After the options (today)

```
Context ...
[1] Throw typed errors
[2] Return a result object              Recommended
The agent's take: 2. Return a result object — Most of our calls fail in expected ways...
```

## Option hidden: Hidden until you ask

```
Context ...
[1] Throw typed errors
[2] Return a result object
                                        Show the agent's pick  r
```

After `r`, the tag and "The agent's take" appear as today.

## Option first: First, before the options

```
Context ...
The agent recommends 2. Return a result object — Most of our calls fail in expected ways...
[1] Throw typed errors
[2] Return a result object              Recommended
```

## Sources

- Buçinca, Z., Malaya, M. B. & Gajos, K. Z. (2021). To Trust or to Think: Cognitive Forcing
  Functions Can Reduce Overreliance on AI in AI-assisted Decision-making. *Proc. ACM HCI*,
  5(CSCW1), Article 188. https://doi.org/10.1145/3449287 (open access:
  https://arxiv.org/abs/2102.09692) — "cognitive forcing significantly reduced overreliance ...
  people assigned the least favorable subjective ratings to the designs that reduced the
  overreliance the most."
- Tversky, A. & Kahneman, D. (1974). Judgment under uncertainty: Heuristics and biases.
  *Science*, 185(4157), 1124–1131. https://doi.org/10.1126/science.185.4157.1124 (anchoring,
  "adjustment from an anchor", is one of the three heuristics described).
