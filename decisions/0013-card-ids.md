---
id: "0013"
title: How should agents pick a new card's id?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:13Z
created_by: claude (batch-1 writer)
tags: [format, ids, concurrency]
depends_on: []
recommendation:
  option: dated
  why: >-
    Collisions don't come from two agents in one folder as much as from agents on different
    branches and worktrees (how this project itself works), and only an id that doesn't
    depend on what's in the folder avoids those. The cost is longer ids, which the UI can
    shorten for display. Keep sequential if you mostly run one agent per project at a time.
options:
  - id: sequential
    title: Keep sequential numbers
    summary: Today's rule; the next id is the highest number in decisions/ plus one, and a collision shows both cards as broken until the newer one is renumbered.
    pros:
      - Short, readable ids you can say out loud ("card twelve")
      - The folder sorts in creation order, and gaps or duplicates are easy to spot
    cons:
      - Two agents on two branches both pick the same next number; the collision only shows up after the merge, as two broken cards
      - Renumbering after the fact breaks references to the old id in depends_on, docs and commit messages
  - id: reserved
    title: Sequential, reserved by a command
    summary: A new president new <slug> command creates decisions/<next>-<slug>.md exclusively (fails and retries if the file appears), so agents in the same folder never collide.
    pros:
      - Keeps short numbers
      - Agents in the same checkout can't collide, even at the same instant
    cons:
      - Doesn't help across branches or worktrees, which each have their own decisions/ folder
      - Another command agents must use instead of writing the file directly
  - id: dated
    title: Date plus a random suffix
    summary: Ids like 20261111k7q2, the UTC date plus 4 random lowercase letters and digits, which never depend on the folder's contents.
    pros:
      - Collisions are practically impossible anywhere (1.7 million suffixes per day)
      - Still sorts by creation day in the folder and in tie-breaks
    cons:
      - Long ids in file names, depends_on and conversation ("card 20261111k7q2"); the UI would show a shorter form
      - Existing cards keep their numbers, so projects mix two styles
---

## Context

**Today**: `docs/card-format.md` and the skill (`skills/decision-cards/SKILL.md`, "Writing a
card", step 1) tell agents to list `decisions/`, take the highest number and add one, zero-padded
to 4 digits. Ids may be any 1 to 32 lowercase letters and digits, no dashes, because the dash
separates the id from the slug (`CARD_ID_PATTERN` and `CARD_FILENAME_PATTERN` in
`src/core/model.ts`). Two files with the same id are both shown as broken (`id "0012" is also
used by ...`), and the skill tells the agent that wrote the newer card to renumber it.

**How collisions happen.** Within one folder, two agents can pick the same number at the same
moment. More often in this project's own process ("Every task is done by a fresh agent session on
its own branch", `docs/foundations.md`), each agent works in its own git worktree with its own
copy of `decisions/`: two branches both add `0018`, and the clash appears only after both are
merged. Neither agent's own `validate` saw the other card. (The CI step added with this batch
runs `president validate .` on each pull request merged with main, so the second PR would at
least fail CI.)

Ids appear in: file names, `depends_on`, the UI (`#0013`), queue tie-breaks (`compareQueue` in
`src/core/queue.ts`), and `president pending`'s output.

## Option sequential: Keep sequential numbers

```
decisions/0017-deferred-resurfacing.md
decisions/0018-sync-shortcut.md      # agent A, branch feat/sync
decisions/0018-teach-me-length.md    # agent B, branch feat/teach → both broken after merge
```

## Option reserved: Sequential, reserved by a command

```sh
$ president new sync-shortcut
decisions/0018-sync-shortcut.md     # created empty-template, exclusively; write your card into it
```

## Option dated: Date plus a random suffix

```
decisions/20261111k7q2-sync-shortcut.md
decisions/20261111p3xa-teach-me-length.md
```

```sh
echo "$(date -u +%Y%m%d)$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c4)"
```

The UI would show `#k7q2` (unique within the day) next to the date.
