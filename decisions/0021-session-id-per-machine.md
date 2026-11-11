---
id: "0021"
title: Where should the hub remember which conversation belongs to a card?
status: open
kind: choice
priority: normal
created: 2026-11-11T15:58:25Z
created_by: claude (batch-2 writer)
tags: [pr-2, chat, sync, storage]
depends_on: ["0001", "0003"]
recommendation:
  option: local
  why: >-
    A conversation only exists on the machine that had it, so its id is useful only there,
    and putting it in a file that git shares buys nothing and causes Sync conflicts and
    lost conversations when you chat on two machines. Keeping it in the hub's own store also
    means chatting never changes the card file, so the "this card changed" notice can't fire
    mid-chat. Pick per-machine if you want the card file to be the only place president
    keeps anything about a card.
options:
  - id: shared
    title: One line in the card for all machines
    summary: The card keeps one session_id; whichever machine chats on the card last writes its conversation's id there, as the roadmap describes today.
    pros:
      - Simplest; the field is already reserved in the card format
      - Everything about a card is in its file
    cons:
      - Talking about the same card on two machines makes each one replace the other's id, so each machine loses its own conversation and starts over from the summaries
      - If both machines change that line between two Syncs, Sync stops with "changed on both machines" (tested)
      - A conversation started on one machine and a note added on the other between Syncs can also conflict when the id line sits next to the notes, as it does when it is added after them (new fields go at the end; tested)
      - The card file changes when a conversation starts, which the open page has to recognise as its own write
  - id: per-machine
    title: One line per machine in the card
    summary: The card keeps a small list with one conversation id per machine name (laptop, desktop), and each machine changes only its own line.
    pros:
      - Each machine keeps continuing its own conversation; no more losing it to the other machine
      - Everything about a card is still in its file
    cons:
      - If both machines change their lines between two Syncs, Sync still stops with "changed on both machines", because the lines sit next to each other (tested)
      - A conversation started on one machine and a note added on the other between Syncs can also conflict when the list sits next to the notes, as it does when it is added after them (new fields go at the end)
      - Commits ids that mean nothing on any other machine, and the list keeps machines you no longer use
      - The card file still changes when a conversation starts
  - id: local
    title: Outside the card, in the hub's own store
    summary: Each machine's hub keeps its own small list of "project, card, conversation id" outside the project, and the card's session_id field stays unused.
    pros:
      - Chatting never changes the card file, so it never causes Sync conflicts or "this card changed" notices
      - Each machine continues its own conversation; the other machine starts from the summaries, as card 0003 already accepted
      - Removes the question of writing ids on decided cards (#0020)
    cons:
      - New storage in the hub, outside the project, which you can't see in the card or in git
      - If a card is renumbered (two agents picked the same id) or a project is registered under a new name, the hub loses track and starts a new conversation from the summaries
      - The reserved session_id field in the card format goes unused and should be removed or redescribed
---

## Context

PR 2 runs a Claude Code session per card. To continue a conversation, the hub needs the
session's id (`claude --resume <id>`). Card [#0003](0003-conversation-storage.md) (option
`summary`) decided that the full conversation stays in Claude Code's store **on the machine
that had it**; only summaries travel with the card. The roadmap (`docs/roadmap.md`, merged
with PR #5, "Where the conversation lives") stores the id in the card's `session_id`
field, which the format already reserves (`src/core/schema.ts`, `docs/card-format.md`). This card
asks whether that is the right place, now that cards travel between machines with Sync
([#0001](0001-sync-across-machines.md), option `sync`).

**Why it matters.** A session id only works on the machine that created it: Claude Code finds
sessions "on this machine", and elsewhere `--resume` fails. The roadmap's rule for that case is
to start a fresh conversation from the card's summaries and replace `session_id`. With one shared
line, that leads to this:

1. Monday, laptop: you talk about #0007. The card gets `session_id: aaa`. You Sync.
2. Tuesday, desktop: `aaa` isn't on this machine, so a fresh conversation starts from the
   summaries and the card gets `session_id: bbb`. You Sync.
3. Wednesday, laptop: `bbb` isn't on the laptop. Its own conversation `aaa` is still there, but
   the card no longer points at it, so it starts over again.

And if you talk on both machines **without syncing in between**, both change the same line and
Sync stops with "Not synced: 0007 changed on both machines", which needs a manual git fix.

**What I tested** (git 2.56.0, two clones of one repository, each machine committing its change
and the second one pulling with `--rebase`, as Sync does):

| Change on laptop | Change on desktop | Result |
|---|---|---|
| sets `session_id: aaa` | sets `session_id: bbb` | conflict |
| adds `laptop: aaa` to a per-machine list | adds `desktop: bbb` to the same list | conflict |
| changes its own line in the list | changes its own (neighbouring) line | conflict |
| adds a note to `feedback` | adds `desktop: bbb` to the list, far from `feedback` | merged cleanly |
| sets `session_id` for the first time (a new key goes at the end, next to `feedback`) | adds a note to `feedback` | conflict |
| changes an existing `session_id` that sits after `feedback` | adds a note to `feedback` | conflict |

So a per-machine list stops the machines from taking each other's conversation, but not the
conflicts, and under both `shared` and `per-machine` starting a conversation on one machine can
collide with a plain note on the other. (Two machines each adding a summary to the same card between Syncs also conflicts,
under every option; that is #0001's known cost.)

## Option shared: One line in the card for all machines

```yaml
session_id: 3f2c9a8e-1b7d-4c55-9e0a-6d2f8b1c4e77
```

## Option per-machine: One line per machine in the card

```yaml
chat_sessions:
  desktop: 9a1e4b2c-77d0-4f0e-b6a1-2c5d8e3f9b10
  laptop: 3f2c9a8e-1b7d-4c55-9e0a-6d2f8b1c4e77
```

The machine name would be the computer's hostname, or a name you set once per machine.

## Option local: Outside the card, in the hub's own store

Nothing in the card. On each machine, in president's state folder (`$XDG_STATE_HOME/president/`,
by default `~/.local/state/president/`, the same folder #0018's `hub-copy` would use), the hub
keeps something like:

```json
{ "president/0007": "3f2c9a8e-1b7d-4c55-9e0a-6d2f8b1c4e77" }
```

On another machine there is no entry, so the first message there starts from the summaries,
exactly as #0003 describes, and that machine keeps its own entry from then on.

## Technical detail (for the implementer)

- Under every option, generate the id up front with `claude -p --session-id <uuid>` (a valid UUID)
  rather than reading it from the output, so it is known before the first run starts.
- Under `shared` and `per-machine`, the id write goes through the hub's card writer and changes
  the card's revision (`revisionOf` in `src/server/cards.ts`); the page must treat it as its
  own write and not show "An agent changed this card" (`src/web/views/CardView.tsx`).
- Under `local`, the store goes in `$XDG_STATE_HOME/president/`, not beside the registry in
  `$XDG_CONFIG_HOME/president/` (`src/server/registry.ts`): the registry is configuration you
  set up, while session ids are state the hub keeps between restarts, which is what the XDG
  spec puts in `$XDG_STATE_HOME`. `docs/card-format.md` and the `session_id` comment in
  `src/core/schema.ts` change to say the field is no longer used.
- Variant of `local`: the id could also be derived from the project path and card id (a fixed
  UUID per card passed to `--session-id`), so nothing is stored at all; starting a fresh
  conversation on the same card would then need a counter.

## Sources

- Claude Code docs, sessions, "Resume by session ID or name": Claude Code looks in "the current
  project directory and its git worktrees" then "every other project on this machine"; "If no
  stored session matches the ID, Claude Code reports `No conversation found with session ID:
  <session-id>`." https://code.claude.com/docs/en/sessions
- Claude Code docs, Agent SDK sessions: "Same machine only: the session file still needs to exist
  on the current machine." https://code.claude.com/docs/en/agent-sdk/sessions
- `claude --help` (2.1.302): "`--session-id <uuid>` Use a specific session ID for the
  conversation (must be a valid UUID)".
- Scratch test with git 2.56.0: two clones of a bare repository, each commits its version of a
  card, the second runs `git pull --rebase` (results in the table above).
- XDG Base Directory Specification: `$XDG_CONFIG_HOME` is for "user-specific configuration
  files" (default `$HOME/.config`); `$XDG_STATE_HOME` is for "state data that should persist
  between (application) restarts", such as "current state of the application that can be reused
  on a restart" (default `$HOME/.local/state`). https://specifications.freedesktop.org/basedir/latest/
- Cards #0001, #0003, #0018, #0020; `docs/roadmap.md` (on main since PR #5); PR #5 review,
  finding D-4 and question Q4.
- Code: `src/core/schema.ts` (`session_id`), `src/server/cards.ts` (`revisionOf`),
  `src/server/registry.ts`, `src/web/views/CardView.tsx`.
