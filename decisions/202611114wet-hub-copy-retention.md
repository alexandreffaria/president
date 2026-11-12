---
id: "202611114wet"
title: How long should the hub keep its copy of a card's conversations?
status: resolved
kind: choice
priority: high
created: 2026-11-11T18:21:21Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, storage, privacy]
depends_on: ["0018", "0021"]
recommendation:
  option: with-card
  why: >-
    You chose the hub's own copy partly because it "lasts as long as you want, even after
    Claude Code has deleted its copy", and a conversation is most useful next to its card,
    including on decided cards you come back to ("why did we pick this?"). Tying it to the
    card keeps that and still cleans up after cards and projects that are gone. The cost is
    that old conversations, with any file text the agent quoted, stay on disk for as long as
    their cards exist. Pick ninety-days if you'd rather nothing quoted from your projects
    lingers for months.
options:
  - id: with-card
    title: As long as the card exists
    summary: A conversation is kept while its card is in a registered project; once the card file or the project has been gone for 30 days, the hub deletes it.
    pros:
      - Conversations on decided cards stay readable for good, next to the decision they led to
      - Cleans up after itself when a card or project really goes away
      - The 30-day grace keeps a conversation through a temporary absence (another branch checked out, a project removed and added back)
    cons:
      - No time limit; text the agent quoted from your files stays on disk as long as the card exists
      - A card that is renumbered loses its conversation after 30 days, since the copy is filed under the old id (rare with dated ids)
  - id: ninety-days
    title: 90 days after the last message
    summary: Each conversation is deleted 90 days after its last message, whatever happens to its card or project; nothing else needs handling.
    pros:
      - One simple rule; removed, renumbered or unregistered cards' copies just expire
      - Quoted project text doesn't linger beyond three months
    cons:
      - Conversations on decided cards disappear after three months, when "why did we pick this?" may be exactly the question
      - Copies of removed cards and projects sit on disk until they expire
  - id: with-claude
    title: As long as Claude Code keeps the session
    summary: The hub deletes its copy when Claude Code deletes the session (after 30 days unused, by default), so the page never shows a conversation the agent can no longer continue.
    pros:
      - What you see is always a conversation the agent still remembers; the "no longer remembers" state never happens
      - Little on disk; follows Claude Code's own setting
    cons:
      - Gives up the reason you chose the hub's copy in 0018; after 30 days without use, only the summaries remain
      - The hub has to check whether Claude Code still has each session, which ties it to Claude Code's storage
resolution:
  choice: with-card
  resolved_at: 2026-11-12T01:55:54Z
applied_at: 2026-11-12T03:10:59Z
---

## Context

**What 0018 decided.** On [0018](0018-show-earlier-conversation.md) you chose `hub-copy`: the
hub saves each message it showed you in a file of its own on this machine, outside the
project, for example `~/.local/state/president/chats/shop/0042.jsonl`, and shows it when you
come back to the card. 0018's pros include "Lasts as long as you want (president sets its own
cleanup), even after Claude Code has deleted its copy"; its cons include "A second copy of
every conversation on disk, including any file contents the agent quoted, with its own cleanup
to build" and the cases "a project or card that is removed, renamed or renumbered".

**What is left open** (`docs/roadmap.md`, "Where the conversation lives", and "Needs a card",
item 7): how long the hub keeps a copy, and what happens to it when a project is unregistered
or a card is removed or renumbered.

**Facts that bound the choice.**

- Claude Code keeps its own transcript for 30 days without use by default
  (`cleanupPeriodDays`), after which the session can't be continued.
- The copy is filed by project name and card id, like the session store of
  [0021](0021-session-id-per-machine.md) (`"president/0007"`). A renumbered card, or a project
  registered under a new name, no longer matches it (0021's accepted cost).
- A card file can be absent for a while without being gone: the hub reads the main folder's
  checkout, which may be on another branch; and `president remove` only deletes the project's
  entry in the registry (`remove` in `src/server/registry.ts`), so adding it back is easy.
- On another machine there is no copy under any option; summaries travel with the card.

Example: you talked about #0042 in March, decided it, and in September open it to remember why.

## Option with-card: As long as the card exists

September: the March conversation is on the page, under the decision. If #0042's file
disappears from the project, or the project is removed from president, the conversation is
deleted 30 days later, unless the card is back by then.

## Option ninety-days: 90 days after the last message

September: the March conversation was deleted in June. The card's History still has the
summary you saved.

## Option with-claude: As long as Claude Code keeps the session

September: the conversation was deleted in April, 30 days after you last used it, together
with Claude Code's copy. The card's History still has the summary you saved.

## Technical detail (for the implementer)

- `with-card`: at hub start (and once a day while it runs), list the copies, and for each
  check that its project is registered and its card exists; record when it was first found
  missing and delete it 30 days after that.
- `ninety-days`: delete files whose last message is older than 90 days, at hub start and once
  a day.
- `with-claude`: check whether `~/.claude/projects/<project>/<session-id>.jsonl` still exists
  (existence only; president never reads that file, per 0018), using 0021's session store to
  find the id. A user who changes `cleanupPeriodDays` changes this too.

## Sources

- Card [0018](0018-show-earlier-conversation.md), option `hub-copy`, its pros and cons and its
  technical detail; card [0021](0021-session-id-per-machine.md), option `local` (store keyed by
  project and card, "If a card is renumbered ... the hub loses track").
- `docs/roadmap.md`, "Where the conversation lives (#0003, #0018, #0021)" and "Needs a card",
  item 7.
- Claude Code docs, settings reference, `cleanupPeriodDays`: "Set how many days Claude Code
  keeps session transcripts and other application data before deleting them", default `30`.
  https://code.claude.com/docs/en/settings-reference#cleanupperioddays
- Code: `src/server/registry.ts` (`remove` deletes the registry entry, not the project).
