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
  option: hub-copy
  why: >-
    The hub already has to read the messages Claude Code sends while you chat, to show the
    reply; saving them as they are shown and showing them again later reuses that, needs no
    new dependency, and no Claude Code update can break it. Reading Claude Code's own store
    looks cheaper, but its documented reader comes in a 0.x developer kit of about 340 MB that
    has to follow your Claude Code version, and it still hands back each message in Claude
    Code's raw form. Pick claude-store if you'd rather president keep no copy of its own, and
    summaries if you never reread conversations and only care about what you concluded.
options:
  - id: claude-store
    title: Read it back from Claude Code's own store
    summary: When you open a card, the page loads the earlier messages from the session Claude Code saved on this machine, the same one the chat continues.
    pros:
      - What you see is the same conversation the agent continues
      - No second copy of any transcript; president stores nothing new
      - Claude Code's developer kit has a documented function that finds the conversation and returns its messages, so president doesn't read the file format itself
    cons:
      - Gone once Claude Code cleans it up (after 30 days by default); the page then shows only the summaries
      - Adds Claude Code's developer kit (the Agent SDK, still at version 0.x, about 340 MB with the Claude Code copy it installs) to the hub, and it has to be kept up to date with your Claude Code
      - Each message's content is undocumented (typed `unknown`), so the page relies on the shape Claude Code writes today, which an update can change
  - id: hub-copy
    title: The hub keeps its own copy, outside git
    summary: The hub saves each message it showed you to a file of its own on this machine (outside the project, never committed) and shows that file when you come back.
    pros:
      - Shows exactly what you saw, in president's own format, which no Claude Code update can break
      - Lasts as long as you want (president sets its own cleanup), even after Claude Code has deleted its copy
      - Uses the messages the hub already reads to show replies; no new dependency
    cons:
      - A second copy of every conversation on disk, including any file contents the agent quoted, with its own cleanup to build
      - After Claude Code deletes its copy, the page shows a conversation the agent no longer remembers; your next message starts from the summaries
      - New storage code in the hub (writing, reading, cleanup, a project or card that is removed, renamed or renumbered)
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

**Why not decided yet.** An earlier draft of `docs/roadmap.md` in PR #5 said president would
never parse Claude Code's file and the page would show what the hub streamed. The review of
PR #5 pointed out that this decided something #0003 didn't, and that it means earlier messages
can't be shown after a reload; the merged roadmap now leaves it open and points to this card.

Example, on an invented card "#0042 Should failed requests throw or return a result?":
yesterday you asked its agent "why not do both?" and got a long answer. Today you open #0042
again on the same laptop.

## Option claude-store: Read it back from Claude Code's own store

```
Discuss
  you, yesterday 18:02     Why not do both?
  agent, yesterday 18:02   Two error paths is exactly what option B's second con warns about...
  [Ask a follow-up...                                    ]
```

The conversation continues in the same session, so the agent and the page agree on what was said.

## Option hub-copy: The hub keeps its own copy, outside git

The same screen. The messages come from a file the hub wrote while you chatted, in president's
state folder (`$XDG_STATE_HOME/president/`, by default `~/.local/state/president/`), for example
`~/.local/state/president/chats/shop/0042.jsonl`. If Claude Code has already deleted its copy,
the page adds: "The agent no longer remembers this conversation; your next message starts from
the summaries."

Continuing the conversation still resumes Claude Code's session, as #0003 decided; this file is
only for showing it.

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
  `SessionMessage` entries with their `type` and a `message` of type `unknown`, documented only
  as "Raw message payload from the transcript". So the SDK finds the file and splits it into
  messages, but the content of each message is still in Claude Code's own form. Option
  `claude-store` would use it, not a parser of the `.jsonl`. `listSessions({ dir })` can tell
  whether the session still exists.
- **What the SDK costs.** `@anthropic-ai/claude-agent-sdk` is at 0.3.322 on npm (not a
  dependency today: see `package.json`). It installs a native Claude Code binary for the
  platform as an optional dependency: `@anthropic-ai/claude-agent-sdk-linux-x64` 0.3.322 is
  341,914,717 bytes unpacked (`-darwin-arm64` 323,703,048). That copy is a different version
  from the `claude` installed here (2.1.302), which is the one that writes the transcripts, so
  the SDK has to be updated along with Claude Code to keep reading them.
- **Retention.** Claude Code deletes transcripts after `cleanupPeriodDays`, 30 by default.
  `--resume` then fails, and #0003 already says to start a fresh session from the summaries.
- **hub-copy** would store the messages the hub streamed and showed (`claude -p --output-format
  stream-json`, which PR 2 reads anyway), in president's own format, in a folder outside the
  project (never in `decisions/`), with its own cleanup. `$XDG_STATE_HOME` is the XDG folder for
  "state data that should persist between (application) restarts", such as "history"; the
  project registry stays in `$XDG_CONFIG_HOME/president/`, the folder for configuration.

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
  assistant messages from a past session transcript"; `SessionMessage` field `message`, type
  `unknown`: "Raw message payload from the transcript".
  https://code.claude.com/docs/en/agent-sdk/typescript
- npm, checked 2026-11-11: `npm view @anthropic-ai/claude-agent-sdk version optionalDependencies`
  (0.3.322, eight per-platform `@anthropic-ai/claude-agent-sdk-<platform>` packages) and
  `npm view @anthropic-ai/claude-agent-sdk-linux-x64@0.3.322 dist.unpackedSize description`
  (341914717, "Native CLI binary for @anthropic-ai/claude-agent-sdk on linux-x64");
  `claude --version`: 2.1.302.
- Claude Code docs, the .claude directory: files are deleted "once they're older than
  `cleanupPeriodDays` ... The default is 30 days". https://code.claude.com/docs/en/claude-directory
- XDG Base Directory Specification: "$XDG_STATE_HOME defines the base directory relative to which
  user-specific state files should be stored", default `$HOME/.local/state`, for "actions history
  (logs, history, recently used files, …)". https://specifications.freedesktop.org/basedir/latest/
- Card #0003 and `docs/roadmap.md` (on main since PR #5), "Where the conversation lives"; PR #5
  review, finding D-3 and question Q1.
- Code: `src/web/components/CardAssistant.tsx`, `src/web/components/FeedbackHistory.tsx`,
  `src/web/drafts.ts`, `package.json`.
