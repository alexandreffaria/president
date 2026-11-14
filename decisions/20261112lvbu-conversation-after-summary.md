---
id: "20261112lvbu"
title: After you close a conversation, should your next message continue it or start a new one?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:15:53Z
created_by: claude (PR 25/27 card writer)
tags: [pr-2, chat, session, summary]
depends_on: ["0003", "0021", "20261111mby8", "2026111272fu", "202611111ky9"]
recommendation:
  option: choose
  why: >-
    A question you ask a week later is usually a follow-up ("and does the CLI throw too?"),
    and the agent answers it better remembering the files it already read than from a few
    lines of summary, so continuing is the right default. But sometimes you will want a clean
    sitting, or a pick you revealed last time hidden from the chat again, and a New
    conversation control gives you that when you want it instead of as a fixed rule. Pick same
    if you'd rather not have one more control, or fresh if every conversation should be its
    own sitting.
options:
  - id: same
    title: Continue the same session (as built)
    summary: >-
      One Claude Code session per card on this machine; after a summary is saved, your next
      message resumes it, and the agent remembers everything said before.
    pros:
      - The agent keeps what it read and what you told it; no detail lost to the summary
      - The panel and the agent agree on what was said, since both hold the whole conversation
      - Built and tested; the next summary covers only the new messages
    cons:
      - A conversation where you revealed the pick stays free about that pick until new options replace it (2026111272fu, `reset`) or Claude Code deletes the session (20261111mby8), even on a visit days later where the page hides it again
      - Every run rereads the whole history (until Claude Code compacts it), so a long-lived card's runs get slower and use more of the 1 dollar cap per run
  - id: fresh
    title: Start a new session
    summary: >-
      Closing a conversation ends its session; your next message starts a new one that reads
      the card and its saved summaries, the way another machine already does.
    pros:
      - Each conversation starts clean, neutral about the pick until you press r again, unless a saved summary names it
      - Short sessions keep each run quick and cheap
      - The earlier conversation reaches the new one only through the summary you edited
    cons:
      - The agent forgets the files it read and anything you left out of the summary; it reads them again if you ask
      - Closed without a summary, the conversation's points reach the new one not at all
      - The panel shows earlier messages the agent no longer has, which needs a divider to explain
  - id: choose
    title: Continue by default; New conversation starts fresh
    summary: >-
      Your next message resumes the same session, as built; a New conversation control (in
      the panel or the summary box) ends it and starts a new session from the card and its
      saved summaries.
    pros:
      - The agent keeps what it read for follow-ups, the usual case
      - You get a clean session, neutral about the pick unless a saved summary names it, whenever you ask for one
      - Decided each time, so you don't have to pick one rule for every visit
    cons:
      - One more control to build and explain, plus the divider fresh needs
      - You have to know when to use it; forget, and a revealed pick stays free in the chat
resolution:
  choice: choose
  resolved_at: 2026-11-12T20:22:43Z
applied_at: 2026-11-13T21:52:47Z
---

## Context

Pull request 25 keeps one Claude Code session per card on each machine (0021, `local`). When
you close a conversation (save its summary, or close it without one, as 202611111ky9's
`remind` allows), nothing says what your next message on that card is. Pull request 25 resumes
the same session, and a later summary covers only the messages after the last saved one. 0003,
0021 and the roadmap describe a new session from the summaries only for when `--resume` can't
find the session (another machine, or after Claude Code deletes it), and 0021's technical detail notes
that "starting a fresh conversation on the same card would then need a counter", without
deciding when one starts.

Example: on Monday you asked #0042's agent whether the HTTP client throws on 404 (it read
`src/http.ts`), saved the summary, and moved on. On Friday you open #0042 and ask "and does the
CLI throw too?".

## Option same: Continue the same session (as built)

```
Conversation
  you, Mon       Does our HTTP client already throw on 404?
  agent, Mon     It does: src/http.ts line 40 ...
  you, Fri       And does the CLI throw too?
  agent, Fri     No. Unlike src/http.ts, which we looked at, src/cli/run.ts catches ...
```

## Option fresh: Start a new session

```
Conversation
  you, Mon       Does our HTTP client already throw on 404?
  agent, Mon     It does: src/http.ts line 40 ...
  ── Closed Mon. A new conversation starts from the card and its summaries. ──
  you, Fri       And does the CLI throw too?
  agent, Fri     Your summary says the HTTP client throws on 404. The CLI doesn't:
                 src/cli/run.ts catches ...
```

## Option choose: Continue by default; New conversation starts fresh

```
Conversation                                      [New conversation]
  you, Mon       Does our HTTP client already throw on 404?
  agent, Mon     It does: src/http.ts line 40 ...
  you, Fri       And does the CLI throw too?          (resumes, as in same)
[New conversation]
  ── New conversation. It starts from the card and its summaries. ──
```

## Sources

- Pull request 25, `src/server/chat/service.ts` and the description: "The first message starts
  the session with an id chosen up front (`--session-id`). Later messages `--resume` it." and
  "A summary covers only the messages after the last saved summary."
- Pull requests 25 and 27, "Needs a card", item 4.
- [0003](0003-conversation-storage.md) (`summary`), [0021](0021-session-id-per-machine.md)
  (`local`, technical detail), [20261111mby8](20261111mby8-chat-and-hidden-pick.md)
  ("revealed" stays for that conversation), `docs/roadmap.md` section E, "When `--resume`
  can't find the session".
