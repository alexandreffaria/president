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
  option: reviewed-main
  why: >-
    Review has changed most new cards before you saw them: 12 of 17 in batch 1 over four
    rounds and all 6 in batch 2 over two, including four findings marked blocking (wrong
    or one-sided facts that tilted the choice) that you would otherwise have decided from.
    reviewed-main and split both keep that review for new cards, and both check rewrites
    against the card you actually have. reviewed-main shows a card as soon as its review is
    done, with no merge to wait for and no Sync before your hub has it, and gives card files
    one road, as you chose for your answers in 0022. What it gives up is the gate: the
    writing agent runs its own review and decides when it is done, and nothing shows whether
    it ran, while under split and pr a card reaches you only through a merged pull request
    that carries the review. That trade is worth it if you want cards the moment they are
    reviewed and trust agents to follow the skill. Pick split if you'd rather wait for a
    merge and your next Sync than rely on that, pr if you also want rewrites in a pull
    request, and main-folder only if seeing a card the moment it is written is worth getting
    errors like those.
options:
  - id: pr
    title: Everything through a pull request
    summary: New cards and rewrites go on the agent's branch, are reviewed and checked by CI in a pull request, and reach the hub once it is merged and pulled into the main folder.
    pros:
      - A fresh session reviews every card before you see it, and CI checks that it is valid
      - The review stays on the pull request for you to read, and the merge shows it was done
      - One rule for everything an agent writes, cards included
    cons:
      - You don't see a new card until its pull request is merged and the main folder is pulled; a card written in the middle of a feature waits for the whole feature, unless the agent opens a separate pull request for it, as this batch did
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
      - No review before you read a card; in batches 1 and 2, review changed 12 of 17 and 6 of 6 cards before you saw them, over 4 and 2 rounds, and what it caught would have reached you as written
      - CI checks the cards only after they are synced to main (the hub and president pending still flag a broken card at once)
      - Until the Sync button exists, new cards reach git only when someone commits decisions/ in the main folder by hand
  - id: reviewed-main
    title: Reviewed in the agent's folder, then into the main folder
    summary: New cards are reviewed by a fresh session and validated in the agent's worktree, then written into the main folder; rewrites go straight to the main folder with president update.
    pros:
      - New cards keep the review that changed most cards in batches 1 and 2
      - No merge or pull to wait for; a card reaches you as soon as it passes review
      - No pull conflicts, since no pull request ever carries card files
      - Rewrites are checked against the card you have, so the guard sees your notes
    cons:
      - The writing agent runs the review and decides when it is done, and nothing shows whether it ran; an agent in a hurry can skip it and the card looks the same. Under pr and split a card can't reach you without a merged pull request that carries the review
      - Two rules for agents, as in split (new cards are reviewed in the worktree and then copied; rewrites go straight into the main folder), and more steps for each new card
      - CI checks the cards only after they are synced to main, as in main-folder
      - Rewrites (new options after "neither", withdrawing a card) reach you unreviewed, as in main-folder and split
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
      - Rewrites (new options after "neither", withdrawing a card) reach you unreviewed, as in main-folder and reviewed-main
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

**What review has changed so far.** In both earlier batches a fresh session reviewed the cards
in the pull request, the writing agent fixed what it found, and each later round reviewed
those fixes:

- **Batch 1** ([PR #3](https://github.com/alexandreffaria/president/pull/3), cards 0001 to
  0017): four review rounds. Round 1 had 19 findings (C-1 to C-19), two of them blocking: a
  wrong main fact on 0016 (what `npx president` does) and a one-sided recommended option on
  0001. Round 2 had C2-1 to C2-7 (C2-1 blocking: card 0001's Sync sketch would have pushed
  conflict markers), round 3 had C3-1 to C3-5 and round 4 had C4-1 to C4-5; rounds 3 and 4
  both had should-fix items on 0001. Review changed 12 of the 17 cards, and one
  recommendation (0014, from `status` to `field`).
- **Batch 2** ([PR #6](https://github.com/alexandreffaria/president/pull/6), cards 0018 to
  0023): two rounds. Round 1 had B-1 to B-15 (B-1 blocking: a git fact on 0022 that was
  wrong), round 2 had B2-1 to B2-5. Review changed all 6 cards, split a second question out
  of 0019 into the new card 0024, and changed one recommendation (0018, from `claude-store`
  to `hub-copy`).
- **Batch 3** (this one, PR #11): the first round found 7 should-fix items and 5 nits (G-1
  to G-12). One of them added the `reviewed-main` option to this card.

So under `main-folder`, most cards would have reached you before those fixes. The review
itself doesn't need a pull request: `reviewed-main` runs it in the agent's own folder.

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
       You see it only after its pull request (the feature's, or a separate one with only the card) is reviewed, merged and pulled.
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

## Option reviewed-main: Reviewed in the agent's folder, then into the main folder

```
10:00  The agent writes the new card in its worktree and runs president validate there.
       A fresh session reviews it; the agent fixes what it finds (a missing option, a wrong
       fact) and has it reviewed again until nothing should-fix is left.
10:10  As in main-folder: the rewrite of #0031 is made in the main folder, guarded.
10:20  The agent copies the reviewed card into the main folder's decisions/ and validates
       it there. It is in your queue now. The feature's pull request has no card files.
Later  You press Sync: your note, the new card and the new options go to main in one commit.
```

## Option split: New cards by pull request, rewrites in the main folder

```
10:00  The agent opens a small pull request with only the new card (or adds it to its
       feature's pull request and you see it when that is merged). Reviewed, merged, pulled.
10:10  As in main-folder: the rewrite of #0031 is made in the main folder, guarded.
```

## Technical detail (for the implementer)

- Under `main-folder`, `reviewed-main` and `split`, the skill's rule for rewrites is the one
  build step A already adds for applying: run `president` commands in the main folder, never
  in a worktree.
- Under `main-folder`, the skill's "Writing a card" says to write the file in the main
  folder's `decisions/` even when the agent works in a worktree, and to run
  `president validate <file>` there.
- Under `reviewed-main`, "Writing a card" says: write the card in the worktree's `decisions/`
  without committing it, run `president validate <file>`, have a fresh session review it (as
  the reviews of PR #3 and PR #6 did) and fix and re-review until nothing should-fix is left,
  then copy it into the main folder's `decisions/`, validate it there and delete the worktree
  copy, so the feature branch never commits it. An optional bookkeeping field (unknown fields
  are kept), such as `reviewed: 2 rounds`, would show that a review ran, but nothing checks
  it. 0022's line reads literally, as under `main-folder`.
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
- PR #3 and PR #6 (batches 1 and 2, delivered by pull request and reviewed): their review and
  fix comments (`gh pr view 3 --comments`, `gh pr view 6 --comments`) for the finding ids and
  rounds, and `git diff --stat` from each batch's first card commit (`75f4ae2`, `3b0a520`) to
  its last (`16ba94c`, `002ba7d`) for the cards changed: 12 of 17 in batch 1; all 6, plus the
  new 0024, in batch 2.
