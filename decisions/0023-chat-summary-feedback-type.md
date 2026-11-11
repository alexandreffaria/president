---
id: "0023"
title: Should a conversation summary be marked as its own kind of entry, or saved as a plain note?
status: open
kind: choice
priority: low
created: 2026-11-11T15:58:25Z
created_by: claude (batch-2 writer)
tags: [pr-2, chat, card-format]
depends_on: ["0003"]
recommendation:
  option: chat
  why: >-
    A summary is written by the agent and edited by you, which is different from a note you
    typed, and History and agents should be able to tell the two apart. A proper entry type
    is how the format already tells "deferred", "reopened" and "undone" apart. Pick
    note-tagged if you run different president versions on your machines and don't want a
    card to show as broken on the one not yet updated.
options:
  - id: chat
    title: A new kind of entry, "Conversation summary"
    summary: The summary is saved with its own type, so History labels it "Conversation summary" and president pending prints it as chat.
    pros:
      - In History you see at a glance which entries you typed and which came from a conversation
      - Agents see the difference in president pending without any wording convention
      - Follows the existing pattern; every other kind of entry is told apart by its type
    cons:
      - A machine running an older president shows the card as broken until president is updated there, because the older version doesn't know the new type
      - The card format, the skill and History all have to learn the new type
  - id: note
    title: A plain note
    summary: The summary is saved as an ordinary note, labelled "Note" in History and note in pending; only its wording shows where it came from.
    pros:
      - Nothing new in the card format; every president version reads it
      - Agents already know what to do with a note
    cons:
      - In History, a summary looks exactly like something you typed yourself
      - An agent can't tell it is a summary of a conversation it never saw, unless the text says so
  - id: note-tagged
    title: A note with a "from a conversation" mark
    summary: The summary is saved as a note with one extra field saying it came from a conversation; History shows "Note, from a conversation", older versions just see a note.
    pros:
      - History can label it differently, and older president versions still read the card
      - Agents still treat it as a note, which is what it is for them
    cons:
      - Two ways of saying what an entry is (its type, and this extra field), which the format has to explain
      - president pending has to be changed to show the mark, or agents won't see it
      - An agent reading the card file directly may miss the extra field
---

## Context

When a conversation on a card ends, a summary you edited is added to the card's `feedback`
list ([#0003](0003-conversation-storage.md), option `summary`). Each entry in that list has a
type that says what you did. This card asks which type a summary gets. It changes two things:
what **you** see in the card's History, and what **agents** read in `president pending`.

**Today.** The types are `neither`, `note`, `defer`, `reopen` and `undo` (`FEEDBACK_TYPES` in
`src/core/model.ts`). History shows each with a label: "Asked for new options", "Note",
"Deferred", "Reopened", "Decision taken back" (the `LABEL` list in
`src/web/components/FeedbackHistory.tsx`; an unknown type would show as "Note").
`president pending` prints each new entry as `<type> <time>: <text>` (`src/cli/commands.ts`),
so it needs no change for a new type. A card with a type president doesn't know fails the
format check (`FeedbackSchema` in `src/core/schema.ts`) and shows as broken. Extra fields on an
entry are allowed and kept.

**Why not decided yet.** Card #0003 left it open ("`chat` would be a new feedback type; it could
also be a plain `note`"), and the roadmap that lands with PR #5 called it an implementation
choice. The review of PR #5 pointed out that it changes what you see and what agents read, so
it comes to you.

Example: you talked with the agent on #0007 and saved this summary: "I now see that B's extra
code is one line per call with a helper. Asked the agent to check whether our HTTP client already
throws on 404."

## Option chat: A new kind of entry, "Conversation summary"

History:

```
Conversation summary · 2 minutes ago · not read by an agent yet
  I now see that B's extra code is one line per call with a helper. ...
Note · yesterday
  Keep the error codes few.
```

`president pending`:

```
    chat 2026-11-12T09:14:00Z: I now see that B's extra code is one line per call with a helper. ...
```

In the card file:

```yaml
  - at: 2026-11-12T09:14:00Z
    type: chat
    note: I now see that B's extra code is one line per call with a helper. ...
```

## Option note: A plain note

History:

```
Note · 2 minutes ago · not read by an agent yet
  From a conversation with the agent: I now see that B's extra code is one line per call ...
Note · yesterday
  Keep the error codes few.
```

`president pending`:

```
    note 2026-11-12T09:14:00Z: From a conversation with the agent: I now see that ...
```

The opening words "From a conversation with the agent:" would be added by the hub; you could
remove them while editing.

## Option note-tagged: A note with a "from a conversation" mark

History:

```
Note, from a conversation · 2 minutes ago · not read by an agent yet
  I now see that B's extra code is one line per call with a helper. ...
```

`president pending` (after a small change to print the mark):

```
    note (from a conversation) 2026-11-12T09:14:00Z: I now see that B's extra code is ...
```

In the card file:

```yaml
  - at: 2026-11-12T09:14:00Z
    type: note
    source: chat
    note: I now see that B's extra code is one line per call with a helper. ...
```

## What each option changes (for the implementer)

- `chat`: add `"chat"` to `FEEDBACK_TYPES` in `src/core/model.ts`, a label in `LABEL` in
  `src/web/components/FeedbackHistory.tsx`, the feedback section of `docs/card-format.md`, and the
  "New notes from the human" section of `skills/decision-cards/SKILL.md`.
- `note`: nothing in the format; the hub adds the opening words when it proposes the summary.
- `note-tagged`: document the extra field in `docs/card-format.md`, read it in
  `FeedbackHistory.tsx`, and print it in `president pending` (`src/cli/commands.ts`).

## Sources

- Code: `src/core/model.ts` (`FEEDBACK_TYPES`), `src/core/schema.ts` (`FeedbackSchema`: the type
  must be one of `FEEDBACK_TYPES`, extra fields allowed), `src/web/components/FeedbackHistory.tsx`
  (`LABEL`, falls back to "Note"), `src/cli/commands.ts` (pending prints `type ?? "note"`).
- Card #0003, option `summary`; `docs/roadmap.md` (lands with PR #5); PR #5 review, finding D-10
  and question Q6.
