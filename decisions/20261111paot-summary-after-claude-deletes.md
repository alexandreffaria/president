---
id: "20261111paot"
title: After Claude Code deletes a conversation you never summarized, can a summary still be written?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:22Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, summary]
depends_on: ["0018", "0024", "202611114wet"]
recommendation:
  option: from-copy
  why: >-
    The hub's copy still holds everything you and the agent said, which is what a summary is
    made of, so throwing the chance away loses what you concluded for no good reason. A
    fresh session reading the copy can write it, for one run's cost. Pick write-it-yourself
    if you'd rather never have a summary written by an agent that didn't take part in the
    conversation. If you pick with-claude on the retention card, this case doesn't arise.
options:
  - id: from-copy
    title: Yes, from the hub's copy
    summary: Write summary still works; a fresh session reads the saved messages and writes the summary, which you edit and save as usual.
    pros:
      - What you discussed can still reach the working agent, after any length of time
      - The same button and box as for any other conversation
    cons:
      - The fresh session sees only what the page showed, not the files the original agent read, so details it relied on may be missing from the summary
      - One more agent run, and a long conversation costs more to read in full
  - id: write-it-yourself
    title: No agent summary; you write a note instead
    summary: The card says the agent can no longer summarize the conversation and offers to add a note yourself, with the saved messages shown above for reference.
    pros:
      - Every summary is written by the session that took part, or by you
      - No extra agent run
    cons:
      - You have to remember and type what you concluded, possibly weeks later
      - Two ways a conversation ends up on the card, a summary or a note
  - id: gone
    title: No, the reminder goes away
    summary: Once Claude Code has deleted the session, the reminder disappears; the messages stay readable on the page, but nothing more is offered.
    pros:
      - The simplest rule; no new button or flow
      - Nothing nags you about a conversation weeks old
    cons:
      - What you discussed never reaches the agent unless you think of adding a note
      - The page shows the conversation but offers nothing to do with it
---

## Context

**The two decisions that meet here.**

- [0018](0018-show-earlier-conversation.md) (`hub-copy`): the hub saves every message it
  showed you, on this machine, and shows them when you come back. If Claude Code has deleted
  its own copy, the page adds: "The agent no longer remembers this conversation; your next
  message starts from the summaries."
- [0024](0024-leaving-an-open-conversation.md) (`remind`): if you leave a conversation without
  closing it, the card later offers "Write summary". If Claude Code has deleted the
  conversation meanwhile, the card says "This conversation is no longer on this machine"
  instead.

Both texts can't be right: the messages are still on this machine (the hub's copy), but the
agent's session is gone. Whether a summary can still be written is open (`docs/roadmap.md`,
"Cross-card consequences", and "Needs a card", item 8).

**When it happens.** Claude Code deletes a session after 30 days without use by default
(`cleanupPeriodDays`). So: a conversation you left without a summary, on a card you haven't
opened for a month. How long the hub keeps its own copy is the
[retention card](202611114wet-hub-copy-retention.md); under its `with-claude` the copy goes
too, and this case never arises.

**What a summary is.** One more run of the card's session, asked to summarize; you edit the
result and only what you save is added to the card ([0003](0003-conversation-storage.md),
`docs/roadmap.md`). The summary is all the working agent learns of a conversation.

Example: on 2 October you asked #0042's agent whether the HTTP client throws on 404, left
without closing, and come back on 5 November.

## Option from-copy: Yes, from the hub's copy

```
Discuss
  you, 2 Oct      Does our HTTP client already throw on 404?
  agent, 2 Oct    It does: src/http.ts line 40 ...
  The agent no longer remembers this conversation.
  Not summarized yet.  [Write summary from these messages]
```

## Option write-it-yourself: No agent summary; you write a note instead

```
Discuss
  (the messages, as above)
  The agent no longer remembers this conversation, so it can't summarize it.
  [Add a note with what you concluded  m]
```

## Option gone: No, the reminder goes away

```
Discuss
  (the messages, as above)
  The agent no longer remembers this conversation.
```

## Technical detail (for the implementer)

- `from-copy`: a new `claude -p` run with #0004's flags and a new session id, given the hub's
  copy on standard input (never as an argument, per the roadmap) with the summary request;
  `--max-budget-usd 1` still caps it. Save nothing to the session store (0021) for this run, or
  run it with `--no-session-persistence`, since nobody continues it.
- Under every option, 0018's "no longer remembers" line stays, and 0024's "no longer on this
  machine" text is replaced by the option's.

## Sources

- Cards [0018](0018-show-earlier-conversation.md) (`hub-copy`),
  [0024](0024-leaving-an-open-conversation.md) (`remind`),
  [0003](0003-conversation-storage.md) (`summary`); the
  [retention card](202611114wet-hub-copy-retention.md).
- `docs/roadmap.md`, "Cross-card consequences" ("#0018 `hub-copy` + #0024 `remind`: they
  disagree after Claude Code deletes a conversation") and "Needs a card", item 8.
- Claude Code docs, settings reference, `cleanupPeriodDays`, default `30`.
  https://code.claude.com/docs/en/settings-reference#cleanupperioddays
- `claude --help` (2.1.302): "`--no-session-persistence` Disable session persistence -
  sessions will not be saved to disk and cannot be resumed (only works with --print)".
