---
id: "0002"
title: Where on the card page should the conversation with the agent appear?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T13:22:02Z
created_by: claude (batch-1 writer)
tags: [pr-2, chat, ux, layout]
depends_on: []
recommendation:
  option: side
  why: >-
    The point of the chat is to talk about the options while looking at them, and a side
    panel is the only layout that keeps both in view. It costs a narrower card on laptops,
    so it should collapse into the "below" layout under about 1100 px of width.
options:
  - id: side
    title: A side panel next to the card
    summary: The card stays in the left column; the conversation fills a right-hand column that can be opened and closed with a key.
    pros:
      - You can read an option and ask about it without scrolling away from it
      - Teach me, More info and Neither land in the same place, next to what they are about
      - The conversation keeps its own scroll position while you move around the card
    cons:
      - Both columns get narrower; A/B cards, which already use a 72rem layout for two columns, become three columns or need the panel to overlay
      - Needs a fallback on narrow windows and phones, which is the "below" layout anyway
  - id: below
    title: Below the options, in the card's flow
    summary: The conversation replaces today's "Discuss" placeholder, under the agent's take and the history, as part of the page.
    pros:
      - Smallest change; the placeholder already sits there (src/web/components/CardAssistant.tsx)
      - Works the same at every width
      - Reads top to bottom like a document, with the chat as its last part
    cons:
      - Asking about option A means scrolling down past options B to D, then back up to check
      - A long conversation pushes the file path and the end of the page far down, and the fixed action bar covers its last lines
  - id: focus
    title: A focused full-screen mode
    summary: A key (for example c) switches the page to a full-screen conversation, with a compact summary of the options pinned at the top; Esc goes back to the card.
    pros:
      - The most room for long explanations, worked examples and sources
      - The card page itself stays exactly as it is today
    cons:
      - You see either the card or the conversation, never the full option text and the chat at once
      - A mode to enter and leave; the keyboard shortcuts on the card (1 to 9, n, m, d) need a clear rule for what works in it
resolution:
  choice: side
  resolved_at: 2026-11-11T17:32:47Z
applied_at: 2026-11-11T18:09:12Z
---

## Context

PR 2 adds a per-card conversation with a headless Claude Code session, plus *Teach me*,
*More info / research* and *Neither, try again* buttons. This card is only about where it sits
on the page; what the session may do and where it is stored are cards #0004 and #0003.

**The card page today** (`src/web/views/CardView.tsx`), top to bottom in a single column
50rem wide (72rem for A/B cards, `.card-page-wide` in `src/web/styles.css`):

1. Queue navigation, then the header (project, id, kind, priority, title, tags)
2. Notices (changed by an agent, decided, depends on an undecided card)
3. Context
4. Options (stacked, or side by side on A/B cards), the recommended one tagged
5. "The agent's take" (the recommendation and why)
6. Remaining sections (Sources)
7. History (feedback entries)
8. **Discuss**: the placeholder `CardAssistant`, which today only explains that notes (`m`)
   reach agents through `president pending`
9. The file path

A fixed action bar sits at the bottom of the window (Decide, Neither, Note, Defer). Single-key
shortcuts never fire while you type, so a chat input doesn't conflict with them
(`src/web/keyboard.ts`).

## Option side: A side panel next to the card

```
┌──────────────────────────────┬─────────────────────┐
│ #0007 How should errors ...  │ Conversation   [×]  │
│ Context ...                  │ you: why not both?  │
│ [A] Throw typed errors       │ agent: because ...  │
│ [B] Return a result object   │                     │
│ The agent's take ...         │ [Teach me] [More]   │
│                              │ ┌─────────────────┐ │
│                              │ │ Ask...          │ │
├──────────────────────────────┴─────────────────────┤
│ Decide ⏎   Neither n   Note m   Defer d            │
└────────────────────────────────────────────────────┘
```

Toggled with a key; open by default once a card has a conversation. Below about 1100 px it
falls back to the "below" layout.

## Option below: Below the options, in the card's flow

```
#0007 How should errors ...
Context ...
[A] Throw typed errors
[B] Return a result object
The agent's take ...
History ...
── Conversation ───────────────
you: why not both?
agent: because ...
[Teach me] [More info] [Ask...              ]
File: decisions/0007-api-errors.md
```

## Option focus: A focused full-screen mode

```
┌────────────────────────────────────────────────────┐
│ #0007 How should errors ...   A: Throw  B: Result  │  ← pinned summary
│                                                    │
│ you: teach me the background                       │
│ agent: (long explainer, examples, sources) ...     │
│                                                    │
│ [Ask...                                    ]  Esc  │
└────────────────────────────────────────────────────┘
```
