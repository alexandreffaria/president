---
id: "20261112vzn8"
title: On Windows, what should president's tray icon tell you, beyond keeping the hub running?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T23:39:05Z
created_by: claude-code
tags: [windows, tray, notifications, ux]
depends_on: ["2026111276n0"]
recommendation:
  option: count
  why: >-
    You asked to forget about the hub, and a number you can glance at lets you do that
    without being interrupted: agents often write several cards in a row, and a pop-up for
    each pulls you out of what you are doing. Pick notify instead if you often leave the
    desk or the agents' terminals and want president to call you back; pick quiet if you
    only ever open the hub when an agent tells you to.
options:
  - id: quiet
    title: Only keep it running
    summary: The icon says the hub is running and has a small menu; it says nothing about cards.
    pros:
      - Never distracts you
      - The least to build and to go wrong
    cons:
      - You learn about new cards only from the agents or by opening the hub
  - id: count
    title: Also show how many cards are waiting
    summary: As quiet, plus the number of cards in your Queue on the icon and in its tooltip, updated live; no pop-ups.
    pros:
      - A glance at the taskbar tells you whether anything is waiting
      - Never interrupts you
    cons:
      - Windows 11 hides new tray icons behind the ^ arrow; you see the number only after you drag the icon onto the taskbar once
      - A small number on a 16-pixel icon is hard to read above 9 (shown as 9+)
  - id: notify
    title: Also pop up a Windows notification when a card arrives
    summary: As count, plus a Windows notification when an agent writes a new card, a deferred card comes back, or new options arrive for a card you sent back; clicking it opens that card.
    pros:
      - Reaches you even when the browser is closed and the icon is hidden
      - One click from the notification to the card
    cons:
      - Interrupts you; a burst of cards means several pop-ups, even if they are grouped
      - "Windows' Do not disturb holds them back, so they can arrive late; one more setting to tune (which projects, quiet hours) if it gets noisy"
resolution:
  choice: count
  resolved_at: 2026-11-13T00:04:49Z
applied_at: 2026-11-13T01:32:53Z
---

## Context

You want president running all the time on your Windows workstation: started with Windows,
in the background, with an icon in the notification area (the system tray, at the right of
the taskbar), so you can forget about it. Whatever you pick, the icon has this menu, starts
with Windows (you can turn that off in the menu) and starts the hub again by itself if it
crashes:

```
Open president          (opens http://127.0.0.1:4747 in your browser)
Restart hub             (after you update president)
Start with Windows   ✓
Quit
```

The question is only whether the icon should also tell you about cards. How it is built is
not part of this card: the same small helper does all three options, and the cost of each
is a little more code, not a bigger install.

"Waiting" means the cards in your Queue: open cards and deferred cards whose date has come,
not withdrawn and not waiting on an agent to write new options.

## Option quiet: Only keep it running

The icon looks the same all the time. Tooltip when you hover it:

```
president: running
```

## Option count: Also show how many cards are waiting

The icon carries the number of cards waiting, and the tooltip says it in words:

```
[icon with a small "3"]      tooltip: president: 3 cards waiting
[plain icon]                 tooltip: president: nothing waiting
```

To keep the icon visible on Windows 11: Settings > Personalization > Taskbar > Other system
tray icons > president: On (or drag it out from behind the ^ arrow once). This is a one-time step you do by hand; the
helper can't do it for you.

## Option notify: Also pop up a Windows notification when a card arrives

Everything in count, plus a notification. Cards that arrive within a minute of each other
share one:

```
president
2 new cards: web (1), president (1)
"Should the hub move to your always-on server?"
                                        [Open]
```

Clicking it opens that card (or the Queue, for several). Notes, edits to existing cards
and agents marking cards applied don't notify.

## Sources

- Windows 11 hides new tray icons until you show them; a Microsoft Tech Community answer
  describes dragging them out from the "Show hidden icons" caret:
  https://techcommunity.microsoft.com/discussions/windows11/why-does-windows-11-keep-hiding-my-system-tray-icons-taskbar-icons-missing/4472629/replies/4527572
