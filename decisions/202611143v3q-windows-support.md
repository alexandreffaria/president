---
id: "202611143v3q"
title: How far should Windows support go?
status: resolved
kind: choice
priority: normal
created: 2026-11-14T03:00:52Z
created_by: claude-code (reflection)
tags: [platform, scope]
depends_on: ["20261112vzn8"]
recommendation:
  option: finish-windows
  why: >-
    Your workstation runs Windows (vzn8); this makes the chat work and tested there however
    Claude Code was installed. Pick hub-sync-only if Claude Code there came from the native
    installer (claude.exe), where the chat may already work, untested.
options:
  - id: finish-windows
    title: Make the chat work on Windows too
    summary: >-
      The hub finds npm's claude.cmd as well as claude.exe, and the chat tests run on
      Windows CI.
    pros:
      - Every feature works on both machines
    cons:
      - Windows-only chat bugs to chase (spawning, paths, stopping a run)
  - id: hub-sync-only
    title: Windows is hub and Sync only
    summary: The README says the chat works only on Linux; nothing else changes.
    pros:
      - No more Windows work
    cons:
      - No chat on your workstation if Claude Code came from npm
  - id: drop-windows
    title: Drop Windows
    summary: >-
      Remove Windows support and its tray icon; this fits only if the workstation
      moves to Linux.
    pros:
      - Less code and one CI job fewer
    cons:
      - Undoes vzn8, no president on your workstation
resolution:
  choice: finish-windows
  resolved_at: 2026-11-14T03:18:18Z
---

## Context

On Windows the hub, Sync and the tray icon work, but the chat finds only a claude.exe, never
npm's claude.cmd, and CI skips the chat tests there.
