---
id: "202611128a05"
title: After "Ask for new options", should the page stay on the card or move to the next one?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:45:56Z
created_by: claude (PR 29 card writer)
tags: [pr-2, chat, neither, queue]
depends_on: ["0007", "20261112160s", "202611111gpm"]
recommendation:
  option: leave
  why: >-
    The run takes a minute or two, so staying mostly means watching "Writing new options…"
    and then pressing j anyway. Leaving keeps the rhythm Decide and Defer have, and 0007's
    own sketch has the card leave the queue and come back with the new options. You lose
    the chance to see "Sending when Undo closes", but Undo itself works from the notice
    wherever you are. Pick stay if you'd rather read the agent's reply and the new options
    the moment they land, while your note is fresh, at the cost of one j per "neither".
options:
  - id: leave
    title: Move to the next card (as built)
    summary: >-
      Ask for new options records your note, shows "Asked for new options on #0042." with
      Undo, and goes to the next card, as today; the card is back in the queue once the new
      options are written.
    pros:
      - Same as Decide and Defer; you keep going through the queue while the run works
      - Matches 0007's sketch ("out of the queue, under Waiting for new options" until the options come back)
      - Built and tested in pull request 29
    cons:
      - You see "Sending when Undo closes" and the agent's reply only if you go back to the card
      - "When the new options arrive you are on another card; #0042 waits its turn in the queue"
  - id: stay
    title: Stay on the card
    summary: >-
      The Neither panel closes and the page stays on #0042, with the conversation panel open
      showing your pending message, then "Writing new options…", then the new options on the
      card; j moves on when you want.
    pros:
      - You see what 160s sketched right after pressing, and the reply and new options as they land
      - The new options come while you still have your note in mind, the point of 0007's spawn
    cons:
      - One more key (j) per "neither" if you don't want to wait
      - Unlike every other action that takes a card out of the queue, which all move on
resolution:
  choice: leave
  resolved_at: 2026-11-12T21:53:49Z
applied_at: 2026-11-13T19:32:58Z
---

## Context

Today **Ask for new options** in the Neither panel moves on to the next card, like Decide and
Defer. Pull request 29 starts the new-options run once the Undo notice closes (20261112160s)
and kept that move.

No card says whether to stay. 0007's sketch has the card leave the queue ("Writing new
options...", "out of the queue, under Waiting for new options") and come back a minute or two
later. 160s's sketch shows the panel "Right after pressing Ask for new options" with "Sending
when Undo closes", which you only see if you stay or come back while the notice is up.

Example: on #0042 you press `n`, write "Both assume a server. Compare on-device storage
only." and press Ctrl ⏎ at 21:00.

## Option leave: Move to the next card (as built)

```
#0051 is on screen.
Asked for new options on #0042.                                [Undo u]
```

Going back to #0042 within 10 seconds shows "Neither: ... Sending when Undo closes"; later,
"Writing new options…" or the new options.

## Option stay: Stay on the card

```
#0042, conversation panel open
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
                 Sending when Undo closes
Asked for new options on #0042.                                [Undo u]

21:00:10  agent: Writing new options…
21:02     New options, written from your note at 21:00.   (j: next card)
```

## Sources

- [0007](0007-neither-try-again.md) `spawn`, summary: "the card comes back to the queue a
  minute or two later"; sketch: "21:00 Card: \"Writing new options...\" (out of the queue,
  under \"Waiting for new options\")".
- [20261112160s](20261112160s-undo-new-options-turn.md) `wait-out`, sketch "Right after
  pressing Ask for new options".
- Pull request 29, "Implementer choices" and "Needs a card" item 1; `src/web/views/CardView.tsx`
  (`leave: true`, "Asked for new options on #…").
