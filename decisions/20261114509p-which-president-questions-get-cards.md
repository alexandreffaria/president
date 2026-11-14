---
id: "20261114509p"
title: Which of president's own questions should become cards?
status: resolved
kind: choice
priority: normal
created: 2026-11-14T03:00:52Z
created_by: claude-code (reflection)
tags: [process, cards]
depends_on: []
recommendation:
  option: direction-only
  why: >-
    The one card you overrode (76n0, where the hub runs) was a direction card; the other 55
    you confirmed with no note, most in under half a minute. Pick batch if you want to see
    every small choice before it ships.
options:
  - id: direction-only
    title: Only direction, UX and scope
    summary: >-
      Cards only for what changes what you get; I decide edge cases and mechanics myself and
      list them in the pull request.
    pros:
      - Far fewer, more meaningful cards
    cons:
      - You might disagree with a small choice only after it ships
  - id: batch
    title: Small ones together in one card
    summary: Direction gets its own card; a pull request's edge cases go into one list card.
    pros:
      - You still see every choice
    cons:
      - One longer card per pull request
  - id: all
    title: Everything, as now
    summary: Every question that is yours by the skill's rules gets its own card.
    pros:
      - Nothing decided without you
    cons:
      - Most cards are confirmations
resolution:
  choice: direction-only
  resolved_at: 2026-11-14T03:18:32Z
---

## Context

Most of president's 56 cards were follow-ups that earlier decisions or reviews raised (undo,
a second tab, another machine). This sets the rule for president only; other projects keep
the skill as it is.
