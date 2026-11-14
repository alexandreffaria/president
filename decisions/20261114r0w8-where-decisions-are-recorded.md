---
id: "20261114r0w8"
title: Should the decisions table keep each decision's reasons?
status: resolved
kind: choice
priority: low
created: 2026-11-14T03:00:52Z
created_by: claude-code (reflection)
tags: [process, docs]
depends_on: []
recommendation:
  option: one-line
  why: >-
    The card already holds the question, the options and your answer, so one line with a
    link is enough to find it. Pick with-reasons if you read foundations.md rather than the
    cards.
options:
  - id: one-line
    title: One line per decision, reasons in the card
    summary: >-
      docs/foundations.md keeps one line per decision with its link and drops the "why"
      column.
    pros:
      - One place to read the reasons
      - Less text for agents to load
    cons:
      - The reason is one click away
  - id: with-reasons
    title: Keep the reasons in the table
    summary: The decisions table stays as it is, each decision with its reasons.
    pros:
      - Reasons readable without opening cards
    cons:
      - Each decision written twice
resolution:
  choice: one-line
  resolved_at: 2026-11-14T03:20:21Z
---

## Context

Each answered card is restated with its reasons in docs/foundations.md (about 6k words). Either
way, the 20k-word roadmap, whose every item is built, moves to docs/archive/ and restarts
with only unbuilt work.
