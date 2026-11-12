---
id: "20261112xp4s"
title: When Sync brings in a change to the card you have open, what should the notice say?
status: open
kind: choice
priority: normal
created: 2026-11-12T01:40:34Z
created_by: claude (sync follow-up cards)
tags: [sync, card-view, copy]
depends_on: ["0001"]
recommendation:
  option: from-sync
  why: >-
    It is the only wording that is always true without guessing: the hub knows which cards its
    own Sync just brought in from the online copy, but not who changed them there (you on your
    other machine, an agent there, or a pull request someone merged). It keeps the "read it before you act" pause, which protects you
    from deciding on text you haven't seen, and it is a small change. Pick by-change if you
    often have agents rewriting cards on one machine while you answer on another, and want each
    line of the notice to say who did it; pick neutral if you'd rather never see a "who" at all.
options:
  - id: neutral
    title: A neutral "This card changed"
    summary: The notice drops the "who" and says only that the card changed while you had it open, then lists what changed, for every change that didn't come from this tab or another president tab.
    pros:
      - Never wrong, whoever or whatever made the change
      - The smallest change; one sentence of wording
    cons:
      - You lose a clue you have today; "an agent changed it" is useful when it really was an agent
      - After a Sync you still have to work out for yourself that it was your own answer from the other machine
  - id: from-sync
    title: Say it came in with Sync
    summary: When the change arrived with this hub's Sync, the notice says "Sync just brought in a newer version of this card from the online copy."; other changes keep today's wording.
    pros:
      - Tells you the real reason the card moved, at the moment you pressed Sync
      - Always true; it says how the change arrived, not who made it or where
      - Keeps today's wording for an agent working on this machine, where it is right
    cons:
      - Doesn't say whether it was you on your other machine, an agent, or a merged pull request; the list of changes is your only clue
      - A change brought in some other way (someone running git pull in a terminal) still says "An agent changed this card"
  - id: by-change
    title: Say who made each change
    summary: The notice sorts the changes by kind; your kinds of change (a decision, a note, a deferral, a reopen, a Neither, an undo) are listed as yours, the agent's kinds (new options, a new recommendation, new text) as the agent's.
    pros:
      - The most informative; you see at a glance "your decision from the other machine" and "an agent added an option"
      - Works however the change arrived, through Sync or not
    cons:
      - It is a guess from the kind of change, not a record of who made it; a card someone edited by hand can be labelled wrong
      - The most work to build, and to keep right as new kinds of change appear (snooze dates, withdrawn cards, chat summaries)
      - A longer notice to read
  - id: quiet
    title: No notice for your own answers
    summary: When every change Sync brought in is one of your kinds (a decision, a note, a deferral, a reopen, a Neither, an undo), the card just updates with no notice and no "I've read it"; anything else still gets the notice.
    pros:
      - No interruption for something you did yourself
      - The card simply shows its new state, for example "Decided" with your answer
    cons:
      - The card changes under you without a word; if you had picked an option, the pick disappears with no explanation
      - Relies on the same guess as by-change about who made a change; a wrong guess here hides the change entirely
      - You lose the pause before acting, so you might add a note to a card without noticing you decided it an hour ago elsewhere
---

## Context

**Where this comes from.** The Sync button (card [0001](0001-sync-across-machines.md), being
built in [pull request #12](https://github.com/alexandreffaria/president/pull/12)) sends your
answers from one machine and brings in the answers you gave on your other machine. Its reviewer
flagged two left-over questions as yours to answer; this is one of them (the other is
[2026111209dq](2026111209dq-sync-inside-bigger-repo.md)).

**The situation.** You decide a card, say "What should the empty trip list say?", on your
laptop and press Sync there. Later, at your desktop, the same card happens to be open on the
screen (still undecided there). You press Sync.
The pull brings in your laptop answer, the card on the screen changes, and today it shows:

```
An agent changed this card while you had it open. What you see now is the new
version. Read what changed before you act on it.
  • It is now resolved (was open).
  • It was decided: "Lead with the next action".
                                                        [I've read it]
```

The change was yours, so "An agent changed this card" is wrong. The notice only appears for a
card that is open on the screen at the moment it changes; cards you aren't looking at just
update.

**Why the notice exists.** It makes you stop and read before acting on a card that changed
under you: until you press "I've read it", the hub refuses to record a decision or note on
the old text, and if you had picked an option, the pick is cleared ("Your choice was cleared.
Read it again before deciding."). Every option except `quiet` keeps that pause.

**What the hub can know.** It knows when a change came from this tab (no notice) or from
another president tab on this machine ("You changed this card in another president tab.").
Anything else counts as "an agent". Once Sync exists, the hub can also know which cards its own
Sync just brought in. It can **not** know who made a change on the other machine: Sync there
carries everything in the card files, your answers and also what agents wrote there (new
options, a rewritten card, "applied" marks).

## Option neutral: A neutral "This card changed"

```
This card changed while you had it open. What you see now is the new version.
Read what changed before you act on it.
  • It is now resolved (was open).
  • It was decided: "Lead with the next action".
                                                        [I've read it]
```

The same wording for an agent on this machine and for a Sync. A change from another tab keeps
"You changed this card in another president tab."

## Option from-sync: Say it came in with Sync

After your Sync:

```
Sync just brought in a newer version of this card from the online copy.
Read what changed before you act on it.
  • It is now resolved (was open).
  • It was decided: "Lead with the next action".
                                                        [I've read it]
```

An agent working on this machine still gets "An agent changed this card while you had it open."

## Option by-change: Say who made each change

After your Sync brought in your decision and, in the same pull, an option an agent added on the
laptop:

```
This card changed while you had it open. Read what changed before you act on it.
  Your answers (from another machine):
  • It was decided: "Lead with the next action".
  From an agent:
  • New option C ("Lead with a photo").
                                                        [I've read it]
```

## Option quiet: No notice for your own answers

After your Sync, the card on the screen simply turns into the decided card ("Decided: Lead with
the next action", with Reopen), with no notice and nothing to press. If the same pull also
brought in an agent's new option, you get the usual notice instead.

## Technical detail (for the implementer)

- `from-sync`: `SyncService` keeps, per project, the card revisions its last pull brought in
  (it already reports the `received` cards); the card endpoint adds `changedBySync` to
  `CardDetailDto` next to `writtenByPresident`, and `CardView` picks the sentence from it. The
  current line is `setChangedBy(card.writtenByPresident ? "other-tab" : "agent")` in
  `src/web/views/CardView.tsx` on `feat/sync`.
  The watcher can reload the card mid-pull, before the Sync knows what it brought in; the
  reload on the `cards` event after the Sync must pick the sentence again (record the
  revisions before emitting it).
- `by-change` and `quiet`: `src/web/card-changes.ts` (`describeChanges`) gains a "who" per
  line: `resolution`, `status`, `needs_new_options` being set and new `feedback` entries of type
  `note`, `defer`, `reopen`, `neither` and `undo` count as yours; `options`, `recommendation`,
  the body sections, `title` and `needs_new_options` being cleared count as an agent's. `quiet` also has to acknowledge the new
  revision by itself, so the hub accepts actions on it.

## Sources

- [PR #12](https://github.com/alexandreffaria/president/pull/12), "Details the card left open",
  item 10: "Not built: the roadmap's undecided suggestion to word the open-card notice
  differently after a pull. The notice still says 'An agent changed this card'."
- The review of PR #12
  ([comment](https://github.com/alexandreffaria/president/pull/12#issuecomment-6811811120)),
  choice 10: "Needs a card: the open-card notice after a pull".
- `docs/roadmap.md`, "B. Sync", "Notes for whoever builds it": "an open card currently says 'An
  agent changed this card while you had it open' ... Suggestion, not decided: make the notice
  say the change came from Sync."
- Code on `feat/sync`: `src/web/views/CardView.tsx` (the notice and `changedBy`),
  `src/web/app-writes.ts` (changes from this tab), `src/web/card-changes.ts` (the list of
  changes).
