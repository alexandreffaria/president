---
id: "202611167ux1"
title: How should your answers sync while an agent has the project folder on a branch?
status: open
kind: choice
priority: normal
created: 2026-11-16T02:59:19Z
created_by: claude-code
tags: [sync, git, multi-machine]
depends_on: ["0001"]
recommendation:
  option: tell-me
  why: >-
    It is the least code and keeps Sync manual, and on Nov 15 most of Blendeck's 18 trips off
    main lasted under 15 minutes. If waits of hours keep happening (one lasted 9), pick own-repo, where agents' git can't touch answers.
options:
  - id: tell-me
    title: Keep Sync as it is, and say what it waits for
    summary: Before you press Sync, the top bar shows which branch it is waiting on, and when the folder is back on main.
    pros:
      - Least code; git changes nothing until you press Sync
      - Agents on this machine see your answers right away
    cons:
      - Answers still wait while a branch is out
      - You have to come back and press Sync then
  - id: any-branch
    title: Sync commits to main from any branch
    summary: The hub commits and pushes your answers from a hidden copy of the project, then removes them from the folder.
    pros:
      - Answers reach your other machines when you press Sync
    cons:
      - Pushes to main while an agent may be using git in the project
      - Until the agent returns to main and pulls, it and the hub see your answered cards as open
  - id: own-repo
    title: Cards in their own repository, outside the project folder
    summary: Each project's cards move to a private repository next to it (e.g. Blendeck-decisions) that the hub syncs.
    pros:
      - Sync works whenever you press it, whatever branch the code is on
      - Agents' git commands can't touch answers
    cons:
      - A new repository per project, cloned on every machine
      - Cards and the code they decide live in different repositories
withdrawn:
  at: 2026-11-16T03:16:12Z
  reason: "Decided in chat on 2026-11-16: cards will live on the working branch with the work they unblock, so none of these options is needed."
---

## Context

Sync waits while the project folder is on a branch. There your answers aren't lost; they
wait in the folder until it is back on main.
