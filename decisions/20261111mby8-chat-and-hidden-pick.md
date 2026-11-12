---
id: "20261111mby8"
title: Before you reveal the agent's pick, may the card's chat name it or argue for an option?
status: resolved
kind: choice
priority: high
created: 2026-11-11T18:21:19Z
created_by: claude (batch-3 writer)
tags: [pr-2, chat, recommendation, bias]
depends_on: ["0008", "0005", "0007"]
recommendation:
  option: neutral
  why: >-
    Hiding the pick on the page while the chat states it a click away undoes what you chose
    in 0008, and Teach me already asks for your prediction first. An instruction carried with
    every message keeps the chat to explaining and comparing until you press r, at no extra
    cost. Keeping the card from the session (withheld) is stronger for the card file itself
    but costs the chat its view of other cards, doesn't cover other files that quote a
    pick, and still needs the same instruction, since the session would otherwise form and
    share a pick of its own. Pick free if you find you reveal the pick first anyway.
options:
  - id: free
    title: Yes, the chat may say anything
    summary: The page hides the pick, but the chat answers freely; asked "what would you choose?", it says which option the card recommends and why.
    pros:
      - Nothing to build; the chat simply answers what you ask
      - A direct question gets a direct answer
    cons:
      - The pick is one question away, and the chat may volunteer it unasked (for example while teaching)
      - Hiding it on the page then protects little
  - id: neutral
    title: No, the chat stays neutral until you reveal it
    summary: Until you press r, the chat explains and compares the options without naming the card's pick or recommending one of its own; asked directly, it says the pick is behind r. After you reveal it, the chat is free.
    pros:
      - Keeps 0008's "form your own view first" in the chat as well as on the page
      - Teach me's "predict first, then walk through" fits it as is
      - Nothing extra to build beyond a line of instructions per message
    cons:
      - It rests on the session following an instruction; it can still slip, and no check catches it
      - Even facts it gives neutrally can point at one option, as the example below does
      - Questions like "which is safer?" get a comparison, not an answer, until you press r
  - id: withheld
    title: No, and the session can't see the pick at all
    summary: The hub hands the session the card without its recommendation and blocks it from reading the card files; once you press r, the hub tells it the pick in your next message.
    pros:
      - The pick can't come from the card file before you reveal it; the session is never shown it there
      - That rests on what the session can read, not on it following an instruction
    cons:
      - The session can't read any card in decisions/ itself (earlier decisions, depends_on), so the hub has to hand it those too
      - It still needs neutral's instruction; otherwise the session forms a pick of its own and argues for it, which anchors you the same way
      - The block is best-effort for Grep and Glob (the docs' words), and another project file, such as docs that quote a card, can still show the pick
      - More to build and test (the blocking rule, the reworked card text, reveals mid-conversation)
resolution:
  choice: neutral
  resolved_at: 2026-11-12T01:55:35Z
applied_at: 2026-11-12T03:11:02Z
---

## Context

**What 0008 decided.** On [0008](0008-recommendation-placement.md) you chose `hidden`: the
card's pick (its `recommendation`) shows only after you press a key or a **Show the agent's
pick** button, so you form your own view first.

**The gap.** PR 2 adds a conversation with a Claude Code session on each card, with **Teach
me** ([0005](0005-teach-me-format.md), a worked example that asks you to predict first) and
new options after "neither" ([0007](0007-neither-try-again.md)). The session reads the
project's files, the card included, so it knows the `recommendation` and nothing stops it
naming it before you press `r` (`docs/roadmap.md`, "Cross-card consequences", and "Needs a
card", item 5). New options from 0007 come with a new recommendation, which the page hides
the same way.

Example, on an invented card, #0042 "Should failed requests throw or return a result?" (the
card recommends B),
before you press `r`, you ask: "Which one would you go with?"

## Option free: Yes, the chat may say anything

> **Agent:** The card recommends B, returning a result object: most of your calls fail in
> expected ways (offline, timed out), and the compiler would remind you to handle each.

## Option neutral: No, the chat stays neutral until you reveal it

> **Agent:** The card's pick is behind **r**; I'll keep my view out of it until you've formed
> yours. What decides it is how often a call fails in an expected way: if often, B makes each
> failure impossible to ignore; if rarely, A's shorter call sites weigh more. In this project,
> 12 of the 15 calls go through trip sync, which runs offline. Which matters more to you?

After `r`, the same question gets free's answer.

## Option withheld: No, and the session can't see the pick at all

The same answer as neutral, but the session never had the pick: the hub sent it the card's
context and options without the `recommendation`, and reading any file in `decisions/` is
refused. After you press `r`, the hub's next message says "The human has revealed the card's
pick: B, because ...".

## Technical detail (for the implementer)

- **Where the instruction goes.** The reveal state can't simply go in the system prompt:
  Claude Code records the system prompt "once per conversation and reuse[s] it verbatim on
  every request and resume ... even when a later launch passes different text"
  (`--system-prompt-snapshot`, on by default). So it travels with each message (or, with
  `--system-prompt-snapshot off`, "the prompt is rendered fresh every request", in a per-run
  `--append-system-prompt`). The hub adds a line such as "The human has not revealed the
  card's pick" to every message until `r`, then "has revealed it".
- **What "revealed" means.** "Revealed" means revealed on that card as
  [card 20261111nsaj](20261111nsaj-revealed-pick-duration.md) defines it. Once the chat has
  named the pick, the conversation's history keeps it, so the line sent stays "revealed" for
  that conversation, even if the page hides the pick again later.
- **Blocking reads (withheld).** Add `--disallowedTools "Read(./decisions/**)"` to the run of
  #0004. Deny rules win over everything ("Rules are evaluated in order: deny, then ask, then
  allow"), and Claude Code "makes a best-effort attempt to apply `Read(path)` deny rules to all
  built-in tools that read files like Grep and Glob" (best effort, not a guarantee). The hub
  then sends the card's text itself, without `recommendation`, and the cards in its
  `depends_on`.
- The new-options run (0007) still writes a `recommendation` with the new options; the page
  hides it like any other, so this card doesn't change that run.

## Sources

- Cards [0008](0008-recommendation-placement.md) (`hidden`), [0005](0005-teach-me-format.md)
  (`worked`), [0007](0007-neither-try-again.md) (`spawn`), and
  [0004](0004-chat-session-permissions.md) (the session reads the project: Read, Grep, Glob,
  WebSearch, WebFetch).
- `docs/roadmap.md`, "Cross-card consequences" ("#0008 `hidden` + the chat") and "Needs a
  card", item 5.
- `claude --help` (2.1.302), `--system-prompt-snapshot`: "every later request and resume sends
  the record as-is, even when a later launch passes different text, until the conversation is
  compacted"; "off: never record; the prompt is rendered fresh every request (for iterating on
  prompt text). No effect where system-prompt recording is not yet enabled.";
  `--disallowedTools`: "list of tool names to deny (e.g. \"Bash(git *) Edit\")".
- Claude Code docs, permissions: "Rules are evaluated in order: deny, then ask, then allow";
  "To block Claude's file tools from reading a file or directory, add a `Read` deny rule for
  its path, such as `Read(./.env)` or `Read(./secrets/**)`"; "Claude makes a best-effort
  attempt to apply `Read(path)` deny rules to all built-in tools that read files like Grep and
  Glob." https://code.claude.com/docs/en/permissions
