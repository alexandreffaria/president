---
id: "2026111209dq"
title: Should Sync work for a project that sits inside a bigger git repository?
status: open
kind: choice
priority: normal
created: 2026-11-12T01:40:35Z
created_by: claude (sync follow-up cards)
tags: [sync, git, scope]
depends_on: ["0001"]
recommendation:
  option: top-only
  why: >-
    Today the only registered project, president, is the top folder of its own repository, so
    nobody is waiting for this, and keeping Sync to such projects means it never pulls or pushes
    a repository that holds more than your cards. If you plan to use president in a monorepo
    (one repository holding several apps) or in a folder kept inside a git-tracked home folder,
    pick opt-in: you get Sync there, but only after a question that names the bigger repository
    it will push to. Pick any-repo only if every bigger repository you use is yours alone.
options:
  - id: top-only
    title: Only projects that are their own repository
    summary: As built in pull request 12; a project inside a bigger repository is skipped, and pressing Sync says why, so its answers move only when someone commits them by hand.
    pros:
      - Sync never touches a repository that holds anything but this project
      - Nothing more to build or explain
    cons:
      - A project in a monorepo or a home-folder repository never gets Sync; its answers stay on the machine where you gave them until someone commits them by hand
      - The top bar's "answers not synced" count leaves such a project out, so between Syncs nothing reminds you its answers haven't moved
  - id: opt-in
    title: Inside a bigger repository, only once you say yes
    summary: Such a project is skipped until you turn Sync on for it; the question names the bigger repository and what Sync will do to it, and from then on Sync runs there as in any project.
    pros:
      - Monorepo and home-folder projects can get Sync when you want it
      - You decide per project, knowing which repository it will pull and push
      - Nothing changes for projects that are their own repository
    cons:
      - One more question per project, and one more setting to remember on each machine
      - Once on, it carries every cost of any-repo for that project
      - The most to build of the three
  - id: any-repo
    title: Every project inside a git repository
    summary: Sync runs for any project that is anywhere inside a git repository; it commits only the project's own decisions folder, then pulls and pushes the whole repository.
    pros:
      - Works everywhere without a question
      - The commit still holds only this project's cards, never anyone else's files
    cons:
      - Every Sync pulls the whole bigger repository, so files far from your project can change on this machine (your shell settings, in a home-folder repository)
      - It pushes straight to the bigger repository's main branch; in a shared monorepo that may be refused, or put "decisions from thinkpad" commits in your team's history
      - Sync says "not now" more often, because an agent's unpushed work anywhere in the bigger repository blocks it
---

## Context

**Where this comes from.** The Sync button (card [0001](0001-sync-across-machines.md), being
built in [pull request #12](https://github.com/alexandreffaria/president/pull/12)) saves your
card answers into git and sends them to the shared copy online, so your other machine gets them.
Its reviewer flagged two left-over questions as yours to answer; this is one of them (the
other is [20261112xp4s](20261112xp4s-notice-after-sync.md)).

**A few words first.** A *git repository* is a folder whose history git keeps, with a shared
copy online (on GitHub, for example). Usually one app is one repository, and the app's folder
is the repository's top folder. Two common setups break that:

- **A monorepo:** one repository holds several apps. Say a `shop` repository holds `web/` and
  `api/`, and you register `shop/web` with president. Its cards are in `shop/web/decisions/`,
  but the repository is all of `shop`, shared with whoever works on `api`.
- **A home folder kept in git:** some people keep their whole home folder (or their settings
  files) in one repository. A project in `~/notes` that isn't its own repository then sits
  inside that one.

**What pull request 12 does.** Sync runs only when the project folder is the top folder of its
repository. Otherwise pressing Sync shows, greyed out:

```
Not synced: web is skipped because it is inside the git repository /home/you/shop
rather than its top folder, and Sync only works on a project that is a repository's top folder
```

The reason is safety. Sync does three things to the whole repository, not just to your cards:
it **brings in** everything the online copy has that this machine doesn't (*pull*), it
**sets aside** and puts back any unsaved work anywhere in the checkout while doing so, and it
**sends** this machine's new history to the online copy's main branch (*push*). In a repository
that is just your project, "everything" is your project. In a bigger one, it is everyone's
work in it.

**What doesn't change under any option.** Sync's own commit holds only the project's
`decisions/` folder, so it never adds anyone else's files. Sync still refuses ("Not now") when
an agent has unfinished or unsent work it could disturb, and still stops, changing nothing, if
something looks wrong.

**What there is today.** One project is registered on this machine: president, which is the
top folder of its own repository. So no project is affected yet.

## Option top-only: Only projects that are their own repository

What pull request 12 does. For `shop/web`, Sync always says it is skipped. To move its answers
to your other machine, you (or an agent you ask) commit `shop/web/decisions/` and push by hand,
as everyone does today before Sync exists.

## Option opt-in: Inside a bigger repository, only once you say yes

The first time you press Sync with `shop/web` registered:

```
web is inside the bigger git repository /home/you/shop. Sync there would bring in
everything new in /home/you/shop and send your answers to its main branch.
                                        [Sync web too]   [Keep skipping it]
```

After "Sync web too", it syncs like any other project. Your other machine asks again, since the
setting is per machine.

## Option any-repo: Every project inside a git repository

`shop/web` syncs with no question. In a press of Sync, the commit is "decisions from thinkpad:
0003" with only `web/decisions/` in it; the pull may also bring in a teammate's new files in
`api/`; and the push goes to `shop`'s main branch. If `shop` only accepts changes through
reviewed pull requests, the push is refused and Sync shows git's error, with your answers kept
in a local commit.

## Technical detail (for the implementer)

- `opt-in` and `any-repo`: `Repo.unavailable()` in `src/server/sync.ts` (on `feat/sync`) stops
  requiring `realpath(show-toplevel) === realpath(dir)`; every path in the sequence becomes
  `<prefix>/decisions/` (from `git rev-parse --show-prefix`): `git add`, `commit --only`, the
  counts, check 2 ("no unpushed commit outside decisions/") and check 3's `isCardPath`. Checks 2
  and 3 stay repository-wide, which is where the extra "not now" comes from.
- Two registered projects in one repository (`shop/web` and `shop/api`) must share one git
  sequence: key `KeyedMutex` and `WriteGate` by the repository's top folder, not
  `project.path`, or run one Sync per repository covering both projects' `decisions/`.
- `opt-in`: the yes is stored per machine in the hub's registry entry for the project (for
  example `sync: enclosing-repo`), so it isn't in the card files and doesn't travel.
- Under any option, `repoStatus` could still count unsynced answers for a skipped project, so
  the top bar can say "web: 2 answers not synced (Sync skips it)" instead of nothing.

## Sources

- [PR #12](https://github.com/alexandreffaria/president/pull/12), "Details the card left open",
  item 2: "Only a project whose folder is the top of its git repository (or worktree) is synced
  ... A project inside a bigger repository (a home folder kept in git, a monorepo subfolder) is
  reported as skipped, so Sync never commits into the enclosing repository."
- The review of PR #12
  ([comment](https://github.com/alexandreffaria/president/pull/12#issuecomment-6811811120)),
  choice 2: "**Worth a card**, because it means a project inside a monorepo or a home-folder
  repo never gets Sync at all, which is a scope decision."
- Code on `feat/sync`: `src/server/sync.ts` (`Repo.unavailable`, `runSequence`, `repoStatus`
  returning 0 unsynced for a skipped project, `SyncService` locking per `project.path`),
  `src/web/components/Sync.tsx` (a skipped result is shown muted).
- `docs/roadmap.md`, "B. Sync", "What Sync runs, per project" (the sequence and its checks).
- `president list` on this machine, 2026-11-12: one project, president, at
  `/home/flores/projects/president`.
