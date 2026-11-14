---
id: "2026111459oa"
title: How much of the chat on cards should stay?
status: resolved
kind: choice
priority: normal
created: 2026-11-14T03:00:52Z
created_by: claude-code (reflection)
tags: [chat, scope]
depends_on: []
recommendation:
  option: trim
  why: >-
    Asking about a card is the original idea's research path; the waiting and other-tab
    rules around "Neither" are the most tangled part of the chat code. Pick keep if Undo
    leaving no trace with the agent matters more than simpler code.
options:
  - id: keep
    title: Keep it all
    summary: The chat, summaries and new-options run stay as they are.
    pros:
      - Undo of "Neither" leaves nothing in the agent's memory
    cons:
      - Keeps the most tangled code in the app
  - id: trim
    title: Keep the chat, simplify "Neither"
    summary: >-
      Keep asking, Teach me and summaries; after "Neither" new options start at once and Undo
      cancels them, with no wait and no "Start now" in other tabs (undoes 160s, dfik).
    pros:
      - Simpler chat code, easier to change
    cons:
      - An undone "Neither" stays in the agent's memory and may waste up to $1
  - id: ask-only
    title: Ask only
    summary: >-
      Keep only questions about a card; "Neither" waits for the project's agent (undoes 0007,
      0024).
    pros:
      - Much less code
    cons:
      - Agents no longer get your conversation as a summary
resolution:
  choice: trim
  resolved_at: 2026-11-14T03:18:58Z
---

## Context

The chat took 31 of president's 56 cards and 9.4k added lines. It has been on main since
2026-11-12 and "Neither" since 2026-11-13; no summary is saved yet.
