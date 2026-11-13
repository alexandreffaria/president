---
id: "20261112nyu2"
title: What should the project's agent do with new options the hub already wrote?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:45:56Z
created_by: claude (PR 29 card writer)
tags: [pr-2, neither, agent-rules, skill]
depends_on: ["0007", "202611111gpm", "20261111st0c"]
recommendation:
  option: fix
  why: >-
    0007's main cost was that the hub's run doesn't know the working agent's plan, so its
    options can miss context. fix lets the agent that knows the plan close that gap without
    redoing the work: it changes only what it knows is wrong or missing and says what in
    the card. leave wastes that knowledge; rewrite throws away the run you waited for and
    can change options you were already reading. Pick leave if you want options you have
    seen to never change under you; pick rewrite if you trust only the working agent's
    options.
options:
  - id: leave
    title: Read them and leave them
    summary: >-
      The agent reads your note and the hub's options, changes nothing, and runs the done
      line; if it disagrees, it says so only in its own work (or a new card).
    pros:
      - Options you have started reading never change because of this
      - Least for the agent to do, and nothing new to review
    cons:
      - A wrong fact or an option that clashes with the current work stays on the card
      - The working agent's knowledge, which 0007 said the run lacks, never reaches the card
  - id: fix
    title: Fix only what it knows is wrong or missing
    summary: >-
      The agent checks the hub's options against the code and its plan; if a fact is wrong
      or an option clashes with the work, it changes just that with preside update and adds
      a line to the context saying what it changed; otherwise it changes nothing.
    pros:
      - The working agent's context reaches the card, but only where it matters
      - The context line says what changed, so you can tell
    cons:
      - Options can change after you saw them (the page shows "An agent changed this card")
      - A judgement call for the agent, with no review (rewrites go unreviewed, 20261111st0c)
  - id: rewrite
    title: Answer the note itself, as before the hub ran
    summary: >-
      The agent treats your note as unanswered and writes its own options with preside
      update, replacing the hub's.
    pros:
      - "The options always come from the agent that knows the plan, as before #0007"
    cons:
      - The run you waited for is thrown away, and you may see two sets of options for one note
      - Options can change while you are deciding, as in fix but more of them
resolution:
  choice: fix
  resolved_at: 2026-11-12T21:54:17Z
applied_at: 2026-11-12T22:01:43Z
---

## Context

Under 0007 `spawn`, the hub writes new options from your "neither" note itself (pull request 29). It
doesn't mark the note read, so the next time the project's working agent runs `preside
pending`, it sees the card under "New notes from the human", with your note but without
`needs_new_options`. 0007 accepted that ("The working agent later finds options it didn't
write, and pending still lists the card for it to read"), but no card or skill line says
what the agent then does. The skill's "New notes" section says "Act on them: update the
context or the options", which an agent could read as "write options for this note".

Example: at 21:00 you reject #0042's two server options with "Both assume a server. Compare
on-device storage only." The hub writes three on-device options. The next morning the
project's agent runs:

```
New notes from the human. Act on them, then run its `done` command:
  /home/you/app/decisions/0042-trip-storage.md
    Where should the app keep trips? (open)
    neither 2026-11-12T21:00:00Z: Both assume a server. Compare on-device storage only.
    done: preside seen ...
```

The agent knows the app already ships SQLite for settings, which none of the hub's options
mentions.

## Option leave: Read them and leave them

The agent runs the `done:` line. #0042 is as the hub wrote it.

## Option fix: Fix only what it knows is wrong or missing

The agent adds to the SQLite option "The app already ships SQLite for settings
(`src/db.ts`)", adds a context line "Edited by the project's agent: noted that SQLite is
already in the app.", runs `preside update`, then the `done:` line.

## Option rewrite: Answer the note itself, as before the hub ran

The agent writes its own on-device options (for example SQLite and plain files), replaces
the hub's with `preside update`, then runs the `done:` line.

## Sources

- [0007](0007-neither-try-again.md) `spawn`, con: "The working agent later finds options it
  didn't write, and pending still lists the card for it to read".
- `docs/roadmap.md`, E, "Neither: new options right away": "The hub does not run `preside
  seen`: the working agent still finds the card in `preside pending` ... and reads options it
  didn't write."
- `skills/decision-cards/SKILL.md`, "New notes from the human", step 2.
- Pull request 29, "Needs a card" item 2.
