---
id: "20261112160s"
title: When you undo "Ask for new options", what happens to your "Neither" message in the conversation?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T02:26:21Z
created_by: claude (batch-4 writer)
tags: [pr-2, chat, neither, undo]
depends_on: ["202611111gpm", "0007", "0012", "0018", "0021", "20261111mby8"]
recommendation:
  option: wait-out
  why: >-
    Everywhere else, undoing a note or a "neither" leaves no trace (0012). wait-out and fork
    are the only options where that is also true for the agent, which then can't steer later
    answers by a request you took back ("since you only want on-device storage..."). Both
    reach the same result; wait-out gets there by sending nothing until Undo is no longer
    offered, so there is nothing to take back, while fork has to build and manage a copy of
    the conversation for every run. wait-out's price is starting each run about 10 seconds
    later (longer while you hover over the notice), a small part of a run that takes a
    minute or two, and a run that doesn't start if you close the tab within those seconds,
    until you press Try again. Pick fork if you want the run to start the moment you press
    the button, and accept building the copy of the conversation. Pick forget-it if you'd
    rather build the least and trust the agent to follow "ignore that message", the same
    kind of trust you accepted for the neutral chat (mby8). Pick mark-undone if you want the
    panel to show everything the agent has been told, even what you took back.
options:
  - id: forget-it
    title: Remove it from the panel, and tell the agent to ignore it
    summary: Your "Neither" message and any reply so far disappear from the panel and the hub's copy; the agent still has your message in its memory (and the start of its reply, if it was saved), so your next message to it starts with a line saying you took that message back and it should disregard it.
    pros:
      - The panel matches the card, where the undone "neither" leaves no trace either (0012)
      - Little to build; the hub drops the last turn from its copy and adds one line to your next message
    cons:
      - The agent still remembers what you wrote, and only an instruction keeps it from using it; it can slip, as with the neutral chat
      - The panel no longer shows everything the agent was told, so if it slips ("since you want on-device only..."), you can't see where that came from
      - A summary you later ask for (Write summary, or the one Decide shows) is written from the agent's memory, so a slip there carries the undone request into the card, where the project's agent reads it, unless you spot it in the summary first
  - id: mark-undone
    title: Keep it in the panel, marked "Undone"
    summary: Your "Neither" message and any partial reply stay in the panel and the hub's copy, greyed with an "Undone" label; the agent is told in your next message that you took it back.
    pros:
      - The panel shows exactly what the agent has been told, so nothing it says later comes from something you can't see
      - Little to build, about as much as forget-it
    cons:
      - A slip of 10 seconds leaves a permanent line in the card's conversation, while the card itself shows no trace of it
      - The agent still remembers it and relies on the same "disregard it" instruction as forget-it
      - One more state for a message in the panel (sent, undone) for the hub's copy to keep
  - id: fork
    title: Take it back from the agent too
    summary: Each new-options run works on a copy of the card's conversation (a "fork"); undoing throws the copy away, so the panel, the hub's copy and the agent's memory are all as they were before you pressed Ask for new options.
    pros:
      - Undo means the same everywhere; nothing of the undone request is left, in the panel or in what the agent remembers
      - No instruction to follow, so nothing can slip
      - On a card with no conversation before, the undone run leaves none at all
    cons:
      - >-
        The most to build: the hub must switch the card to the copy's conversation when the
        options are written, and throw the copy away otherwise, including when the run
        fails, so a failed run's turn also disappears from the panel (the "Couldn't write
        new options" notice and Try again stay)
      - A reply you saw starting in the panel vanishes, with no record of what it began to say
      - Each run leaves an extra conversation file in Claude Code's store until its usual cleanup (30 days by default)
  - id: wait-out
    title: Send it to the agent only once Undo is no longer offered
    summary: Your "Neither" message shows in the panel at once, marked "Sending when Undo closes"; the run starts only when the Undo notice goes away (10 seconds, longer while you hover over it or it has keyboard focus), so an Undo before then removes the message, and nothing ever reached the agent.
    pros:
      - Undo means the same everywhere, as in fork; nothing of the undone request reaches the agent
      - Little to build, a wait that Undo cancels; no copy of the conversation to manage
      - No extra conversation file, and a failed run behaves as 1gpm decided
    cons:
      - Every run starts about 10 seconds later, even when you never undo, which bends 0007's "starts an agent right away"
      - While you hover over the Undo notice, the run keeps waiting
      - If you close or reload the tab before the notice goes away, the run doesn't start; the card waits for the project's agent, and when you next open it the page says so and offers Try again, as after a failed run
resolution:
  choice: wait-out
  resolved_at: 2026-11-12T02:55:27Z
applied_at: 2026-11-12T06:43:27Z
---

## Context

**What is already decided.**

- [0007](0007-neither-try-again.md) `spawn`: **Ask for new options**, in the Neither panel,
  records your note and starts an agent run at once that writes new options.
- [202611111gpm](202611111gpm-new-options-run.md) `shown-no-reminder`: that run is a turn in the
  card's conversation. It continues the card's Claude Code session (or starts one), your
  "Neither: ..." message and the agent's reply appear in the side panel, and the hub saves both
  in its own copy of the conversation ([0018](0018-show-earlier-conversation.md); the session
  itself is kept per machine, [0021](0021-session-id-per-machine.md)).
- [0012](0012-undo-history.md) `hybrid`: after any action a toast offers **Undo** for 10
  seconds. Undoing a note or a "neither" puts the card back exactly as it was, with no trace,
  and your text comes back as a draft. Undoing Ask for new options also stops the run
  (`docs/roadmap.md`, "Neither: new options right away").

**What is left open.** The card is put back, but the conversation is not part of the card.
By the time you press Undo, the panel already shows your "Neither: ..." message, perhaps with
the first words of the reply. The hub has saved them, and the Claude Code session has received
your message: there is no way to make it forget a message it was sent, only to send the message
to a copy of the conversation in the first place and throw the copy away (or, as wait-out
below does, not to send it until Undo is gone). You see the result on the page and in what the
agent says later, so pull request 14's review asked for a card (finding D-6), and its roadmap
now lists it as "Needs a card" item 3.

**When it happens.** Only while the Undo notice is shown (10 seconds, longer while you hover
over it or it has keyboard focus), so almost always while the run is still writing (under
wait-out, before it has started). Once the new options are written, the card has changed
after your action and Undo is refused, as today (`undoLastAction` in `src/server/cards.ts`
only undoes while the card is still as the action left it). It doesn't block the new-options
run itself, only its Undo.

**Under every option:** the card is restored, the run is stopped (under wait-out, it never
started), nothing of it is written to the card, and your note comes back as a draft in the
Neither panel.

Example used below (an invented card, the scenario 1gpm used): on #0042 you asked the agent
one question at 14:02. At 21:00 you write "Both assume a server. Compare on-device storage
only." and press Ask for new options, then change your mind about the note and press `u`
five seconds later. At 21:30 you ask the agent another question.

## Option forget-it: Remove it from the panel, and tell the agent to ignore it

```
Right after Undo:
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...

Next message the agent receives:
  (from the hub) The human took back their last message ("Neither: Both assume a server.
  Compare on-device storage only.") and its request for new options. Disregard it.
  you, 21:30     Does the webview clear IndexedDB when space runs low?
```

## Option mark-undone: Keep it in the panel, marked "Undone"

```
Right after Undo:
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.   Undone
  agent, 21:00   Here are three on-device opt...                                  Undone
```

The agent's next message starts with the same line as in forget-it.

## Option fork: Take it back from the agent too

```
Right after Undo:
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...
```

Your 21:30 question goes to the conversation as it was at 14:02; the agent never saw the
"Neither" message. If you later press Ask for new options again, it runs on a fresh copy.

## Option wait-out: Send it to the agent only once Undo is no longer offered

```
Right after pressing Ask for new options:
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...
  you, 21:00     Neither: Both assume a server. Compare on-device storage only.
                 Sending when Undo closes

Right after Undo:
  you, 14:02     Is IndexedDB available in the app's webview?
  agent, 14:02   Yes ...
```

As in fork, your 21:30 question goes to a conversation that never saw the "Neither" message.
Without the Undo, the run starts when the notice goes away, about 10 seconds later, and the
panel shows its reply as 1gpm decided.

## Technical detail (for the implementer)

- Claude Code 2.1.302 has no flag to rewind a session to an earlier message. It does have
  `--fork-session` ("When resuming, create a new session ID instead of reusing the original
  (use with --resume or --continue)"), which `fork` relies on.
- `forget-it`: on Undo, drop the run's turn (both messages) from the hub's copy (#0018) and
  store a pending "took back" line for the card, sent at the start of the next message to the
  session and then cleared. If the run had started a new session (`--session-id`, no earlier
  conversation), the session-store entry can stay; the next message carries the line.
- `mark-undone`: as `forget-it`, but the two messages stay in the hub's copy with an `undone`
  mark, and the panel greys them.
- `fork`: run with `--resume <id> --fork-session` (or a fresh `--session-id` on a card without
  a conversation), and save the run's messages under the fork until the hub has written the
  options; only then switch the card's session-store entry (#0021) to the fork's id and move
  the messages into the card's copy. On Undo, or on a failed run, discard the fork's messages
  and leave the entry as it was. A failed run's turn is then also gone from the panel: the
  page's "Couldn't write new options ..." notice and Try again (1gpm) stay as decided, and Try
  again forks again.
- `wait-out`: Ask for new options records the note as today, and the page shows the message as
  pending. It asks the hub to start the run only when its `undo:<project>/<id>` toast closes
  (`src/web/toast.tsx`; the timer pauses while the toast is hovered or focused). Undo is offered
  only by that toast in that page, so nothing reaches the session, the session store or the
  hub's copy before Undo is gone. A tab closed or reloaded before then leaves the card
  `needs_new_options: true` with nothing started. The hub records the run as "to start" when
  the note is recorded, and a page that later opens the card while no Undo notice is waiting
  on it shows it like a failed run ("The run for your note at 21:00 didn't start. The card
  waits for the project's agent, as before." [Try again]). `toast.tsx` has no close callback
  today; this needs one (for example `onClose`). A message you send in the panel during the
  wait is held until the run has started, so it reaches the session after the "Neither"
  message.
- `docs/roadmap.md` (as pull request 14 leaves it), E, "Neither: new options right away":
  replace "What happens to the turn already shown and saved ... see Needs a card 3" with the
  answer, remove "Needs a card" item 3, and take 3 out of row E's "Needs a card 2 and 3, for
  the parts they block".

## Sources

- Review of pull request 14, finding D-6: "This one is on the page, and under 1gpm the resumed
  Claude Code session has already received the message, so the hub can't simply take it back.
  There is a real choice: remove it from the hub's copy and leave the session holding it, keep
  it marked 'undone', or fork the session."
- `docs/roadmap.md` on pull request 14, "Neither: new options right away": "Undoing Ask for new
  options stops the run (above). What happens to the turn already shown and saved (your
  "Neither: ..." message and any partial reply, which the resumed session has already
  received) is not fixed by a card; see Needs a card 3." And "Needs a card", item 3: "Remove
  it from the panel (the session still remembers it), keep it marked "undone", or something
  else? It blocks only the Undo part of the new-options run."
- Card [0012](0012-undo-history.md), context: "For a note, neither, deferral or reopen, the old
  bytes are written back: no trace in the file. The text you sent comes back as a draft."
- Claude Code settings: `cleanupPeriodDays` (default 30) sets how long conversation files are
  kept.
- Code: `src/web/toast.tsx` (Undo toasts last `10_000` ms, and "its timer pauses while it is
  hovered or focused"), `src/server/cards.ts`
  (`undoLastAction`, which undoes only while the card is still at the revision the action
  produced).
- `claude --help` (2.1.302): `--fork-session`, `--resume`, `--session-id`; no option to resume
  at an earlier message.
