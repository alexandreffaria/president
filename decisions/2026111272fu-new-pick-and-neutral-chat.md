---
id: "2026111272fu"
title: After "neither", may the chat name the agent's new pick before you reveal it?
status: resolved
kind: choice
priority: high
created: 2026-11-12T02:18:05Z
created_by: claude (batch-4 writer)
tags: [pr-2, chat, recommendation, bias, neither]
depends_on: ["20261111mby8", "202611111gpm", "20261111nsaj", "0007", "0008"]
recommendation:
  option: reset
  why: >-
    The new options come with a new pick, and that is when a fresh look matters most:
    nsaj's reasoning, and the point of hiding the pick (0008) and keeping the chat neutral
    (mby8). After a "neither" the panel opens on its own, so the run's message is the first
    thing you read next to the new options. Under keep or run-explains it would often name
    the new pick there; quiet-run avoids that, but a single question in a revealed
    conversation still gets it. reset treats the new pick like any other: hidden on the page and in
    the chat until you press r, wherever you had got to with the old one. The cost is a
    plainer message from the run, with its argument for the pick behind r, and a small flag
    the hub keeps per conversation. Pick keep if, once you have looked at a card's pick, you
    are happy for the chat to talk freely about every later one. Pick quiet-run if what
    bothers you is only the panel showing the new pick unasked, and you want the chat to keep
    answering directly where you had already looked. Pick run-explains if you
    want the run to answer your note the way a colleague would.
options:
  - id: reset
    title: The new pick is hidden again, in the run's message and the chat
    summary: The run's message explains how the new options answer your note without naming its pick, and every conversation on the card is neutral about the new pick until you press r, even one where you had revealed the old pick.
    pros:
      - The new options get the same fresh look as the first ones, the moment you most need it
      - One rule for every pick a card ever has, whether or not you looked at an earlier one
      - The run's argument isn't lost; it is in the new pick's reasoning, shown when you press r
    cons:
      - The run's message is plainer, a description of the new options rather than "here is what I'd do and why"
      - In a conversation where you revealed the old pick, the chat now dodges questions it answered freely before
      - The hub has to note, per conversation, that the reveal was for an earlier pick, and tell the session so with each message
      - The earlier messages stay in the panel, and what the chat said about the old pick can still hint at the new one (for example, if it praised something a new option keeps)
  - id: keep
    title: It depends on the conversation, as mby8 reads today
    summary: In a conversation where you never revealed the pick, the run's message and the chat stay neutral until r; in one where you revealed the old pick, the chat stays free, so the run's message may name and argue for the new pick.
    pros:
      - Nothing new to build or explain; it is what mby8's technical detail already says ("the line sent stays revealed for that conversation")
      - Once you have looked at the agent's view on a card, the chat goes on talking to you as an equal, including about its new pick
      - The run can say plainly why it now recommends what it does
    cons:
      - The same "neither" gives a neutral message on one card and the new pick on another, depending on whether you pressed r there earlier
      - On a card where you had revealed the pick, the panel, which opens on its own after a "neither", shows the new pick before you have read the new options, while the card itself hides it
  - id: run-explains
    title: The run may always argue for its new pick
    summary: The run's message answers your note and says which new option it recommends and why, whether or not you revealed anything; after that message the conversation counts as revealed, and the card's own pick stays behind r.
    pros:
      - The run answers your "neither" the way a colleague would, with its view and the reason
      - You have just said what was wrong with the old options, so you have a view of your own before you read the agent's
      - One rule for the run, the same on every card
    cons:
      - The panel opens on its own after a "neither", so the new pick is in view next to the new options, which undoes 0008 for every set of new options
      - The card hides its pick behind r while the panel beside it states it, so r protects nothing there
      - From then on the chat is free on that card, so even your questions about the new options get its view before you have formed yours
  - id: quiet-run
    title: The run's message never names its pick; the chat follows the conversation
    summary: The run's message explains how the new options answer your note without naming its pick, on every card; after it, the chat follows mby8 as today, so in a conversation where you had revealed the old pick, it names the new one if you ask.
    pros:
      - The panel that opens on its own after a "neither" never shows the new pick unasked
      - Nothing new to store; the run's prompt always says "don't name your pick", and the chat keeps today's line
      - In a conversation where you already looked at the agent's view, a direct question still gets a direct answer
    cons:
      - In such a conversation, one question ("which would you go with now?") gets the new pick before you have formed your view, while the card hides it
      - Two rules to keep in mind, one for the run's message and one for the chat after it
      - The run's message is plainer, as in reset
resolution:
  choice: reset
  resolved_at: 2026-11-12T02:54:53Z
applied_at: 2026-11-12T06:43:28Z
---

## Context

**What is already decided.**

- [0008](0008-recommendation-placement.md) `hidden`: the card's pick (the agent's
  recommendation) stays hidden until you press `r`, so you form your own view first.
- [20261111mby8](20261111mby8-chat-and-hidden-pick.md) `neutral`: until you press `r`, the
  card's chat explains and compares the options but doesn't name the pick or recommend one;
  asked, it says the pick is behind `r`. Once the chat has named the pick, that
  conversation stays "revealed": the chat is free in it from then on, even after you leave the
  card and the page hides the pick again.
- [20261111nsaj](20261111nsaj-revealed-pick-duration.md) `visit`: the page shows a revealed pick
  until you leave the card. Its reasoning: "you come back to a card mostly when something changed
  (new options after 'neither' ...), which is exactly when a fresh look helps; the new options
  also come with a new pick."
- [0007](0007-neither-try-again.md) `spawn` and [202611111gpm](202611111gpm-new-options-run.md)
  `shown-no-reminder`: when you say "neither" and ask for new options, an agent writes new
  options **and a new pick** at once. Its message is a turn in the card's conversation, shown in
  the side panel. Since a "neither" now always leaves a conversation, the panel opens on its own
  after one (`docs/roadmap.md` on pull request 14, "Cross-card consequences").

**What is left open** (`docs/roadmap.md` on pull request 14, "Needs a card", item 2). Two
questions, answered together below because each option answers both:

1. Before you press `r`, may the run's message name the new pick, or argue for it?
2. In a conversation where you had revealed the **old** pick, so the chat was free there, is the
   chat neutral again about the **new** pick until you press `r`?

mby8 said only that the run still writes a pick, hidden on the page. It didn't cover the run's
message: when mby8 was written the run had no readable message, and 1gpm, decided in the same
batch, made that message a turn in the conversation.

**Why it matters now.** The run's instructions (its "prompt") have to say what its message may
contain, and pull request 2 can't write them until this is answered (`docs/roadmap.md` on pull
request 14, build plan row E: "Needs a card 2 and 3, for the parts they block").

**Example used below** (an invented card, built on the scenario 1gpm used). Card #0042, "Where
should the app keep trips?", has two options, both on a server. On Monday you press `r`, see
the pick (the server with offline copies), and ask the chat "Why the server?"; it explains. On
Tuesday you say neither: "Both assume a server. Compare on-device storage only." The run writes
three on-device options: browser storage, a small database file, and plain files. Its new pick
is the small database file. The panel opens beside the card; the card itself shows the three
options with the pick hidden.

## Option reset: The new pick is hidden again, in the run's message and the chat

```
  you, Mon       Why the server?
  agent, Mon     Because the card's pick ... (you had pressed r)
  you, Tue       Neither: Both assume a server. Compare on-device storage only.
  agent, Tue     Here are three on-device options. Browser storage needs no setup but the
                 browser can clear it; a small database file survives and can be searched,
                 at the cost of a library; plain files are the simplest to back up. My pick
                 among them is behind r.
  you, Tue       Which one would you go with now?
  agent, Tue     The new pick is behind r; I'll keep my view out of it until you've formed
                 yours. What decides it is whether you need to search old trips ...
```

After you press `r` on the new options, the same question gets a direct answer.

## Option keep: It depends on the conversation, as mby8 reads today

The same Monday, then:

```
  you, Tue       Neither: Both assume a server. Compare on-device storage only.
  agent, Tue     Here are three on-device options. I'd go with the small database file: it
                 survives the browser clearing its storage and lets you search old trips ...
```

On a card where you had never pressed `r`, the Tuesday message would read as in `reset`.

## Option run-explains: The run may always argue for its new pick

The Tuesday message reads as in `keep` on every card, whether or not you had pressed `r` on
Monday. Afterwards, "Which one would you go with now?" gets "The small database file, because ..."
on every card.

## Option quiet-run: The run's message never names its pick; the chat follows the conversation

The Tuesday "Neither" message reads as in `reset` on every card. On this card, where you had
pressed `r` on Monday, "Which one would you go with now?" then gets "The small database file,
because ..."; on a card where you never pressed `r`, it gets reset's answer.

## Technical detail (for the implementer)

- mby8's line sent with every message ("The human has not revealed the card's pick" / "has
  revealed it") is the lever in every option. The new-options run gets that line too, plus a
  rule for its `message` field, next to the options in its `--json-schema` output (1gpm).
- `reset`: the per-conversation "revealed" flag (kept per machine, for example next to the
  session id of #0021) records which recommendation was revealed, for example a hash of
  `recommendation`. When the hub writes new options, the flag no longer matches, so the line
  becomes "The human revealed an earlier pick on this card, which the new options replaced;
  they have not revealed the new one."
  The run's prompt says: "Explain how the new options answer the note; don't say which you
  recommend. Your pick goes only in `recommendation`." Pressing `r` on the new options sets the
  flag again.
- `keep`: no change; the run's prompt carries the conversation's current line, so its message
  may name the pick only where the line says "revealed".
- `run-explains`: the run's prompt asks the message to name and explain the pick; the hub then
  marks the conversation revealed, since its history now names the pick.
- `quiet-run`: the run's prompt always says "Explain how the new options answer the note; don't
  say which you recommend. Your pick goes only in `recommendation`."; the chat's line is
  unchanged.
- `docs/roadmap.md` (as pull request 14 leaves it): in E, "The chat stays neutral until you
  reveal the pick", replace "Not decided: the run's readable message is now a turn in the
  conversation …" with the answer, and add it under "Neither: new options right away" next to
  "Under #0008, the new `recommendation` stays hidden until you reveal it". In "Cross-card
  consequences", "#0008 `hidden` + the chat", replace "Still open: …". Remove "Needs a card"
  item 2, and take 2 out of row E's "Needs a card 2 and 3, for the parts they block".

## Sources

- Pull request 14, `docs/roadmap.md`, "Needs a card", item 2: "May that message name or argue for
  the new pick before you reveal it? And in a conversation where you had revealed the old pick
  (so the chat is free there, by mby8's technical detail), is the chat neutral again about the
  new one until you press `r`? It blocks the prompt of the new-options run."
- Card [20261111mby8](20261111mby8-chat-and-hidden-pick.md), technical detail: "Once the chat has
  named the pick, the conversation's history keeps it, so the line sent stays 'revealed' for that
  conversation, even if the page hides the pick again later"; and "The new-options run (0007)
  still writes a `recommendation` with the new options; the page hides it like any other, so
  this card doesn't change that run."
- Card [202611111gpm](202611111gpm-new-options-run.md), `shown-no-reminder`: "The run is a turn in
  the card's conversation (stored, shown in the panel, follow-ups reach the agent that wrote the
  options)"; "The readable message and the options can come back in one `--json-schema` output
  (a message field next to the options)."
- Card [20261111nsaj](20261111nsaj-revealed-pick-duration.md), recommendation, quoted above.
- Pull request 14, `docs/roadmap.md`, "Cross-card consequences": "Every 'neither' now gives the
  card a stored conversation, and #0002 opens the panel by default once a card has one, so after
  a 'neither' the panel is open on that card."
