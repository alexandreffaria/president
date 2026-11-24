---
id: "20261116d34o"
title: What should the Sync button become now that cards travel with branches?
status: resolved
kind: choice
priority: normal
created: 2026-11-16T03:21:36Z
created_by: claude-code
tags: [sync, scope]
depends_on: ["20261116notj"]
recommendation:
  option: pull-only
  why: >-
    Agents now commit most answers, so Sync's commit and push would mostly sit unused, but
    pulling is still how merged cards reach your other machines. Keep it as it is if you often
    answer cards that are already on main.
options:
  - id: remove
    title: Remove Sync
    summary: The Sync button and its "answers not synced" count go; cards reach main only through agents' commits and pull requests.
    pros:
      - One way cards move, and no "Not now" to understand
      - The least code to keep working
    cons:
      - Your other machines get merged cards only when you or an agent runs git pull there
      - An answer to a card already on main stays uncommitted until an agent happens to commit it
  - id: pull-only
    title: Sync only pulls main
    summary: Sync pulls main to bring in merged cards and answers, and never commits or pushes.
    pros:
      - Merged cards still reach your other machines when you press Sync
      - The hub never commits or pushes next to an agent
    cons:
      - Says "Not now" while an agent has the folder on a branch
      - An answer to a card already on main stays uncommitted until an agent happens to commit it
  - id: as-is
    title: Keep Sync as it is
    summary: Sync keeps committing, pulling and pushing card changes while the folder has main checked out; cards on branches travel with their agent.
    pros:
      - Nothing to change
      - Answers to cards on main reach your other machines without an agent
    cons:
      - Says "Not now" while an agent has the folder on a branch
      - Two ways cards move; you must know which answers Sync carries
resolution:
  choice: pull-only
  resolved_at: 2026-11-16T04:12:55Z
applied_at: 2026-11-24T20:39:30Z
---

## Context

Sync commits, pulls and pushes card changes, but only while the project folder has main checked out. Agents now
commit most answers on their branch; answers to cards already on main are left to Sync or a
later commit.
