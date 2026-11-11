---
id: "0022"
title: Should an agent's pull request include your answers on the cards it applies?
status: open
kind: choice
priority: high
created: 2026-11-11T15:58:25Z
created_by: claude (batch-2 writer)
tags: [sync, git, workflow, apply]
depends_on: ["0001", "0006"]
recommendation:
  option: sync-only
  why: >-
    You chose Sync as the way your answers travel (#0001), and sending the same change
    along two roads is what makes them collide. With sync-only each file has one road: your
    card changes go with Sync, the agent's docs and code go in its pull request, and the hub
    shows "applied" as soon as the agent is done. The cost is that the decision and its docs
    reach main separately, and until the Sync button is built someone has to commit your
    answers by hand.
options:
  - id: copy
    title: Yes, the pull request carries copies of your answers
    summary: As in PR 5, the agent copies the cards you answered into its branch exactly as they are, marks them applied there, and its pull request includes them next to the docs it changed.
    pros:
      - The pull request shows the whole story, your decision and then the docs that apply it
      - Once it is merged, main has the decision and its docs together, even if you never press Sync
    cons:
      - Your answers travel twice, in the pull request and with Sync; that only goes through cleanly if both copies are byte for byte the same
      - If you change the card after the agent copied it (you reopen it or decide again), the two copies differ, and Sync stops with a conflict that needs a manual git fix
      - The hub, which reads your main folder, keeps saying "waiting for an agent to apply it" until the pull request is merged and synced, so another agent may apply it again
      - Close to the "agents commit card changes" option you turned down on card 0001
  - id: sync-only
    title: No, your answers travel only with Sync
    summary: The agent reads your decision in the project's main folder, marks it applied there, and its pull request contains only the docs and code it changed; Sync carries the card.
    pros:
      - Every change has one road, so the two can't collide
      - The hub shows "applied" as soon as the agent is done, and no other agent picks it up again
      - Only one new rule for agents, "never commit card files", since they already run president commands in the project's folder
    cons:
      - The pull request doesn't show the decision; it has to link to the card or quote it
      - Main can say "applied" before the docs are merged (and if the pull request is dropped, nothing on the card says so)
      - Until the Sync button exists, your answers reach main only when someone commits them by hand
  - id: sync-first
    title: No, but the agent waits until your answers are synced
    summary: Before applying, the agent checks that your answers are already on main (you pressed Sync); it then starts its branch from there, and its pull request only adds "applied" and the docs and code.
    pros:
      - Your answers have one road (Sync); the pull request only carries the agent's own changes
      - On the branch, the decision and the docs sit together, so reviewers see both
    cons:
      - Applying waits for you to press Sync; a decision you didn't sync stays unapplied
      - Like copy, the hub keeps saying "waiting for an agent to apply it" until the pull request is merged and synced, so another agent may apply it again
      - Reopening the card while the pull request is open can still conflict with its "applied" line
---

## Context

When you decide a card in the hub, the hub rewrites the card file in your project's main folder
(the one registered with president), and the change sits there uncommitted. Agents do
their work on a branch of their own and end it in a pull request (`docs/foundations.md`,
"Engineering process"), often in a separate folder (a git worktree), where your answer isn't
present. This card asks
whether that pull request should include **your** card changes.

**What happened in PR 5.** The agent that applied #0001, #0003, #0004 and #0006 copied your four
answered card files from the main folder into its branch, exactly as they were (commit "Record
the human's answers"), then marked them applied on the branch and opened the pull request with
them. Meanwhile your main folder still has the same answers as uncommitted changes, without
"applied".

**What changed.** You decided #0001 = `sync`: a Sync button commits your card changes and
pulls and pushes them (`docs/roadmap.md`, "Sync", lands with PR 5). So your answers now have
their own way to travel, and copying them into a pull request sends them a second way.

**What goes wrong with two ways:**

- If both copies are byte for byte the same, git notices that the change is already on main and
  Sync goes through, provided the Sync check about "files the remote changed" leaves `decisions/`
  out (PR 5 review, finding D-1, tested in scratch clones; as the roadmap is written today, Sync
  refuses after every such pull request).
- If they differ, because you reopened the card or decided again after the agent copied it,
  both sides changed the same lines, which git reports as a conflict (as card 0001 found when
  testing two notes on the same card). Sync then stops with "Not synced: 0001 changed
  on both machines" (even though only one machine is involved), and fixing it is a manual git
  step.

**How this relates to #0001.** On [#0001](0001-sync-across-machines.md) you turned down
`agents` ("Agents commit card changes as part of their work"). `copy` is a narrower version of
it: only the cards an agent applies, and Sync still exists. It doesn't have `agents`' main
problem (answers that only travel when an agent runs), but it keeps the duplication.

Priority is high because every agent that applies a decision from now on has to do one or the
other, starting with the next one.

## Option copy: Yes, the pull request carries copies of your answers

What PR 5 did:

```
PR "Apply decisions 0001, 0003"
  1. Record the human's answers          decisions/0001-....md, decisions/0003-....md (copied)
  2. Record the decisions                docs/foundations.md, docs/roadmap.md
  3. Mark them as applied                decisions/0001-....md, decisions/0003-....md (applied_at)
```

## Option sync-only: No, your answers travel only with Sync

```
In the project's main folder:   president pending     (reads your answer)
On the agent's branch:          docs/foundations.md, docs/roadmap.md   -> the pull request
In the project's main folder:   president applied decisions/0001-....md --token ...
Later, you press Sync:          your answer + "applied" go to main in one commit
```

The skill gains one line: "Never commit card files in your pull request; Sync carries them."

## Option sync-first: No, but the agent waits until your answers are synced

```
president pending   ->  "0001 is decided but not synced yet. Press Sync in the hub, then run me again."
after Sync:         branch from main (which now has your answer)
the pull request:   docs/foundations.md, docs/roadmap.md, decisions/0001-....md (applied_at only)
```

## Until the Sync button exists

Sync is decided but not built. Under `sync-only` and `sync-first`, until it ships, your answers
reach main only with a manual commit of `decisions/` on main (the step Sync will automate),
which an agent can do for you when you ask. Under `copy` nothing changes until then.

## Sources

- PR 5 (https://github.com/alexandreffaria/president/pull/5), commit `1b2051a` "Record the
  human's answers to 0001, 0003, 0004, 0006" and commit `0eaf508` "Mark 0001, 0003, 0004, 0006
  as applied".
- PR 5 review, finding D-1 (Sync check 3 and `decisions/`, tested in scratch clones) and question
  Q5: https://github.com/alexandreffaria/president/pull/5#issuecomment-6800440795
- Card #0001, options `sync` and `agents`; `docs/roadmap.md` (lands with PR 5), "What Sync runs,
  per project".
- `skills/decision-cards/SKILL.md`: "Run every `president` command from the project root, the
  folder that contains `decisions/`."
- Code: `src/server/registry.ts` (each project is registered by its absolute path), `src/server/cards.ts`
  (`actOnCard` writes the card in that folder), `src/core/pending.ts` (`needsApplying`: a resolved card
  without `applied_at` is listed again).
