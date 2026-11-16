---
id: "20261116notj"
title: Should you be able to see or answer a branch's cards from your other machines?
status: resolved
kind: choice
priority: normal
created: 2026-11-16T03:21:36Z
created_by: claude-code
tags: [multi-machine, git, scope]
depends_on: []
recommendation:
  option: here-only
  why: >-
    The agent waiting on the answer is on that same machine, so answering there unblocks it
    at once, with no new git work. Pick show-elsewhere or answer-anywhere if you often leave a
    machine while its agents still have cards waiting.
options:
  - id: here-only
    title: Answer on the machine that has the branch
    summary: Each hub shows only its own checkouts' cards.
    pros:
      - "Nothing new to build: no fetching or pushing of agents' branches"
      - Every card you see, you can answer
    cons:
      - Away from that machine, you don't see its waiting cards at all
  - id: show-elsewhere
    title: Show them elsewhere, answer on that machine
    summary: Your other hubs also list the open cards on pushed branches, marked "answer on the machine that has branch X".
    pros:
      - You see everything that waits on you, from any machine
      - Never pushes to an agent's branch
    cons:
      - Cards appear late, or never, if the agent hasn't pushed
      - You still go back to that machine to answer
  - id: answer-anywhere
    title: Answer them from any machine
    summary: Your other hubs list cards on pushed branches, and your answer is committed and pushed onto the agent's branch.
    pros:
      - Answer wherever you are
    cons:
      - The most to build, and the hub's push can collide with the agent's
      - Works only after the agent pushes, and the agent must pull to see your answer
resolution:
  choice: here-only
  resolved_at: 2026-11-16T04:12:48Z
---

## Context

A card lives on its branch, in the checkout of the machine doing that work. Other
machines could see it only if the agent pushed the branch.
