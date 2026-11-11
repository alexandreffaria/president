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
    A Sync action gives you one commit per sitting instead of one per click and changes your
    checkouts only when you press it (starting the hub only fetches), so you can avoid syncing
    while an agent is working. With the checks in its sketch it says "not now" rather than
    rebase an agent's unpushed work or put conflict markers in its files (its other uncommitted
    files are only set aside while the pull runs), and it does so while you are looking. Pick
    batched if you would rather not have to remember and accept git running in your projects
    at moments nobody chose (it retries by itself when a check says not now); pick auto if
    your projects' checkouts are almost always on main with no agent working in them.
options:
  - id: auto
    title: The hub commits and pushes after every action
    summary: After each decide, note, defer, neither, reopen or undo, the hub adds and commits that one card file and pushes in the background.
    pros:
      - Nothing to remember; a git pull on the other machine always has your latest answers
      - Each commit holds exactly one action, so history reads like a log of your decisions
    cons:
      - One commit per click (a 20-card session is 20 commits, plus one per undo)
      - Commits land on whatever branch the project's checkout is on, possibly an agent's feature branch, in the middle of its work
      - Git runs behind the agent's back, so it can collide with the agent's own git commands
      - A push that fails (offline, or the other machine pushed first) needs a pull and maybe a conflict fix with nobody watching
      - Pushing also sends out any commits an agent hasn't pushed yet, unless the hub skips the push while there are any (and your answers then wait)
  - id: sync
    title: A Sync button and shortcut in the hub
    summary: The hub writes files as now; a Sync button (and key) per project checks the checkout, commits the changed and new card files in one commit, pulls and pushes; when the hub starts it only fetches and shows how many card changes are waiting.
    pros:
      - One commit per sitting (for example "decisions from laptop, 0003 0005 0009")
      - Git changes your checkouts only when you press Sync (starting the hub only fetches), so the hub can first check the branch and the agent's unpushed and uncommitted work, and say "not now" if needed
      - Conflicts show up at one moment, in one place, while you are looking
    cons:
      - You have to remember to press it before you leave a machine; forget once and the answers stay behind
      - Still a new piece of git code in the hub (checks, commit, pull, push, conflict reporting)
      - While an agent has commits it hasn't pushed, or is editing a file that also changed on your other machine, Sync says "not now" and changes nothing, so your answers can wait until the agent pushes
      - If an agent saves a file during the few seconds the pull takes, Sync stops without pushing and tells you, and leaves an old copy of that file in git's stash that someone has to clear (seen in a simulated test)
      - It refuses while the checkout is on any other branch, so if an agent has a feature branch checked out in that folder, your answers wait until it switches back
  - id: batched
    title: The hub syncs on its own after a quiet spell
    summary: Like sync, but run by a timer; a few minutes after your last action (and when you stop the hub), the hub pulls, commits the changed and new card files in one commit and pushes.
    pros:
      - Nothing to remember, like auto
      - One commit per sitting, like sync
      - When sync's checks say "not now" (an agent has unpushed work), it simply tries again later
    cons:
      - Git runs at moments nobody chose, so it can collide with an agent's own git commands, and Sync's rare leftover (an old copy in git's stash) can happen with nobody watching
      - Like sync, it waits while the checkout is on another branch, and nobody is told until someone looks at the hub
      - A pull that conflicts or a push that fails is found later, by whoever next looks at the hub
      - Answers made just before the machine sleeps (a closed laptop lid) stay behind until it wakes and the timer fires
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

**What happens today.** No git code exists in president at all (`grep -rn git src/` finds no git
commands, only comments and one warning that mentions git). When you act on a card, the hub
rewrites that one file in place: `actOnCard` in `src/server/cards.ts` applies the action from `src/core/actions.ts`, then writes
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
git add -- decisions/0007-api-errors.md
git commit --only -m "decisions: resolve 0007 (use result objects)" -- decisions/0007-api-errors.md
git push    # in the background; on failure the hub shows "not pushed" on the card
```

`git add` comes first because a card an agent has just written is usually not tracked by git
yet, and `git commit --only` refuses a file git doesn't know (`pathspec ... did not match any
file(s) known to git`). `--only` then commits just that file, leaving anything you or an agent
staged untouched. Undo would need a second commit (or a reset if it wasn't pushed yet). The
commit lands on whatever branch is checked out in that folder.

## Option sync: A Sync button and shortcut in the hub

The top bar gets **Sync** (for example the `S` key). For each project with card changes, here
or on the other machine, pressing it:

1. checks that it is safe to touch the checkout, and if not, changes nothing and says why
   ("Not now: an agent in shop has commits it hasn't pushed");
2. commits all your card changes in one commit ("decisions from laptop: 0003, 0005, 0009");
3. pulls the other machine's changes, then pushes.

If the same card changed on both machines, Sync puts everything back as it was, keeps your
answers in a local commit and says "Not synced: 0001 changed on both machines". Fixing that
is a manual git step, as today.

The top bar shows "3 answers not synced", so leaving without syncing is visible. When the hub
starts it only fetches, which changes no file and no branch, and shows "3 card changes on the
remote, press Sync".

The git commands, and what each check protects against, are under **How Sync works in git**,
after the options.

## Option batched: The hub syncs on its own after a quiet spell

The same commands as Sync, run by the hub when you have done nothing for, say, 5 minutes, and
once more when you stop the hub. When a check says "not now", it tries again at the next quiet
spell. The top bar shows "Syncing in 4 min" and, after a failure, "Not synced: the pull
conflicted in shop". It sits between auto (git at every click) and sync
(git when you press it).

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

## How Sync works in git

For each project, Sync runs:

```sh
git fetch
# checks; if one fails, stop here, change nothing and say why:
#  - the project's main branch (the remote's default, usually main) is checked out, and no rebase or merge is in progress
#  - git log @{u}..HEAD shows no unpushed commit that changes files outside decisions/
#  - no file the remote changed (git diff --name-only HEAD...@{u}) has uncommitted edits here
git add -- decisions/
git commit --only -m "decisions from laptop: 0003, 0005, 0009" -- decisions/    # skipped when there is nothing new to commit
git pull --rebase --autostash    # if it fails: git rebase --abort if a rebase is in progress, and don't push
# before pushing: stop if any file is conflicted or git stash list has a new entry
git push
```

`git add -- decisions/` brings in new cards: `git commit --only -- decisions/` on its own commits
changes to cards git already tracks and silently leaves new ones out (tested in a scratch
repository), so an answer on a card that was never committed would never sync.

Each step is there because of something tested in scratch repositories (git 2.56.0):

- **Commit before pulling.** If your answers were still uncommitted, `--autostash` would set
  them aside with everything else, and a card also changed on the remote can conflict when
  they are put back. Git then exits 0 and leaves the card with `<<<<<<<` markers, so a commit
  and push after it would publish the markers. Committed first, the same conflict stops the
  rebase with an error. The hub then runs `git rebase --abort`, which puts the checkout back as
  it was, other uncommitted files included, keeps your answers in a local commit, and shows
  "Not synced: 0001 changed on both machines". Fixing that is a manual git step, as today;
  pressing Sync again retries.
- **No unpushed code commits.** Otherwise the pull would rebase an agent's unpushed commits and
  `git push` would publish them. And if such a rebase stops on a conflict, the agent's
  uncommitted files show their last committed content until someone finishes or aborts it.
- **No uncommitted edits to files the remote changed.** `--autostash` sets the checkout's other
  uncommitted changes aside for the pull and puts them back once it finishes. If the remote
  changed the same lines of one of those files, putting it back conflicts: git still exits 0, the agent's file
  gets conflict markers, and an `autostash` entry stays in `git stash list`.
- **Look before pushing.** Even with the checks, an agent that writes one of its files while
  the pull has it set aside makes git keep the older copy in `git stash list` ("could not apply
  autostash; your changes are safe in the stash"), again with exit 0 (simulated with a git
  hook that writes the file at that moment). So the hub looks for
  conflicted files and new stash entries, and stops without pushing if there are any.

A stricter check, refusing whenever files outside `decisions/` have any uncommitted changes,
would make `--autostash` unnecessary, at the cost of Sync refusing whenever an agent has work in
progress.

## Sources

- Git, `git commit --only`: "Make a commit by taking the updated working tree contents of the
  paths specified on the command line, disregarding any contents that have been staged for other
  paths." https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---only
- Git, `git pull --autostash`: "Automatically create a temporary stash entry before the operation
  begins, record it in the ref `MERGE_AUTOSTASH` and apply it after the operation ends. This
  means that you can run the operation on a dirty worktree. However, use with care: the final
  stash application after a successful merge might result in non-trivial conflicts."
  https://git-scm.com/docs/git-pull#Documentation/git-pull.txt---autostash
- Git, `git rebase --abort`: "Abort the rebase operation and reset HEAD to the original branch."
  https://git-scm.com/docs/git-rebase#Documentation/git-rebase.txt---abort
- Code: `src/server/cards.ts` (`actOnCard`, `undoLastAction`), `src/core/actions.ts`,
  `src/cli/commands.ts`, `src/web/views/CardView.tsx`, `skills/decision-cards/SKILL.md`.
