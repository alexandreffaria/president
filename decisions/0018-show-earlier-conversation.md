---
id: "0018"
title: When you come back to a card on the same machine, should the page show the earlier conversation?
status: open
kind: choice
priority: normal
created: 2026-11-11T15:58:25Z
created_by: claude (batch-2 writer)
tags: [pr-2, chat, storage]
depends_on: ["0003"]
recommendation:
  option: claude-store
  why: >-
    The conversation already exists in Claude Code's store, and Claude Code documents a
    reader for it, so the page can show exactly what the agent remembers without president
    keeping a second copy of transcripts. Pick hub-copy if you want to reread old
    conversations after Claude Code has deleted them (30 days by default), and summaries if
    you never reread conversations and only care about what you concluded.
options:
  - id: claude-store
    title: Read it back from Claude Code's own store
    summary: When you open a card, the page loads the earlier messages from the session Claude Code saved on this machine, the same one the chat continues.
    pros:
      - What you see is exactly what the agent remembers, no more and no less
      - No second copy of any transcript; president stores nothing new
      - Claude Code documents a function for reading these messages, so president doesn't have to decode the file itself
    cons:
      - Gone once Claude Code cleans it up (after 30 days by default); the page then shows only the summaries
      - Adds a dependency on Claude Code's developer kit (the Agent SDK) to the hub
      - Claude Code saves everything the agent did (files it read, searches), so the page has to pick out the readable messages
  - id: hub-copy
    title: The hub keeps its own copy, outside git
    summary: The hub saves each message it showed you to a file of its own on this machine (outside the project, never committed) and shows that file when you come back.
    pros:
      - Shows exactly what you saw, in president's own format, which no Claude Code update can break
      - Lasts as long as you want (president sets its own cleanup), even after Claude Code has deleted its copy
    cons:
      - A second copy of every conversation on disk, including any file contents the agent quoted, with its own cleanup to build
      - After Claude Code deletes its copy, the page shows a conversation the agent no longer remembers; your next message starts from the summaries
      - New storage code in the hub (writing, reading, cleanup, a project or card that is removed)
  - id: summaries
    title: Show only the saved summaries
    summary: Coming back shows the card's History with the summaries you saved; the earlier messages aren't shown, though the agent still remembers them when you continue.
    pros:
      - Nothing to build or store; the page shows only what is in the card
      - The same view on every machine, since summaries travel with the card
    cons:
      - After a reload, a closed tab or a hub restart you can't reread what the agent said, even though it is on this machine
      - The agent remembers details you can no longer see, so a reply like "as I said above" points at nothing
      - A conversation you left without saving a summary leaves no visible trace on the card
---

## Context

PR 2 adds a conversation with a Claude Code session on each card (decided in
[#0003](0003-conversation-storage.md), option `summary`): the full conversation stays in Claude
Code's own store on the machine that ran it, and when the conversation ends, a summary you can
edit is added to the card. #0003 decided **where the conversation is stored**. It didn't decide
**whether the page shows the earlier messages when you come back**. This card is about that.

**When it matters.** While the page stays open, it can keep the messages it showed you, the way
it keeps what you typed and haven't sent (`src/web/drafts.ts` keeps drafts for the whole
browser session, in memory). The question is what happens **after you reload the page, close
the tab or restart the hub**, on the same machine. On another machine there is no earlier
conversation to show under any option: only the summaries travel (#0003).

**What exists today.** Nothing: the chat area is a placeholder (`src/web/components/CardAssistant.tsx`),
and the card's History (`src/web/components/FeedbackHistory.tsx`) lists notes and other feedback.

**Why not decided yet.** The roadmap that lands with PR #5 (`docs/roadmap.md`, "Where the
conversation lives") said president would never read Claude Code's file and would show only
what it streamed. The review of PR #5 pointed out that this decided something #0003 didn't, and
that it means earlier messages can't be shown after a reload. So it comes to you.

Example: yesterday you asked the agent on #0007 "why not both throw and return results?" and
got a long answer. Today you open #0007 again on the same laptop.

## Option claude-store: Read it back from Claude Code's own store

```
Discuss
  you, yesterday 18:02     Why not both throw and return results?
  agent, yesterday 18:02   Two error paths is exactly what option B's second con warns about...
  [Ask a follow-up...                                    ]
```

The conversation continues in the same session, so the agent and the page agree on what was said.

## Option hub-copy: The hub keeps its own copy, outside git

The same screen. The messages come from a file the hub wrote while you chatted, for example
`~/.local/state/president/chats/president/0007.jsonl`. If Claude Code has already deleted its
copy, the page adds: "The agent no longer remembers this conversation; your next message starts
from the summaries."

## Option summaries: Show only the saved summaries

```
History
  Conversation summary, yesterday
    I now see that B's extra code is one line per call with a helper.

Discuss
  An earlier conversation exists on this machine. Continue it?
  [Ask a follow-up...                                    ]
```

## Technical detail (for the implementer)

- **Where Claude Code keeps it.** `~/.claude/projects/<project>/<session-id>.jsonl`, where `<project>` is the project folder's
  path with every character other than a letter or digit replaced by `-`
  (on this machine, for example `~/.claude/projects/-home-flores-projects-president/`). Claude
  Code's docs say the line format "is internal to Claude Code and changes between versions", so
  president should not decode the file itself.
- **The documented reader.** The Agent SDK has `getSessionMessages(sessionId, { dir })`, which
  "reads user and assistant messages from a past session transcript" and returns a list of
  messages with their `type` and the raw `message`. Option `claude-store` would use it
  (`@anthropic-ai/claude-agent-sdk`, not a dependency today: see `package.json`), not a parser of
  the `.jsonl`. `listSessions({ dir })` can tell whether the session still exists.
- **Retention.** Claude Code deletes transcripts after `cleanupPeriodDays`, 30 by default.
  `--resume` then fails, and #0003 already says to start a fresh session from the summaries.
- **hub-copy** would store what the hub streamed (`claude -p --output-format stream-json`), in a
  folder outside the project (never in `decisions/`), with its own cleanup.

## Sources

- Claude Code docs, sessions, "Where transcripts are stored": "By default, Claude Code stores
  transcripts as JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`" and "The entry
  format is internal to Claude Code and changes between versions, so scripts that parse these
  files directly can break on any release. To build on session data, use `/export` or the script
  interfaces instead." https://code.claude.com/docs/en/sessions
- Claude Code docs, Agent SDK sessions: "Both SDKs expose functions for enumerating sessions on
  disk and reading their messages: `listSessions()` and `getSessionMessages()` in TypeScript ...
  Use them to build custom session pickers, cleanup logic, or transcript viewers."
  https://code.claude.com/docs/en/agent-sdk/sessions
- Claude Code docs, Agent SDK TypeScript reference, `getSessionMessages()`: "Reads user and
  assistant messages from a past session transcript"; the returned `message` is the "Raw message
  payload from the transcript". https://code.claude.com/docs/en/agent-sdk/typescript
- Claude Code docs, the .claude directory: files are deleted "once they're older than
  `cleanupPeriodDays` ... The default is 30 days". https://code.claude.com/docs/en/claude-directory
- Card #0003 and `docs/roadmap.md` (lands with PR #5), "Where the conversation lives"; PR #5
  review, finding D-3 and question Q1.
- Code: `src/web/components/CardAssistant.tsx`, `src/web/components/FeedbackHistory.tsx`,
  `src/web/drafts.ts`, `package.json`.
