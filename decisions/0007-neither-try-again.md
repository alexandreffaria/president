---
id: "0007"
title: When you reject every option, who should write the new ones, and when?
status: open
kind: ab
priority: normal
created: 2026-11-11T13:22:07Z
created_by: claude (batch-1 writer)
tags: [pr-2, chat, neither]
depends_on: ["0004"]
recommendation:
  option: spawn
  why: >-
    "Neither" is usually said while the question is fresh in your head, and today the card
    can sit in "Waiting for new options" for days in a quiet project. Rewriting options needs
    only reading and research, so it fits a read-only session (#0004) with the hub writing
    the result. Keep "wait" if you'd rather the agent that knows the current work always
    writes the options.
options:
  - id: spawn
    title: The hub starts an agent right away
    summary: Pressing "Ask for new options" spawns the card's session, which writes new options from your note; the card comes back to the queue a minute or two later.
    pros:
      - New options while you are still in the mood to decide, often within the same sitting
      - Works in projects where no agent is running
      - The session can see your earlier conversation about the card (if there was one) and do research for it
    cons:
      - The session knows the code but not the working agent's plan or uncommitted work, so its options can miss context
      - Costs a Claude Code run per "neither", even for cards you would have deferred anyway
      - The working agent later finds options it didn't write, and pending still lists the card for it to read
  - id: wait
    title: The card waits for the project's agent
    summary: Keep today's flow; the card gets needs_new_options and leaves the queue until an agent in the project runs president pending and rewrites it with president update.
    pros:
      - The agent that knows the plan, the branch and the code writes the options
      - Already built, with update's guard against overwriting a note you add meanwhile
      - No cost or background process until an agent is working there anyway
    cons:
      - Nothing happens until an agent runs in that project; the card can wait for days
      - By the time new options arrive, you have lost the context you had when you rejected the old ones
---

## Context

**Today**: "Neither" (`n`) opens a panel asking "None of these. What's wrong with them, or what
would you rather see?" Sending it applies the `neither` action (`src/core/actions.ts`): it
appends your text to `feedback` with `type: neither`, keeps the card `open` and sets
`needs_new_options: true`. The queue hides such cards and lists them under "Waiting for new
options" (`isWaitingOnAgent` in `src/core/queue.ts`, `src/web/views/QueueView.tsx`). An agent
running `president pending` sees "The human rejected the options...", writes new options and
removes the flag through `president update`, then runs `president seen`. The card is back in
the queue as soon as the file changes.

PR 2 adds a per-card Claude Code session, so the hub could start the rewrite itself. Depends
on #0004: the session needs to read and research; the write can be the hub's.

The two options are compared on the same scenario: you reject both options of card 0007 at
21:00 with "Both assume a server. Compare on-device storage only." No agent is running in that
project tonight.

## Option spawn: The hub starts an agent right away

```
21:00  You: Neither → "Both assume a server. Compare on-device storage only."
21:00  Card: "Writing new options..." (out of the queue, under "Waiting for new options")
21:02  The session returns options as JSON; the hub writes them with update's checks,
       removes needs_new_options, and the card is back in the queue with a notice
       "New options, written from your note at 21:00".
21:03  You decide.
```

The session's run is the same as #0004's, with a prompt built from the card and the unseen
feedback, and `--json-schema` for the options it returns.

## Option wait: The card waits for the project's agent

```
21:00  You: Neither → same note.
21:00  Card moves to "Waiting for new options".
...    (nothing until an agent works in the project)
Day+2  An agent runs `president pending`, rewrites the options, runs `president seen`.
Day+2  The card is back in the queue; you read your own note from two days ago to remember why.
```
