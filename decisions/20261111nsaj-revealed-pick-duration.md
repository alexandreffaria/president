---
id: "20261111nsaj"
title: Once you reveal the agent's pick on a card, how long should it stay revealed?
status: resolved
kind: choice
priority: normal
created: 2026-11-11T18:21:18Z
created_by: claude (batch-3 writer)
tags: [ux, recommendation, bias]
depends_on: ["0008", "20261111mby8"]
recommendation:
  option: visit
  why: >-
    You chose to hide the pick so you form your own view first, and you come back to a card
    mostly when something changed (new options after "neither", a snooze that ended), which
    is exactly when a fresh look helps; the new options also come with a new pick. One key
    per return is the cost. The fresh look is weaker on a card you discussed after
    revealing, since the conversation still shows what the chat said about the pick; the
    other options don't hide it there either. Pick browser if you often flip back and forth between cards in one sitting and find
    pressing r again tedious.
options:
  - id: visit
    title: Until you leave the card
    summary: The pick shows until you move to another card or the queue; coming back, it is hidden again.
    pros:
      - Every time you come back you look at the options fresh, which is the point of hiding it, unless you discussed the card after revealing
      - Nothing to store or keep in step with new options
    cons:
      - Flipping back to a card you just looked at (j then k) means pressing r again
      - You can't tell at a glance whether you already looked at the pick on that card
      - On a card you discussed after revealing, the conversation panel still shows what the chat said about the pick
  - id: browser
    title: Remembered in this browser
    summary: Once revealed, the pick stays shown on that card in this browser, after reloads and hub restarts, until the card gets a new recommendation.
    pros:
      - Reveal once per card, however often you come back
      - Already a pattern in the hub (the project filter is remembered the same way)
    cons:
      - On another machine or browser it is hidden again, though a conversation summary you saved on the card can still name it
      - Coming back days later, the pick is in view before you have re-read the options
  - id: recorded
    title: Recorded in the card
    summary: Revealing writes the time into the card (for example revealed_at), so it stays shown everywhere, and the applying agent can see whether you looked at its pick before deciding.
    pros:
      - The same on every machine once synced
      - Tells agents whether you decided with or without seeing their pick, a signal about how much the recommendation sways you
    cons:
      - Pressing r changes the card file, so it shows up in Sync and can conflict with a change on another machine
      - A look at the pick becomes a permanent record you may not want, and one more field in the format
resolution:
  choice: visit
  resolved_at: 2026-11-12T01:57:49Z
applied_at: 2026-11-12T03:11:02Z
---

## Context

**What 0008 decided.** On [0008](0008-recommendation-placement.md) you chose `hidden`: a card
shows no "Recommended" tag and no "The agent's take" until you press a key (the card suggests
`r`) or a **Show the agent's pick** button, and "once revealed, it stays shown on that card".
How long "stays" lasts was left open (`docs/roadmap.md`, "The recommendation is hidden until
you ask", and "Needs a card", item 4).

**When it matters.** You come back to a card when you moved past it in the queue (`j`/`k`),
when it returns from a snooze, after "neither" brings new options (whose new pick is hidden
again, `docs/roadmap.md`, "Neither: new options right away"), or after a reload.

**What the hub remembers today.** What you type but don't send is kept per card in the page's
memory until the page reloads (`src/web/drafts.ts`). The project filter is kept in the
browser's storage, which survives reloads (`localStorage`, key `president.projectFilter`, in
`src/web/hub.tsx`). Nothing about a card's display is written to the card.

**The conversation remembers too.** Under [0002](0002-conversation-placement.md) the panel is
open by default once a card has a conversation, and under
[0018](0018-show-earlier-conversation.md) it shows the earlier messages from the hub's copy.
If you reveal the pick and then discuss it, the chat (now free to name it, whatever
[the card on the chat and the hidden pick](20261111mby8-chat-and-hidden-pick.md) decides)
may say "you went with B". Hiding the pick on the page again doesn't remove that message.
This card depends on that one, since how much the chat may say before you reveal changes
how much hiding on the page protects.

Example: you open #0042, press `r`, see the agent picked option B, move to #0043 with `j`,
then come back with `k`. Tomorrow you open #0042 again.

## Option visit: Until you leave the card

```
k back to #0042:   [1] Throw typed errors
                   [2] Return a result object
                                              Show the agent's pick  r
```

Tomorrow: the same.

## Option browser: Remembered in this browser

```
k back to #0042:   [2] Return a result object      Recommended
                   The agent's take: 2. Return a result object — ...
```

Tomorrow, same browser: the same. On your other machine: hidden.

## Option recorded: Recorded in the card

Pressing `r` adds to the card:

```yaml
revealed_at: 2026-11-11T19:02:00Z
```

Tomorrow, on any machine after Sync: shown. `president pending` could print "decided after
seeing the agent's pick".

## Technical detail (for the implementer)

- `visit`: state in the card view, reset when the card changes.
- `browser`: a set of revealed cards in `localStorage`, keyed by project, card id and the
  recommendation itself (option and text), so new options from 0007 are hidden again. Reads and
  writes wrapped in try/catch, as the project filter does.
- `recorded`: a hub action that writes the field, allowed on open and deferred cards; it is a
  card write, so the 10-second Undo window rules apply to it like to any other.

## Sources

- Card [0008](0008-recommendation-placement.md), option `hidden`; `docs/roadmap.md`, "The
  recommendation is hidden until you ask (#0008)" and "Needs a card", item 4.
- Code: `src/web/drafts.ts` (drafts kept "for the whole session", in memory),
  `src/web/hub.tsx` (`FILTER_KEY = "president.projectFilter"` in `localStorage`),
  `src/web/views/CardView.tsx` and `src/web/components/OptionCard.tsx` (the tag and "The
  agent's take").
