---
id: "20261111sblu"
title: On A/B cards, where should the conversation panel go?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:20Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, ux, layout]
depends_on: ["0002"]
recommendation:
  option: three
  why: >-
    An A/B card exists to compare two examples side by side, and you chose the side panel
    so you can ask about an option while looking at it; three columns is the only layout
    that keeps both. The price is narrower examples (about 50 characters of code per line
    on a 1440-pixel window, against about 60 today), so long lines scroll sideways. Pick
    stack if your A/B cards are mostly long code, where width matters more than side by
    side.
options:
  - id: three
    title: Three columns
    summary: Option A, option B and the conversation sit side by side; each option column gets narrower while the panel is open.
    pros:
      - You keep the side-by-side comparison and the conversation in view together
      - Works the same way as the side panel on every other card
    cons:
      - Each option is about 13% narrower on a 1440-pixel window and about 27% on a 1280-pixel one, so long code lines scroll sideways more often
      - Three columns of text at once is a busy screen on a laptop
  - id: overlay
    title: The panel slides over the card
    summary: The card keeps today's two-column layout; opening the conversation slides it in from the right over part of the card, and closing it shows the whole card again.
    pros:
      - The options keep today's full width while the panel is closed
      - Nothing about the A/B layout changes
    cons:
      - While the panel is open it covers about 40% of option B on a 1440-pixel window and more than half on a 1280-pixel one, so you can't read B and ask about it at once
      - Differs from every other card, where the panel sits beside the card
  - id: stack
    title: The options stack while the panel is open
    summary: With the conversation open, A and B sit one above the other (as they already do on narrow windows) in a column beside the panel; closing the panel puts them side by side again.
    pros:
      - Each option gets the full width of the card column, the most room for code
      - Two columns, like every other card with the panel open
    cons:
      - You lose the side-by-side comparison exactly while you are discussing it; B is below A, so comparing means scrolling
      - The layout jumps when you open or close the panel
---

## Context

**What 0002 decided.** On [0002](0002-conversation-placement.md) you chose `side`: the card
stays in the left column and the conversation fills a right-hand column, opened and closed
with a key; below about 1100 pixels of width it falls back to sitting under the options. 0002
named its own cost: "A/B cards, which already use a 72rem layout for two columns, become three
columns or need the panel to overlay." Which one is left open (`docs/roadmap.md`, "Where the
conversation sits", and "Needs a card", item 6).

**A/B cards today.** An `ab` card shows exactly two options side by side for direct comparison
(`docs/card-format.md`, "Kinds"). Its page is 72rem (1152 pixels) wide instead of 50rem
(`.card-page-wide` in `src/web/styles.css`), with the two options in equal columns
(`.options-ab`); below 52rem (832 pixels) they already stack one above the other.

**The numbers used below**, on the card format's own A/B example (two versions of a
`getTrip` function, with lines up to about 85 characters). The panel's width isn't decided; I
assumed 24rem (384 pixels). Characters per line are for code blocks (0.85rem monospace),
approximate.

| Window width | Today | three | overlay (panel open) | stack |
|---|---|---|---|---|
| 1440 px | each option 568 px, about 60 characters | each 492 px, about 50 | B partly covered (about 240 of its 568 px) | each about 800 px, about 88 |
| 1280 px | each 568 px, about 60 | each 412 px, about 41 | B more than half covered | each about 800 px, about 88 |
| under 1100 px | | conversation below the options (0002) | same | same |

## Option three: Three columns

```
┌──────────────────┬──────────────────┬───────────────┐
│ A  Throw typed   │ B  Return a      │ Conversation  │
│    errors        │    result object │ you: why B?   │
│ ```ts            │ ```ts            │ agent: ...    │
│ export async ... │ type ApiResult.. │ [Ask...     ] │
└──────────────────┴──────────────────┴───────────────┘
```

## Option overlay: The panel slides over the card

```
┌────────────────────────┬──────────┬───────────────┐
│ A  Throw typed errors  │ B  Retur │ Conversation  │
│ ```ts                  │ ```ts    │ you: why B?   │
│ export async function  │ type Api │ agent: ...    │
└────────────────────────┴──────────┴───────────────┘
                  (B continues under the panel)
```

## Option stack: The options stack while the panel is open

```
┌──────────────────────────────────┬───────────────┐
│ A  Throw typed errors            │ Conversation  │
│ ```ts ... ```                    │ you: why B?   │
│ B  Return a result object        │ agent: ...    │
│ ```ts ... ```                    │ [Ask...     ] │
└──────────────────────────────────┴───────────────┘
```

## Technical detail (for the implementer)

- `three`: the page's max width grows by the panel's width while it is open, and
  `.options-ab` keeps two columns inside the card column.
- `overlay`: the panel is positioned over the page (fixed, right side) and doesn't change the
  card's layout.
- `stack`: `.options-ab` switches to one column while the panel is open, the rule that
  already applies below 52rem.
- The 1100-pixel fallback from 0002 applies under every option.

## Sources

- Card [0002](0002-conversation-placement.md), option `side` and its con about A/B cards;
  `docs/roadmap.md`, "Where the conversation sits: a side panel (#0002)" and "Needs a card",
  item 6.
- `docs/card-format.md`, "Kinds" (`ab`: "exactly 2 options shown side by side, for comparing
  two concrete examples") and its full example.
- Code: `src/web/styles.css` (`.card-page-wide` 72rem, `.options-ab` two columns, one column
  below 52rem, `.main` padding 1.25rem, `.option` padding 1.25rem, `.markdown pre` 0.85rem
  with `overflow-x: auto`), `src/web/views/CardView.tsx` (`card-page-wide` and `options-ab` on
  `ab` cards).
