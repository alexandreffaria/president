---
id: "20261112dfik"
title: While your "Neither" message waits for the Undo notice to close, what should another tab open on the same card show?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T03:24:47Z
created_by: claude (PR 15 card writer)
tags: [pr-2, chat, neither, undo, tabs]
depends_on: ["20261112160s", "0012", "202611111gpm", "0007"]
recommendation:
  option: refuse-undo
  why: >-
    This only happens if you have the same card open in two tabs and act in the second one
    within about 10 seconds, which should be rare. refuse-undo handles it the way Undo already
    works (0012 kept that rule): once something else has changed the card after your action,
    another tab included, Undo is refused instead of pretending to work, and starting the run
    from another tab counts the same way. The guarantee you picked wait-out for
    still holds: an Undo that goes through always means nothing reached the agent. It is
    also the least to build. The cost is that the second tab offers "Start now" while the
    notice may still be waiting elsewhere, so a click there can take Undo away from the
    first tab. Pick shared-pending if you want the second tab to tell you exactly what is
    going on and never offer a start while Undo is still offered. Pick hub-clock if you
    would rather also stop losing the run when you close the tab too early, and can give
    up the notice pausing while you hover over it.
options:
  - id: shared-pending
    title: Every tab shows it as waiting, until the first tab's notice closes
    summary: >-
      The hub tells every open tab that the run is waiting for Undo in another tab, so the
      second tab shows "Sending when Undo closes in your other tab" with no start button;
      it offers Try again only if the first tab is closed or reloaded before its notice
      goes away.
    pros:
      - Every tab tells the truth about the run, and none offers a start while Undo is still offered (but see the last con)
      - Undo keeps meaning "nothing reached the agent"; it is refused only in the rare case below, when the first tab lost its connection and you pressed Try again in the second
      - The second tab learns at once when the run starts, or when it didn't start because the first tab went away
    cons:
      - >-
        The most to build: today a tab only listens to the hub, which sends "these cards
        changed" and nothing more; each tab must now tell the hub when its notice opens and
        closes, and the hub must notice when that tab goes away
      - While you hover over the notice in the first tab, the second tab can only wait, and it doesn't say for how long
      - If the first tab loses its connection to the hub for a moment, the second tab may briefly show Try again although the notice is still there; pressing it then starts the run, and the first tab's Undo is refused as in refuse-undo
  - id: refuse-undo
    title: The second tab can start the run, and Undo is then refused
    summary: >-
      The second tab says the run hasn't started yet and offers "Start now"; pressing it
      starts the run, and Undo in the first tab is then refused with "Couldn't undo: the
      run for this note already started from another tab", as 0012 already does when
      another tab changed the card.
    pros:
      - Little to build, a check in Undo, a short wait message, and a "cards changed" event when the run starts; tabs still send nothing to the hub
      - Follows the rule Undo already has (0012), that once another tab or an agent has changed the card after your action, Undo says it can't instead of half-working
      - An Undo that goes through still always means nothing reached the agent
    cons:
      - You can take Undo away from yourself with one click in the second tab, though only by pressing "Start now" there
      - The second tab doesn't know whether a notice is still waiting elsewhere, so its message has to say "if"
      - The page can't tell a notice still waiting from a tab you closed early, so wait-out's "didn't start" message and Try again become this hedged "hasn't started ... Start now" in both cases
      - If you undo in the first tab after starting the run in the second, your note stays sent and the new options still come
  - id: wait-a-minute
    title: The second tab waits a minute before offering Try again
    summary: >-
      For the first minute after your note, a tab that opens the card shows "Waiting for
      Undo in another tab" with no button; after that it shows "didn't start" and Try again
      as wait-out already says, and if you press it while the first tab's notice is somehow
      still open (you have hovered over it for over a minute), that Undo is refused as in
      refuse-undo.
    pros:
      - The second tab never offers a start while the first tab's notice is shown in normal use (10 seconds, or a little more while you hover)
      - Little more to build than refuse-undo; the hub only needs the note's time, which it has
      - The refused Undo is left for a case that should almost never happen
    cons:
      - If you closed the first tab early, the second tab still makes you wait up to a minute before you can start the run
      - The minute is a guess, not a fact the hub knows; the message "in another tab" may be wrong (that tab may be gone)
      - Two rules to explain instead of one, the wait and the refusal behind it
  - id: hub-clock
    title: The hub runs the countdown, and every tab follows it
    summary: >-
      The hub, not the page, starts the run 10 seconds after your note unless Undo comes
      first; every tab shows "Sending in 7 s" with Undo, and closing a tab no longer stops
      the run, but the notice no longer pauses while you hover over it or it has keyboard
      focus.
    pros:
      - Every tab shows the same countdown and can undo, so there is nothing to coordinate
      - Also removes wait-out's other cost, a run that doesn't start because you closed or reloaded the tab within those seconds; no "didn't start" message for this case
      - Each run starts after exactly 10 seconds, never longer
    cons:
      - The notice for this one action no longer pauses while you hover over it or tab to it, which the other Undo notices do so that nobody has to race the timer (`toast.tsx`)
      - Changes two details of wait-out you already decided (the pause on hover, and the tab-closed case), not only the second tab
      - More to build than refuse-undo; the hub needs a timer per card and must tell every tab about it
resolution:
  choice: refuse-undo
  resolved_at: 2026-11-12T03:57:05Z
applied_at: 2026-11-12T06:48:13Z
---

## Context

**What is already decided.**

- [0007](0007-neither-try-again.md) `spawn`: **Ask for new options**, in the Neither panel,
  records your note and starts an agent run that writes new options.
- [202611111gpm](202611111gpm-new-options-run.md) `shown-no-reminder`: that run is a turn in the
  card's conversation; a run that fails shows "Couldn't write new options ... [Try again]".
- [0012](0012-undo-history.md) `hybrid`: after any action a notice offers **Undo** for 10
  seconds. Undoing a "neither" puts the card back with no trace. Undo is already refused "if
  anything wrote the card after the action (an agent applying it, another tab)".
- [20261112160s](20261112160s-undo-new-options-turn.md) `wait-out`: your "Neither" message shows
  in the panel at once, marked "Sending when Undo closes", and reaches the agent only once the
  Undo notice is gone (10 seconds, longer while you hover over it). So an Undo always means
  nothing reached the agent. If you close or reload the tab before the notice goes away, the run
  doesn't start, and a page that later opens the card "while no Undo notice is waiting on it"
  says "The run for your note at 21:00 didn't start" and offers **Try again**.

**What is left open.** The Undo notice lives only in the tab where you pressed the button. Another
tab (or window) on the same card can't see it: the hub tells tabs only "the cards of this project
changed" and has no idea a notice is waiting somewhere. As wait-out is written, the second tab
would think nothing is waiting and offer Try again. If you press it, the run starts and your
message reaches the agent while the first tab still offers Undo. An Undo there would then put the
card back but not take the message back from the agent, which is exactly what wait-out was chosen
to prevent. Pull request 15 lists it as "Needs a card" item 1; this card answers it.

**When it happens.** Only when the same card is open in two tabs and you look at the second one
within the few seconds the notice is shown. It blocks only this part of wait-out; the rest can be
built now.

**Under every option:** the hub starts at most one run for a note and never starts one for a
note already undone (Undo clears its "to start" record). An Undo and a start are handled one
after the other: the first tab's notice closing after the run started never starts a second
one, and a start that comes at the same moment as an Undo either starts the run (and the Undo
is refused) or finds the note already gone.

Example used below: at 21:00 in tab A you write "Both assume a server. Compare on-device storage
only." on #0042 and press Ask for new options. Tab B already has #0042 open. Three seconds later
you switch to tab B. (Tab B first shows today's "You changed this card in another president
tab." notice, as for any change made in another tab; the sketches below show what follows it.)

## Option shared-pending: Every tab shows it as waiting, until the first tab's notice closes

```
Tab B, 21:00:03
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
                 Sending when Undo closes in your other tab

Tab B, when tab A's notice closes (21:00:10)
  agent, 21:00   Writing new options...

Tab B, if you had closed tab A at 21:00:05 instead
  The run for your note at 21:00 didn't start. The card waits for the
  project's agent, as before.   [Try again]
```

Undo in tab A works as long as its notice is shown, except in one rare case: tab A lost its
connection to the hub for a moment and you pressed Try again in tab B just then. That Undo is
refused, as in refuse-undo.

## Option refuse-undo: The second tab can start the run, and Undo is then refused

```
Tab B, 21:00:03
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
  The run for your note at 21:00 hasn't started. If another tab still shows
  its Undo notice, it starts when that closes.   [Start now]

You press Start now in tab B, then go back to tab A and press u:
  Tab A   Couldn't undo: the run for this note already started from another tab.
```

If you don't press Start now, tab B replaces it with "Writing new options..." once tab A's
notice closes and the run starts (the hub tells every tab when a run starts). If tab A was
closed early, Start now is the Try again wait-out already describes.

## Option wait-a-minute: The second tab waits a minute before offering Try again

```
Tab B, 21:00:03 to 21:01:00
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
                 Waiting for Undo in another tab

Tab B, from 21:01:00, if the run still hasn't started
  The run for your note at 21:00 didn't start. The card waits for the
  project's agent, as before.   [Try again]
```

Normally tab A's notice closes at 21:00:10 and tab B shows the run starting (the hub tells
every tab, as in refuse-undo). Only if you keep the pointer on tab A's notice for over a minute
and then press Try again in tab B is tab A's Undo refused, with the same message as in
refuse-undo.

## Option hub-clock: The hub runs the countdown, and every tab follows it

```
Tab A and tab B, 21:00:03
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
                 Sending in 7 s   [Undo u]

Both tabs, 21:00:10
  agent, 21:00   Writing new options...
```

Undo works from either tab until the hub starts the run. Hovering over the notice doesn't hold
it. Closing or reloading tab A doesn't stop the run, so the "didn't start" message is no longer
needed for this case.

## Technical detail (for the implementer)

- Today's live events (`src/core/api.ts`): `HubEvent` is only
  `{ type: "cards"; project }` or `{ type: "projects" }`, sent to every tab over
  `/api/events` (`src/server/app.ts`, `src/web/live.ts`). Tabs never send anything on the socket
  and the hub doesn't know which tab is which.
- The Undo journal (`src/server/cards.ts`) is in hub memory, one entry per card file
  (`UNDO_TTL_MS` 30 minutes), and `undoLastAction` refuses when the card's revision or file stamp
  changed. Starting a run doesn't write the card, so the journal alone can't tell that the run
  started: every option needs the hub's "to start" record (from 20261112160s) to say "started"
  and Undo to check it (shared-pending too, for a run started while the holding tab was
  reconnecting).
- `shared-pending`: give each socket an id; the page that shows the `undo:<project>/<id>` notice
  tells the hub it is holding it (a message on the socket, or a request carrying the socket id)
  and again when it closes (the `onClose` 160s already needs). The hub adds an event such as
  `{ type: "run", project, id, state: "waiting" | "started" | "not-started" }` and turns
  "waiting" into "not-started" when the holding socket closes. A reconnect of that same tab
  should be allowed to claim the wait back while its notice is still shown.
- `refuse-undo`: `undoLastAction` for a `neither` refuses with a new code (for example
  `run_started`) once the hub's record for that note says started; the page shows the message
  above. The second tab's text uses only what the hub knows (the note's time, "to start").
  Starting a run writes nothing to the card, so today no event goes out: the hub must emit
  `cards` (or a new hub-to-tab event) when the record turns to started, so that tab B replaces
  Start now with "Writing new options..." and tab A drops "Sending when Undo closes". Tabs
  still send nothing on the socket.
- `wait-a-minute`: as refuse-undo (including the event when the run starts), plus the page
  hides Try again until 60 seconds after the note's `feedback` time.
- `hub-clock`: the hub keeps a 10-second timer per note, cancelled by Undo; tabs get the start
  time in an event and draw the countdown. The page's toast for this action has no pause on hover
  or focus: keeping it would mean a tab telling the hub it is hovering, the per-tab holding
  shared-pending needs. 160s's "a tab closed before then leaves nothing started" no longer
  applies, and its roadmap text changes with it.
- Update `docs/roadmap.md` E, "Neither: new options right away", and remove "Needs a card"
  item 1, once decided.

## Sources

- `docs/roadmap.md` on pull request 15, "Needs a card" item 1: "In a second tab (or window)
  opened during those seconds, the notice is waiting in the other tab: what does the second tab
  show? If it shows Try again and you press it, the run starts while Undo is still offered in the
  first tab".
- Review of pull request 15 (round 1): "As written, a second tab can't know about the first
  tab's toast, so it would offer Try again ... The two fixes show the human different things (a
  pending state in every tab, or the first tab's Undo being refused, like 0012's 'another tab'
  rule)".
- Card [20261112160s](20261112160s-undo-new-options-turn.md), technical detail: "Undo is offered
  only by that toast in that page" and "a page that later opens the card while no Undo notice is
  waiting on it shows it like a failed run".
- Card [0012](0012-undo-history.md), context: "Undo is refused if anything wrote the card after
  the action (an agent applying it, another tab)".
- Card [0019](0019-decide-during-conversation.md), context: a write during the 10 seconds makes
  Undo fail, so anything else has to happen "with the decision, or after the Undo window".
- Code on `origin/main`: `src/web/toast.tsx` ("its timer pauses while it is hovered or focused,
  ... so nobody has to race the timer to reach it"; 10 000 ms for a toast with an action),
  `src/core/api.ts` (`HubEvent`), `src/server/cards.ts` (`undoLastAction`, `UNDO_TTL_MS`).
