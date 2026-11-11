---
id: "20261111st0c"
title: Should agents deliver new cards and card rewrites in a pull request, or write them straight into the main folder?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:15Z
created_by: claude (batch-3 writer)
tags: [agent-rules, sync, git, workflow]
depends_on: ["0022", "0001", "0014", "0007"]
recommendation:
  option: main-folder
  why: >-
    It gives every card file one road, as you chose for your answers in 0022: cards reach
    you the moment an agent writes them, and a rewrite is checked against the card you
    actually have, notes included. What it costs is the review a fresh session does today
    before you read a batch. Pick split if that review matters more to you than seeing new
    cards at once, for example for big batches like this one; pick pr only if you want
    every agent change reviewed, rewrites included.
options:
  - id: pr
    title: Everything through a pull request
    summary: New cards and rewrites go on the agent's branch, are reviewed and checked by CI in a pull request, and reach the hub once it is merged and pulled into the main folder.
    pros:
      - A fresh session reviews every card before you see it, and CI checks that it is valid
      - One rule for everything an agent writes, cards included
    cons:
      - You don't see a new card until its pull request is merged and the main folder is pulled; a card written in the middle of a feature waits for the whole feature
      - A rewrite made on a branch is checked against the branch's copy of the card, which lacks your uncommitted notes, so the guard that protects your notes doesn't see them
      - When such a rewrite is merged while you have an unsynced note on that card, pulling the main folder stops until your note is committed or set aside, the problem 0022 avoided for answers
  - id: main-folder
    title: Straight into the main folder, carried by Sync
    summary: Agents write new cards and run president update in the project's main folder; the hub shows them at once, and Sync (or a hand commit until Sync exists) puts them in git.
    pros:
      - New cards and new options reach you the moment they are written
      - A rewrite is checked against the card you have, so a note you just added is never lost
      - Every card file has one road, the same rule 0022 gave your answers, and the skill line "Never commit card files in your pull request" reads literally
    cons:
      - No review before you read a card; a weak option or a wrong fact reaches you as the agent wrote it
      - CI checks the cards only after they are synced to main (the hub and president pending still flag a broken card at once)
      - Until the Sync button exists, new cards reach git only when someone commits decisions/ in the main folder by hand
  - id: split
    title: New cards by pull request, rewrites in the main folder
    summary: Brand-new cards go through a reviewed pull request as today; changes to existing cards (new options, withdrawing a card) are made with president update in the main folder.
    pros:
      - New cards keep the review and the CI check
      - Rewrites go through the guard against your real card and reach you at once
      - Merging a pull request of new files never collides with your unsynced answers, which are in other files
    cons:
      - Two rules for agents to remember, depending on whether the card exists yet
      - New cards still wait for a merge and a pull before you see them, and a card written during a feature waits for that feature unless the agent opens a separate pull request for it
---

## Context

**What 0022 decided and what it left open.** On
[0022](0022-card-changes-in-apply-prs.md) you chose `sync-only`: an agent that applies a
decision reads it and marks it applied in the project's **main folder** (the one registered
with president), and its pull request carries only docs and code. Its skill line is "Never
commit card files in your pull request; Sync carries them." That card weighed only your
answers and "applied". Read literally, the line also covers the other card changes agents
make:

- **new cards**, like this batch and the two before it (PR #3, PR #6);
- **rewrites with `president update`**: new options after you say "neither" when the hub's
  own run fails ([0007](0007-neither-try-again.md)), and adding or removing `withdrawn`
  ([0014](0014-withdrawn-status.md)).

The roadmap's build step A ships the line as written plus the main-folder rule and waits for
this card to narrow it (`docs/roadmap.md`, "A. Agent rules", and "Needs a card", item 1).

**This batch was delivered the old way.** Until you answer this card, agents keep today's
flow for new cards: these 13 cards were written on a branch (`cards/batch-3`) and sent as a
pull request, where CI ran `president validate`. They reach your hub once it is merged and the
main folder is pulled.

**Why it matters.**

- **Where the hub looks.** The hub reads only the registered folder
  (`src/server/registry.ts` keeps each project's absolute path). A card on an unmerged branch,
  or in a worktree, is invisible to you.
- **What the rewrite guard compares.** `president update` replaces a card only if `status`,
  `resolution`, `feedback`, `seen_at` and `applied_at` are the same in the agent's version as
  in the card file it is given (`HUMAN_FIELDS` in `src/cli/commands.ts`). Run in a worktree,
  that file is the branch's copy, which never has your uncommitted notes, so the guard can't
  see them.
- **What Sync expects.** Sync's step 4 is `git add -- decisions/` before committing, because
  "`git commit --only -- decisions/` alone silently leaves out cards git doesn't track yet (new
  cards an agent just wrote)" (`docs/roadmap.md`, "What Sync runs"). It is built to carry new
  cards written into the main folder.

Example used below: an agent working on a feature in a worktree needs your call on the empty
state's wording, and writes a card at 10:00. At 10:05 you add a note to an older card,
#0031; at 10:10 the hub's new-options run for #0031 fails, so the project's agent rewrites
its options.

## Option pr: Everything through a pull request

```
10:00  The new card is committed on the feature branch.
       You see it only after the feature's pull request is reviewed, merged and pulled.
10:10  The agent rewrites #0031 on its branch; update compares it with the branch's #0031,
       which has no 10:05 note, and accepts it. The pull request is reviewed and merged.
Later  git pull in the main folder stops: "Your local changes to ... 0031 ... would be
       overwritten", because your 10:05 note is still uncommitted there.
```

## Option main-folder: Straight into the main folder, carried by Sync

```
10:00  The agent writes decisions/20261111k7q2-empty-state.md in the main folder.
       It is in your queue at once. The feature's pull request has no card files.
10:10  The agent runs president update on the main folder's #0031. The guard sees your
       10:05 note and refuses; the agent reads the note and writes its version again.
Later  You press Sync: your note, the new card and the new options go to main in one commit.
```

## Option split: New cards by pull request, rewrites in the main folder

```
10:00  The agent opens a small pull request with only the new card (or adds it to its
       feature's pull request and you see it when that is merged). Reviewed, merged, pulled.
10:10  As in main-folder: the rewrite of #0031 is made in the main folder, guarded.
```

## Technical detail (for the implementer)

- Under `main-folder` and `split`, the skill's rule for rewrites is the one build step A
  already adds for applying: run `president` commands in the main folder, never in a
  worktree.
- Under `main-folder`, the skill's "Writing a card" says to write the file in the main
  folder's `decisions/` even when the agent works in a worktree, and to run
  `president validate <file>` there.
- Under `pr` and `split`, the line from 0022 is narrowed to "your answers and `applied`
  marks", and new cards stay in the pull request.
- Under every option, a card the hub's own run rewrites (0007) is written by the hub in the
  main folder; this card is only about cards agents write.

## Sources

- Card [0022](0022-card-changes-in-apply-prs.md), option `sync-only` and its skill line;
  `docs/roadmap.md`, "A. Agent rules: the skill line for #0022" ("Not decided: whether the
  line also covers card changes an agent makes outside an apply") and "Needs a card", item 1.
- `docs/roadmap.md`, "What Sync runs, per project", step 4.
- Code: `src/server/registry.ts` (projects registered by absolute path), `src/cli/commands.ts`
  (`HUMAN_FIELDS` and `update`'s guard; `pending` lists broken cards),
  `.github/workflows/ci.yml` (runs `node bin/president.js validate .` on pull requests and on
  pushes to main).
- Card [0022](0022-card-changes-in-apply-prs.md), context: a plain `git pull` in the main
  folder stops when it brings in a change to a card that has uncommitted changes there
  (scratch test quoted in that card).
- PR #3 and PR #6 (batches 1 and 2, delivered by pull request and reviewed).
