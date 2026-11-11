---
id: "0001"
title: Who should commit and push your answers so they reach your other machines?
status: open
kind: choice
priority: high
created: 2026-11-11T13:22:01Z
created_by: claude (batch-1 writer)
tags: [sync, git, multi-machine]
depends_on: []
recommendation:
  option: sync
  why: >-
    A Sync action gives you one commit per sitting instead of one per click, runs git only
    when you ask (so it never collides with an agent's git work), and gives conflicts one
    place to show up. Pick auto instead if your projects' checkouts are almost always on
    main with no agent committing in them, and you want zero extra steps.
options:
  - id: auto
    title: The hub commits and pushes after every action
    summary: After each decide, note, defer, neither, reopen or undo, the hub commits that one card file and pushes in the background.
    pros:
      - Nothing to remember; a git pull on the other machine always has your latest answers
      - Each commit holds exactly one action, so history reads like a log of your decisions
    cons:
      - One commit per click (a 20-card session is 20 commits, plus one per undo)
      - Commits land on whatever branch the project's checkout is on, possibly an agent's feature branch, in the middle of its work
      - Git runs behind the agent's back, so the two can collide on .git/index.lock or a rebase in progress
      - A push that fails (offline, remote ahead) needs a pull and maybe a conflict fix with nobody watching
  - id: sync
    title: A Sync button and shortcut in the hub
    summary: The hub writes files as now; a Sync button (and key) per project pulls, commits the changed card files in one commit and pushes, and the hub pulls once when it starts.
    pros:
      - One commit per sitting (for example "decisions from laptop, 0003 0005 0009")
      - Git runs only when you ask, so the hub can first check that the checkout is clean enough and on the expected branch, and say so if not
      - Conflicts show up at one moment, in one place, while you are looking
    cons:
      - You have to remember to press it before you leave a machine; forget once and the answers stay behind
      - Still a new piece of git code in the hub (pull, commit, push, conflict reporting)
  - id: agents
    title: Agents commit card changes as part of their work
    summary: The skill tells agents to commit decisions/ along with their docs and code whenever they act through pending, applied, seen or update; the hub never runs git.
    pros:
      - No git code in the hub at all; agents already commit and push
      - The decision and the docs change that applies it travel in the same commit
    cons:
      - Your answers only travel once an agent has run on that machine and pushed; a decision you make at night on the laptop isn't on the desktop in the morning
      - Agents commit on their own branches, so your answers can sit on a branch until it is merged
      - Notes and deferrals that no agent acts on may never be committed
  - id: manual
    title: Leave it manual
    summary: Keep today's behaviour and document the habit (git add decisions && git commit && git push) in the README.
    pros:
      - No code, no surprises; you choose every commit
      - Works with any git workflow, including ones president knows nothing about
    cons:
      - Easy to forget, and the failure is silent (the other machine just shows the old card)
      - Each project needs its own commit, from the right folder
---

## Context

You work on several machines and want `git pull` to bring both the cards and **your answers**
everywhere. Cards are already plain files in each project's git repository, so the question
is only who runs `git commit` and `git push` for the changes you make in the hub.

**What happens today.** No git code exists in president at all (`grep -rn git src/` finds only
comments). When you act on a card, the hub rewrites that one file in place:
`actOnCard` in `src/server/cards.ts` applies the action from `src/core/actions.ts`, then writes
the file atomically (temp file plus rename). The change then sits as an uncommitted
modification in the project's working tree. Agents also write card files: new cards directly,
and existing ones through `president update`, `applied` and `seen` (`src/cli/commands.ts`). The
skill (`skills/decision-cards/SKILL.md`) never mentions committing. The registry is per machine
(`~/.config/president/projects/<name>.json`, holding each project's absolute path), so each
machine registers its own checkouts.

**What can go wrong, whoever commits:**

- **Conflicts.** The hub adds a note by appending an entry to the end of `feedback:`. I tested
  two machines each adding a note to the same card and merging: git conflicts on those lines, the
  file gets `<<<<<<<` markers, and `president validate` reports it as broken
  (`YAML error on line 17: Implicit keys need to be on a single line`). The hub then shows it under
  "Broken cards" until someone fixes it by hand. Edits on different lines of the same card (say,
  a decision here and an agent's `applied_at` there) may merge cleanly.
- **The hub and an agent writing the same card.** On one machine this is already safe: every
  action sends the revision you read and is refused if the file changed (`actOnCard`), and
  `president update` refuses if you changed the card since the agent read it. Across machines,
  git is the only thing that merges. After a `git pull` brings in your own answers from another
  machine, a card you have open says "An agent changed this card while you had it open", because
  this hub didn't write it (`src/web/views/CardView.tsx`).
- **Branches.** An agent may have a feature branch or a worktree checked out in the project. Card
  changes made there (by you or the agent) only reach main when that branch is merged. This very
  batch of cards was written on the `cards/batch-1` branch for that reason.
- **Commit noise.** The repo history is shared with the code. Every card action that becomes a
  commit shows up in `git log` next to real work.

Card #0003 (where the per-card chat is stored) depends on this
answer: if conversations are git-tracked, whatever commits your actions also commits them.

## Option auto: The hub commits and pushes after every action

After each successful write, in the project folder:

```sh
git commit --only -m "decisions: resolve 0007 (use result objects)" -- decisions/0007-api-errors.md
git push    # in the background; on failure the hub shows "not pushed" on the card
```

`--only` commits just that file, leaving anything you or an agent staged untouched. Undo would
need a second commit (or a reset if it wasn't pushed yet). The commit lands on whatever branch is
checked out in that folder.

## Option sync: A Sync button and shortcut in the hub

The top bar gets **Sync** (for example the `S` key) that, for each project with changed card
files:

```sh
git pull --rebase --autostash
git commit --only -m "decisions from laptop: 0003, 0005, 0009" -- decisions/
git push
```

Before it runs, the hub checks the branch and that no rebase or merge is in progress, and shows
what it will commit. If the pull conflicts on a card, it stops, leaves the conflict for you, and
the card shows as broken with the conflicted lines. The top bar shows "3 answers not synced" so
leaving without syncing is visible. The hub also pulls once when it starts.

## Option agents: Agents commit card changes as part of their work

The skill gains one step under "Applying resolved cards" and the other handlers:

> Commit the card files you changed or that the human changed (`git add decisions/`) in the same
> commit as the docs and code change, and push when you push your work.

The hub stays git-free. Your notes and decisions travel with the next agent commit on that machine.

## Option manual: Leave it manual

A README section:

```sh
# before leaving a machine
git -C ~/projects/my-app add decisions && git -C ~/projects/my-app commit -m "decisions" && git -C ~/projects/my-app push
```

## Sources

- Git, `git commit --only`: "Make a commit by taking the updated working tree contents of the
  paths specified on the command line, disregarding any contents that have been staged for other
  paths." https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---only
- Git, `git pull --autostash`: "Automatically create a temporary stash entry before the operation
  begins, record it in the ref `MERGE_AUTOSTASH` and apply it after the operation ends. This
  means that you can run the operation on a dirty worktree. However, use with care: the final
  stash application after a successful merge might result in non-trivial conflicts."
  https://git-scm.com/docs/git-pull#Documentation/git-pull.txt---autostash
- Code: `src/server/cards.ts` (`actOnCard`, `undoLastAction`), `src/core/actions.ts`,
  `src/cli/commands.ts`, `src/web/views/CardView.tsx`, `skills/decision-cards/SKILL.md`.
