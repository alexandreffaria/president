---
id: "202611111gpm"
title: Should the run that writes new options after "neither" be part of the card's conversation?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:25Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, neither]
depends_on: ["0007", "0004", "0021", "0018", "0024"]
recommendation:
  option: separate
  why: >-
    The run is a job with one result, the new options, and you already see those on the
    card; making it a conversation would add a reminder to summarize every time you say
    "neither", for a summary that repeats your own note. A separate run can still start
    from the card's earlier conversation, as 0007 promised, without adding to it. Pick
    in-conversation if you expect to question new options often ("why did you drop the
    server option?") and want the agent that wrote them to answer.
options:
  - id: separate
    title: A separate job, not a conversation
    summary: The run starts from a copy of the card's conversation (if there is one), writes the new options, and leaves nothing behind; the panel shows only "New options, written from your note at 21:00".
    pros:
      - No extra messages, stored conversation or "not summarized" reminder for each "neither"
      - The card's conversation stays as you left it, and the run still knows what was said in it
    cons:
      - You can't see how the agent got to the new options, beyond what the options and the recommendation say
      - Asking "why did you drop X?" starts from the conversation as it was, which didn't take part in writing them
  - id: in-conversation
    title: A turn in the card's conversation
    summary: The run is a message in the card's conversation; the panel shows your note and the agent's reply with the new options, and you can ask follow-ups in the same thread.
    pros:
      - The reasoning behind the new options is on the page, and follow-up questions go to the agent that wrote them
      - One history per card; nothing happens out of view
    cons:
      - Every "neither" starts or extends a conversation, with its stored copy and a "not summarized" reminder, for a summary that mostly repeats your note
      - The reply has to be both a readable message and options the hub can check, which makes the run more fragile
---

## Context

**What 0007 decided.** On [0007](0007-neither-try-again.md) you chose `spawn`: **Ask for new
options** in the Neither panel records your note (as today: `feedback` type `neither`,
`needs_new_options: true`) and starts the card's read-only session ([0004](0004-chat-session-permissions.md))
at once. The run "can see the card's earlier conversation on this machine, if any, and do
research" and returns options the hub writes with `president update`'s checks. While it runs
the card shows "Writing new options...", and afterwards "New options, written from your note
at 21:00" (`docs/roadmap.md`, "Neither: new options right away").

**What is left open** (`docs/roadmap.md`, "Needs a card", item 11):

1. Whether the run's exchange shows in the card's conversation panel.
2. Whether it counts as a conversation: an entry in the session store
   ([0021](0021-session-id-per-machine.md)), messages in the hub's copy
   ([0018](0018-show-earlier-conversation.md)), a "not summarized" reminder
   ([0024](0024-leaving-an-open-conversation.md)).
3. What the page says when the run fails or returns options the checks refuse, and whether it
   retries.

The options answer 1 and 2 together. For 3, both do the same, since nothing is written when a
run fails and the card keeps waiting for the project's agent as today:

```
Couldn't write new options: the agent's options didn't pass the card checks
(option "b" has no title). The card waits for the project's agent, as before.
[Try again]
```

There is no automatic retry: a refused answer usually fails the same way again, and each run
can cost up to $1 (#0004's `--max-budget-usd 1`). If you want one automatic retry, say so in
your note.

Example: at 21:00 you reject both options of #0042 with "Both assume a server. Compare
on-device storage only." Earlier that day you had asked its agent two questions.

## Option separate: A separate job, not a conversation

```
Discuss
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...
  New options, written from your note at 21:00.
```

The two earlier messages are untouched; no new conversation is stored for the run.

## Option in-conversation: A turn in the card's conversation

```
Discuss
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
  agent, 21:02   Here are three on-device options: IndexedDB, SQLite (OPFS), plain files...
                 (the options are now on the card)
  Not summarized yet.  [Write summary]
```

## Technical detail (for the implementer)

- `separate`: when the card has a session on this machine, run with `--resume <id>
  --fork-session --no-session-persistence`, so the run sees the conversation but gets its own
  id and is never saved; otherwise a fresh run with `--no-session-persistence`. Nothing is
  written to the session store, the hub's copy or the "not summarized" list. Options come back
  through `--json-schema`.
- `in-conversation`: resume the card's session (or start one with `--session-id`, adding a
  store entry), save both messages in the hub's copy, and mark the conversation as not
  summarized. The reply must carry the options in the structured output and a readable message.
- Both: on failure, write nothing (the card stays `needs_new_options: true` for the working
  agent) and show the reason; Try again starts the run again with the same note.

## Sources

- Card [0007](0007-neither-try-again.md) (`spawn`), and cards
  [0004](0004-chat-session-permissions.md), [0018](0018-show-earlier-conversation.md),
  [0021](0021-session-id-per-machine.md), [0024](0024-leaving-an-open-conversation.md).
- `docs/roadmap.md`, "Neither: new options right away (#0007)" and "Needs a card", item 11.
- `claude --help` (2.1.302): "`--fork-session` When resuming, create a new session ID instead of
  reusing the original (use with --resume or --continue)"; "`--no-session-persistence` Disable
  session persistence - sessions will not be saved to disk and cannot be resumed (only works
  with --print)"; "`--json-schema <schema>` JSON Schema for structured output validation".
- Code: `src/core/actions.ts` (`neither` sets `needs_new_options`), `src/core/queue.ts`
  (`isWaitingOnAgent`), `src/web/views/QueueView.tsx` ("Waiting for new options").
