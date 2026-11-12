---
id: "20261112jdyg"
title: Should a decided card's page say an agent had withdrawn it?
status: resolved
kind: choice
priority: low
created: 2026-11-12T19:44:08Z
created_by: claude (PR 24 card writer)
tags: [withdrawn, card-page, pr-24]
depends_on: ["0014", "202611116ff6"]
recommendation:
  option: quiet-line
  why: >-
    The withdrawal isn't in the card's history (it is a field, not a feedback entry), so once
    the card is decided the hub shows it nowhere, although validate and pending still do. One
    muted line keeps that context, for example when you look back and wonder why you decided
    "drop it". It is a few lines to build. Pick nothing if you see a decision as the last word
    and want decided pages as clean as possible.
options:
  - id: nothing
    title: Show nothing (as built)
    summary: >-
      A decided card's page shows only the decision, as for any other card; the withdrawal
      stays in the file.
    pros:
      - Nothing to build; the decision is the card's last word
      - Decided pages all look the same
    cons:
      - The hub no longer shows that, or why, an agent withdrew the card, though preside validate still says it (and pending, until the decision is applied)
  - id: quiet-line
    title: A quiet line under the decision
    summary: >-
      Under the "Decided" notice, a muted line says "An agent had withdrawn this card: <reason>".
    pros:
      - Keeps the agent's reason next to the decision it may explain
      - Matches what preside validate and pending already say about the card
    cons:
      - One more line on a page that is otherwise done
      - A little to build and test
resolution:
  choice: quiet-line
  resolved_at: 2026-11-12T19:54:45Z
applied_at: 2026-11-12T20:12:40Z
---

## Context

[0014](0014-withdrawn-status.md) (`field`): an agent marks an open or deferred card
`withdrawn` with a reason; you can still decide it, and a decision keeps the field (D). Pull
request 24 shows "Withdrawn by the agent: <reason>" on the page of an open or deferred withdrawn card.
Once you decide it, the card is in the Log like any decided card, and its page shows only the
decision. The roadmap describes the notice only for undecided cards ("above the options, which
still work"), so nothing says what a decided page shows. Pull request 24's reviewer marked it
undecided, low stakes. ([202611116ff6](202611116ff6-withdrawn-cards-elsewhere.md) already makes
`preside validate` and `pending` mention the withdrawal whatever the status.)

Example: the agent withdrew #0042 "Which map tiles should we use?" with "We dropped the map
screen.", and you decided it with your own answer, "Dropped with the map screen."

## Option nothing: Show nothing (as built)

```
Decided: own answer, 2 hours ago. An agent has applied it.
Dropped with the map screen.
This decision is made.  [Note… m]  [Reopen]
```

## Option quiet-line: A quiet line under the decision

```
Decided: own answer, 2 hours ago. An agent has applied it.
Dropped with the map screen.
An agent had withdrawn this card: We dropped the map screen.
This decision is made.  [Note… m]  [Reopen]
```

## Sources

- Review of pull request 24 (round 1), flagged question 4: "The roadmap's notice is described
  'above the options, which still work', which is undecided-card language. Nothing says what a
  decided page shows."
- Pull request 24: `activeWithdrawal` is undefined on resolved cards, so `StatusNotice` in
  `src/web/views/CardView.tsx` shows only the "Decided" notice.
