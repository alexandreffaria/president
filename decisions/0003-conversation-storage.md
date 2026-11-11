---
id: "0003"
title: Where should a card's conversation with the agent be stored?
status: resolved
kind: choice
priority: high
created: 2026-11-11T13:22:03Z
created_by: claude (batch-1 writer)
tags: [pr-2, chat, storage, sync]
depends_on: ["0001"]
recommendation:
  option: summary
  why: >-
    What has to travel between machines and reach the project's agent is what you learned
    and concluded, not every tool call. A short summary in the card does that without
    putting transcripts (which can contain file contents the agent read) into git. If you
    pick "auto" on #0001 this matters even more, since a git-tracked log would mean a commit
    per message.
options:
  - id: card
    title: In the card file itself
    summary: Each exchange is appended to the card (a conversation list in the frontmatter or a "## Conversation" section in the body).
    pros:
      - One file holds everything; whatever syncs cards (#0001) syncs the conversation
      - The project's agent reads it with the card, with no new place to look
    cons:
      - Every message changes the card's revision, so a reply arriving while you decide makes the decision refuse with "the card changed" and an "agent changed this card" notice
      - Cards are capped at 1 MiB, and president update would have to protect the conversation like it protects feedback
      - A long chat buries the question; transcripts can include contents of files the agent read
  - id: sibling
    title: In a sibling file next to the card, git-tracked
    summary: The conversation is written as markdown to decisions/_chat/0007.md, which president's card listing already ignores.
    pros:
      - Visible on every machine after a pull, and readable by any agent or person
      - The card's revision only changes for real card changes, so deciding mid-conversation works as today
    cons:
      - Commits a full transcript, including any file contents or command output the agent quoted, to the project's history
      - More files to commit and more merge conflicts if two machines talk about the same card
      - A readable markdown transcript can't be resumed on another machine (a fresh session is seeded from it); committing Claude Code's raw .jsonl instead can be resumed by path, but its format is internal and changes between versions
  - id: local
    title: Only in Claude Code's own session store
    summary: The card keeps just session_id; the conversation lives in ~/.claude/projects/ on the machine that ran it and is resumed with claude --resume.
    pros:
      - No new storage code and nothing extra in git
      - Resuming is exact, with the agent's full context (files it read, tool results)
    cons:
      - Exists on one machine only; on another machine the card's session_id points at nothing
      - Deleted after 30 days by default (cleanupPeriodDays), and the file format is internal to Claude Code
      - The project's working agent never sees what you discussed unless you also write a note
  - id: summary
    title: A summary in the card, the full log local
    summary: The full session stays in Claude Code's local store (resumed via session_id); when a conversation ends, its conclusions are added to the card as a feedback entry the project's agent reads.
    pros:
      - What you learned and asked for travels with the card and reaches the agent through president pending, like a note
      - No transcript in git; the card grows by a few lines per conversation, not per message
      - Exact resume on the machine that has the session, for 30 days by default (cleanupPeriodDays)
    cons:
      - A summary loses detail; on another machine the conversation restarts from the summary, not from where it was
      - Someone has to write the summary (the session, at the end), and you should be able to read and edit it before it is added
resolution:
  choice: summary
  resolved_at: 2026-11-11T15:28:44Z
---

## Context

PR 2 runs a headless Claude Code session per card (`claude -p --output-format stream-json`),
resumed with the card's `session_id`, a field already reserved in the schema
(`src/core/schema.ts`: "Reserved for the chat panel (headless Claude Code session per card)").
This card is about where the conversation's text lives. It depends on #0001 (who commits your
actions), because anything stored in git travels only as well as #0001 makes it travel.

**Facts that constrain it:**

- **Claude Code's own store is local and temporary.** Transcripts are JSONL files at
  `~/.claude/projects/<project>/<session-id>.jsonl` on the machine that ran them, deleted after
  `cleanupPeriodDays` (30 by default), and their format "is internal to Claude Code and changes
  between versions". `claude -p` sessions don't appear in `claude --continue` or the picker, but
  can be resumed by id with `claude --resume <session-id>`, which finds the session "in any
  project on this machine". `--resume` also accepts "the absolute path to a session's `.jsonl`
  transcript file" (sources below).
- **A card's revision is a hash of the whole file** (`revisionOf` in `src/server/cards.ts`).
  Every human action sends the revision you read and is refused if the file changed since; the
  page then shows what changed. Anything that writes into the card while you read it triggers
  that.
- **Ignored files.** In `decisions/`, files starting with `.` or `_`, `README.md` and non-`.md`
  files are not cards (`isIgnoredFile` in `src/server/cards.ts`), so `decisions/_chat/` is
  invisible to the card listing and the watcher's card logic.
- **Agents learn about your input through `president pending`**, which lists feedback newer than
  the card's `seen_at` (`src/core/pending.ts`). A feedback entry is the existing channel.

## Option card: In the card file itself

```yaml
conversation:
  - at: 2026-11-12T09:00:00Z
    from: human
    text: Why not both throw and return results?
  - at: 2026-11-12T09:00:20Z
    from: agent
    text: Two error paths is exactly what option B's second con warns about ...
```

## Option sibling: In a sibling file next to the card, git-tracked

```
decisions/
  0007-api-errors.md
  _chat/
    0007.md      # "### you, 2026-11-12 09:00" / "### agent" sections, appended per message
```

## Option local: Only in Claude Code's own session store

```yaml
session_id: 3f2c9a8e-1b7d-4c55-9e0a-6d2f8b1c4e77
```

The hub runs `claude -p --resume 3f2c9a8e-... --output-format stream-json "<your message>"` in
the project folder and shows the stream. Nothing else is written.

## Option summary: A summary in the card, the full log local

`session_id` as in "local", plus, when you close the conversation (or decide), a feedback entry
you can edit before it is saved:

```yaml
feedback:
  - at: 2026-11-12T09:14:00Z
    type: chat
    note: >-
      Discussed with the card's agent. I now see that B's extra code is one line per call
      with a helper. Asked it to check whether our HTTP client already throws on 404.
```

(`chat` would be a new feedback type; it could also be a plain `note`.)

## Sources

- Claude Code docs, sessions: "By default, Claude Code stores transcripts as JSONL at
  `~/.claude/projects/<project>/<session-id>.jsonl`" and "The entry format is internal to Claude
  Code and changes between versions, so scripts that parse these files directly can break on any
  release." https://code.claude.com/docs/en/sessions
- Same page: "Claude Code leaves sessions created with `claude -p` or the Agent SDK out of the
  session picker and out of `claude --continue`. You can still resume one by passing its session
  ID to `claude --resume <session-id>`."
- Claude Code docs, the .claude directory: files are deleted "once they're older than
  `cleanupPeriodDays` ... The default is 30 days", and "Transcripts and history are not encrypted
  at rest." https://code.claude.com/docs/en/claude-directory
- Claude Code docs, headless mode: "Use `--continue` to continue the most recent conversation, or
  `--resume` with a session ID to continue a specific conversation." "Claude Code finds the
  session by its ID in any project on this machine." "In place of the session ID, you can pass
  `--resume` the absolute path to a session's `.jsonl` transcript file, and Claude Code continues
  the conversation stored in that file." https://code.claude.com/docs/en/headless
- Code: `src/core/schema.ts` (`session_id`), `src/server/cards.ts` (`revisionOf`,
  `isIgnoredFile`, `actOnCard`), `src/core/pending.ts`, docs/card-format.md ("A card file must be
  at most 1 MiB").
