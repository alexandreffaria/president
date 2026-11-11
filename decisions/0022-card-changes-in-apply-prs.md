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
    along two roads is what makes them collide: in a test, Sync after a copy pull request
    went through only in a narrow case and stopped with a conflict otherwise. With sync-only
    each file has one road: your card changes go with Sync, the agent's docs and code go in
    its pull request, and the hub shows "applied" as soon as the agent is done. The cost is
    that the decision and its docs reach main separately, and until the Sync button is built
    someone has to commit your answers by hand.
options:
  - id: copy
    title: Yes, the pull request carries copies of your answers
    summary: As in PR 5, the agent copies the cards you answered into its branch exactly as they are, marks them applied there, and its pull request includes them next to the docs it changed.
    pros:
      - The pull request shows the whole story, your decision and then the docs that apply it
      - Once it is merged, main has the decision and its docs together, even if you never press Sync
    cons:
      - Your answers travel twice, in the pull request and with Sync. Sync goes through only if the copies are identical, the pull request wasn't squashed and you changed no other card before syncing; otherwise it stops with a conflict that needs a manual git fix
      - Until Sync exists, a plain git pull in your main folder stops after every such pull request, because of your own uncommitted copies, until someone discards them
      - The hub, which reads your main folder, keeps saying "waiting for an agent to apply it" until the pull request is merged and synced, so another agent may apply it again
      - Agents commit your answers, a job card 0001 gave to Sync, so two different things put your answers into git
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
them. Meanwhile your main folder still had the same answers as uncommitted changes, without
"applied". PR 5 was merged on 2026-11-11, with a merge commit (not squashed), so main now has
the four answers plus "applied". A plain `git pull` in your main folder stops while those
uncommitted copies are there (see "Until the Sync button exists"), so after the merge your main
folder was put straight: the four card files were reset to the merged version (the same
answers, plus "applied") before pulling. Nothing of yours was lost: the four cards in your main
folder are now the same as on main.

**What changed.** You decided #0001 = `sync`: a Sync button commits your card changes and
pulls and pushes them (the roadmap, `docs/roadmap.md`, merged with PR #5, "Sync"). So your
answers now have their own way to travel, and copying them into a pull request sends them a
second way.

**What goes wrong with two ways** (tested with git 2.56.0: the roadmap's Sync commands, run
after a pull request like PR 5's was merged):

- Even when both copies are byte for byte the same, Sync only goes through if the pull request
  was merged without squashing **and** your Sync commit holds exactly the cards the agent
  copied: git then sees your commit is already on main and skips it. Usually you have also
  answered or noted other cards since, so your commit is different, git merges the card line
  by line, and your answer and the agent's "applied" line next to it conflict: Sync stops with
  "Not synced: 0001 changed on both machines". A squashed pull request conflicts the same way,
  even when your commit holds only the copied card.
- If the copies differ, because you reopened the card or decided again after the agent copied
  it, both sides changed the same lines, which also conflicts.

Sync makes one commit per sitting, with every card you changed since the last Sync, so under
`copy` most Syncs after an apply pull request would stop like this (even though only one
machine is involved), and fixing it is a manual git step.

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
which an agent can do for you when you ask. Under `copy`, once the agent's pull request is
merged, `git pull` in your main folder stops ("your local changes would be overwritten")
because of your own uncommitted copies of those cards, until they are discarded (main already
has them) and you pull again.

## Sources

- PR 5 (https://github.com/alexandreffaria/president/pull/5), commit `1b2051a` "Record the
  human's answers to 0001, 0003, 0004, 0006", commit `0eaf508` "Mark 0001, 0003, 0004, 0006
  as applied", and merge commit `b2cb309` on main (merged 2026-11-11T16:05:08Z, not squashed).
- Scratch test with git 2.56.0: a bare repository and two clones. The agent's clone commits a
  byte-identical copy of the human's answer to a card, then a docs change, then `applied_at`,
  and pushes to main, once as separate commits and once squashed into one. The human's clone
  then runs Sync's commands (`git add -- decisions/`, `git commit --only -- decisions/`,
  `git pull --rebase --autostash`). Not squashed, only the copied card in the commit: the pull
  goes through. Not squashed, a second card answered too: conflict on the copied card.
  Squashed, only the copied card: conflict. Card decided again before syncing: conflict.
- Second scratch test, same setup: with the copy still uncommitted in the human's clone, a plain
  `git pull` after the merge prints "error: Your local changes to the following files would be
  overwritten by merge: decisions/a.md ... Aborting".
- PR 5 review, finding D-1 (Sync check 3 and `decisions/`, tested in scratch clones) and question
  Q5: https://github.com/alexandreffaria/president/pull/5#issuecomment-6800440795
- Card #0001, options `sync` and `agents`; `docs/roadmap.md` (on main since PR #5), "What Sync
  runs, per project" (check 3 looks only at files outside `decisions/`).
- `skills/decision-cards/SKILL.md`: "Run every `president` command from the project root, the
  folder that contains `decisions/`."
- Code: `src/server/registry.ts` (each project is registered by its absolute path), `src/server/cards.ts`
  (`actOnCard` writes the card in that folder), `src/core/pending.ts` (`needsApplying`: a resolved card
  without `applied_at` is listed again).
