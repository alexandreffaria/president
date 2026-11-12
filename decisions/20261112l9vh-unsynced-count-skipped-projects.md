---
id: "20261112l9vh"
title: Should the top bar count unsynced answers in a project that Sync skips?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T02:18:05Z
created_by: claude (batch-4 writer)
tags: [sync, ux]
depends_on: ["2026111209dq", "0001"]
recommendation:
  option: count-apart
  why: >-
    The count exists so that leaving a machine with answers that haven't moved is visible,
    and a skipped project is the one place where nothing else will move them: Sync won't,
    so only a hand commit will, and only if you remember to ask for it. count-apart keeps
    that reminder in view without mixing it into the number that pressing Sync clears. Today
    no registered project is skipped, so it shows nothing until you register one. Pick
    on-press if you want the top bar to show only what Sync can fix, and leave-out if you
    don't expect to register a project inside a bigger repository.
options:
  - id: leave-out
    title: Leave them out, as pull request 12 does
    summary: The top bar counts only projects Sync works on; a skipped project shows no count anywhere, and pressing Sync says only that it is skipped.
    pros:
      - Nothing to build
      - Everything the top bar shows is something pressing Sync takes care of
    cons:
      - Nothing reminds you that a skipped project's answers are still only on this machine; you find out on the other machine, when they aren't there
      - The top bar can read as if everything is synced when it isn't
  - id: count-apart
    title: Count them, on a line of their own
    summary: 'The top bar adds, per skipped project, a line such as "web: 2 answers not synced (Sync skips it)"; the number on the Sync button still counts only what Sync can move.'
    pros:
      - You see, before leaving the machine, that a project's answers need a hand commit
      - The Sync button's number keeps meaning "what pressing Sync will send or bring in"
    cons:
      - A line that pressing Sync never clears; it stays until someone commits that project's decisions folder and pushes it
      - Slightly more to build (the count for a project inside a bigger repository, one more line in the top bar)
      - If you keep a skipped project on one machine only and never move its answers, the line is always there
  - id: on-press
    title: Count them only when you press Sync
    summary: The top bar stays as it is; pressing Sync adds the number to the "skipped" sentence, for example "web is skipped because it isn't the top folder of a git repository. 2 answers there are not committed; commit web/decisions/ in /home/you/shop by hand to move them."
    pros:
      - The top bar shows only what Sync can fix, with no line that never goes away
      - You still see the number at the moment you are most likely to be leaving the machine, when you press Sync
    cons:
      - You only see it if you press Sync; if your other projects are all synced, nothing invites you to
      - The sentence disappears once you dismiss the Sync report, so the reminder is gone until the next press
resolution:
  choice: count-apart
  resolved_at: 2026-11-12T02:55:06Z
applied_at: 2026-11-12T06:43:28Z
---

## Context

**Where this comes from.** On [2026111209dq](2026111209dq-sync-inside-bigger-repo.md) you chose
`top-only`: Sync works only for a project that is the top folder of its own git repository. A
project inside a bigger one (say `web/`, inside a `shop` repository that also holds `api/`) is
skipped, and its answers move to your other machine only when someone commits and pushes them by
hand. That card noted, under every option, that the top bar's count could include such a
project too, and left it open. This card asks it (`docs/roadmap.md` on pull request 14, "Needs a
card", item 1). It doesn't hold up pull request 12, which leaves them out today.

**What the count is.** Card [0001](0001-sync-across-machines.md) added "3 answers not synced" to
the top bar, "so leaving a machine without syncing is visible" (`docs/roadmap.md`, B. Sync). It
counts the card files in a project's `decisions/` folder that changed on this machine and haven't
reached the online copy yet: your answers and notes, an agent's "applied" marks, and new cards
an agent copied into the folder. The Sync button carries a small number too, the same count
plus the cards the online copy has that this machine hasn't.

**What happens to a skipped project today** (the code of pull request 12, branch `feat/sync`):
its count is always 0, whatever is in its folder, so the top bar shows nothing for it. Pressing
Sync shows, greyed out:

```
web  Not synced: web is skipped because it isn't the top folder of a git repository.
```

No number appears there either, and the sentence doesn't name the bigger repository: pull
request 12 only checks whether the project folder has git's own `.git` entry, which a folder
inside a bigger repository doesn't.

**Who is affected now.** Only one project is registered on this machine, president, which is its
own repository, so no project is skipped yet. The question matters once you register a project
inside a monorepo (one repository holding several apps) or in a home folder kept in git.

**What doesn't change under any option.** A folder that isn't in git at all is also skipped, with
the same sentence, but there is nothing to count there: git keeps no record of what has been
sent anywhere. It shows no count under any option. And none of the options makes Sync do
anything in a skipped project; they only change what you are told.

Example used below: on your laptop you answer two cards in `web` and add a note on
card 0031 in `president`, then get ready to leave.

## Option leave-out: Leave them out, as pull request 12 does

```
Top bar:      1 answer not synced                [Sync 1  s]
After Sync:   president  Synced: sent 0031.
              web        Not synced: web is skipped because it isn't the top folder of a git repository.
```

The two `web` answers are counted nowhere. On the desktop the next day they aren't there.

## Option count-apart: Count them, on a line of their own

```
Top bar:      1 answer not synced                [Sync 1  s]
              web: 2 answers not synced (Sync skips it)
After Sync:   president  Synced: sent 0031.
              web        Not synced: web is skipped because it isn't the top folder of a git repository.
Top bar now:  web: 2 answers not synced (Sync skips it)
```

The `web` line stays until someone commits `web/decisions/` in `shop` and pushes it (you, or an
agent you ask). The button's number stays 1, then 0: it counts only what Sync moves.

## Option on-press: Count them only when you press Sync

```
Top bar:      1 answer not synced                [Sync 1  s]
After Sync:   president  Synced: sent 0031.
              web        Not synced: web is skipped because it isn't the top folder of a git repository.
                         2 answers there are not committed; commit web/decisions/ in
                         /home/you/shop by hand to move them.
```

Once you dismiss the report, the top bar shows nothing about `web` again.

## Technical detail (for the implementer)

- Today `repoStatus` in `src/server/sync.ts` returns `{ unavailable, unsynced: 0, remoteChanges: 0 }`
  as soon as `Repo.unavailable()` reports a reason, and `SyncControl` in
  `src/web/components/Sync.tsx` sums `unsynced` over all projects for the top bar and the button.
- `count-apart` and `on-press`: today `Repo.unavailable()` returns "it isn't the top folder of
  a git repository" as soon as the project folder has no `.git` entry, without running git. A
  project inside a bigger repository and a folder outside git therefore look the same. When
  `.git` is missing, run `git rev-parse --show-toplevel` in the project folder. If it succeeds,
  the project is inside that repository (as in the rarer `realTop !== realDir` case): run
  `localCardChanges` anyway. Its pathspec `decisions/` is relative to the project folder, so it
  counts only this project's cards. The `@{u}...HEAD` part needs the bigger repository's
  upstream; without one, only uncommitted changes count. Return the count in a separate field
  (for example `skippedUnsynced`), so it isn't added to the button's number or to "N answers
  not synced". If `rev-parse` fails, the folder is outside git: keep 0. This adds one git
  process per status refresh for such a folder, which today costs none (the comment at
  `unavailable()`). `on-press` also needs the top folder from `rev-parse` for its "commit
  web/decisions/ in /home/you/shop" hint.
- `count-apart`: `SyncControl` shows one line per project with `skippedUnsynced > 0`. `on-press`:
  the `unavailable` result's `action` gets the count and the hand-commit hint instead.
- `docs/roadmap.md` (as pull request 14 leaves it), B, "Decided while PR 12 was open": replace
  "Not decided: whether the top bar's "answers not synced" count includes a skipped project, …"
  with the answer, and remove "Needs a card" item 1.

## Sources

- Card [2026111209dq](2026111209dq-sync-inside-bigger-repo.md) (`top-only`), context: "Today the
  top bar's 'answers not synced' count leaves a skipped project out, so nothing reminds you its
  answers haven't moved; whichever option you pick, it can count them too ('web: 2 answers not
  synced (Sync skips it)')."
- Pull request 14, `docs/roadmap.md`, "Needs a card", item 1: "Count them, or keep leaving them
  out? It doesn't block PR #12, which leaves them out today."
- `docs/roadmap.md` (`feat/sync`), B. Sync: "'3 answers not synced' in the top bar whenever a
  project has card changes that haven't been pushed, so leaving a machine without syncing is
  visible."
- Code on `origin/feat/sync` (commit `b672fe1`): `src/server/sync.ts` (`Repo.unavailable`,
  `Repo.localCardChanges`, `repoStatus`), `src/web/components/Sync.tsx` (`SyncControl`,
  `unsyncedText`).
