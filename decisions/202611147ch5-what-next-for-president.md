---
id: "202611147ch5"
title: What should president's next two weeks be?
status: resolved
kind: choice
priority: high
created: 2026-11-14T03:00:52Z
created_by: claude-code (reflection)
tags: [direction, scope]
depends_on: []
recommendation:
  option: freeze
  why: >-
    The core loop already works on CellSignalMapper, where your notes and an overridden pick
    shaped real follow-ups; more real use is the best source of the next feature. Pick
    finish if big cards on your projects already feel like several questions.
options:
  - id: freeze
    title: Freeze features, use it on your projects
    summary: >-
      Two weeks of bug fixes, the cleanup plan and today's other cards; a new feature only
      when CellSignalMapper or geode asks for one.
    pros:
      - Next features come from real use
    cons:
      - Known rough edges stay for two weeks
  - id: finish
    title: Build sub-questions first, then freeze
    summary: >-
      Build splitting a card into sub-questions (in the original plan, never built), then
      freeze as above.
    pros:
      - Big cards on your projects can be split from day one
    cons:
      - Nothing yet shows it is needed
  - id: keep-building
    title: Keep building as now
    summary: Keep building whatever president's own work turns up, without a freeze.
    pros:
      - Fastest progress on the tool
    cons:
      - More cards about president, little real use
resolution:
  choice: freeze
  resolved_at: 2026-11-14T03:17:59Z
---

## Context

56 of the 68 cards so far are president deciding about itself, with no note and the agent's
pick every time but once. On CellSignalMapper's 12 you wrote notes and overrode a pick.
