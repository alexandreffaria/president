---
id: "20261112ah6a"
title: Should a machine offer to write new options for a "neither" you made on another machine?
status: resolved
kind: choice
priority: low
created: 2026-11-12T20:45:56Z
created_by: claude (PR 29 card writer)
tags: [pr-2, neither, sync, multi-machine]
depends_on: ["0007", "0021", "0001", "2026111276n0", "20261112dfik"]
recommendation:
  option: wait
  why: >-
    This only happens when a "neither" reaches a machine by Sync with no run done for it,
    which should be rare, and that machine can't tell a run that failed from one still
    going on the other machine or done and not synced yet. In those last two cases a second
    run writes the card on both machines and the next Sync stops with "changed on both
    machines", a manual git fix. Waiting costs time only. Pick offer if you often switch
    machines right after a "neither" and would rather risk that fix than wait.
options:
  - id: wait
    title: Leave it to the first machine or the project's agent (as built)
    summary: >-
      The second machine shows the card under "Waiting for new options" with no button; the
      first machine's Try again or Start now, or the project's agent, writes the options.
    pros:
      - Never two runs for one note, so no Sync conflict from this
      - Built and tested in pull request 29
    cons:
      - If you left the first machine with a failed run, the card waits until you go back to it or an agent runs in the project
  - id: offer
    title: Offer "Write them here" on the second machine
    summary: >-
      A card waiting for new options with no run recorded on this machine shows a button
      that starts a run here, never on its own.
    pros:
      - Works with the first machine off, the reason 0007 picked spawn ("works in projects where no agent is running")
    cons:
      - If the first machine's run is still going on or done but not synced, both machines write the card and Sync can stop with "changed on both machines"
      - The run here can't see the conversation from the first machine (0021), only the card's summaries
      - One more Claude Code run (up to $1) if the first machine also writes them
resolution:
  choice: wait
  resolved_at: 2026-11-12T21:54:51Z
applied_at: 2026-11-13T19:32:59Z
---

## Context

The hub's "to start / started" record for a new-options run (pull request 29) is kept per
machine, like the session ids (0021 `local`; 2026111276n0 kept a hub on each machine). A
"neither" that reaches another machine by Sync (0001) has no record there, so that machine
doesn't offer Start now or Try again. The card just sits under "Waiting for new options"
until the first machine or the project's agent writes the options.

Example: on the laptop at 21:00 you reject #0042's options. The run fails ("Couldn't write
new options ... [Try again]"); you press Sync and close the laptop. At 22:00 on the desktop
you press Sync.

## Option wait: Leave it to the first machine or the project's agent (as built)

```
Desktop, Waiting for new options
  #0042  Where should the app keep trips?
```

Opening #0042 shows your note and no button.

## Option offer: Offer "Write them here" on the second machine

```
Desktop, #0042
  Waiting for new options from your note at 21:00, made on another machine.
  If that machine is still writing them, wait for its Sync.   [Write them here]
```

## Sources

- [0021](0021-session-id-per-machine.md) `local`; [2026111276n0](2026111276n0-hub-on-your-server.md) `local`.
- [0001](0001-sync-across-machines.md): "If the same card changed on both machines, Sync puts
  everything back as it was, keeps your answers in a local commit and says \"Not synced: 0001
  changed on both machines\". Fixing that is a manual git step".
- [0007](0007-neither-try-again.md) `spawn`, pro: "Works in projects where no agent is running".
- Pull request 29, "Needs a card" item 3.
