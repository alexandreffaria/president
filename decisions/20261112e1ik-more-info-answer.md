---
id: "20261112e1ik"
title: What should the chat's "More info" answer look like?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T20:32:36Z
created_by: claude (PR 28 card writer)
tags: [pr-2, chat, research, more-info]
depends_on: ["0005", "20261111mby8"]
recommendation:
  option: findings
  why: >-
    In 0005 you chose the format that lands on the choice in front of you over curated
    sources, whose con was that "primary sources rarely address your exact decision, so the
    link to the options is left to you". Findings keep every quote and link, so you can still
    check the evidence, but start from what the card turns on. Pick sources if you'd rather
    judge the raw evidence without the agent framing it; pick ask-first if More info often
    researches something you didn't need.
options:
  - id: sources
    title: A list of sources, each quoted (as built)
    summary: >-
      The agent researches the card's question and lists its primary sources, each with the
      passage that matters quoted, one sentence on why it matters and a link or file path,
      then what it couldn't find or verify.
    pros:
      - You judge the evidence yourself, not the agent's reading of it
      - Closest to foundations.md's "from primary sources, with quotes"
      - Built in pull request 28
    cons:
      - You do the synthesis; a source rarely answers the card's exact question
      - The agent picks what to research; on a broad card it may look up something you already knew
  - id: findings
    title: Findings on what the card turns on, each backed by a quote
    summary: >-
      The agent names the two or three facts the decision turns on, answers each in a sentence
      or two, and backs each answer with a quoted primary source and its link, then what it
      couldn't verify.
    pros:
      - Starts from the decision, so you can use it in a minute
      - Every claim still carries its quote and link, so you can check it
    cons:
      - You see the evidence through the agent's framing; which facts it calls decisive can lean toward one option (20261111mby8 accepted that neutral facts can still point at one option)
      - Longer to write, and a wrong "this is what it turns on" sends the research the wrong way
  - id: ask-first
    title: Ask what to look into, then research
    summary: >-
      More info first lists two or three things it could look up for this card, as a short
      menu; you pick one (or type your own), and it researches that, with quotes and links.
    pros:
      - Research goes where your doubt is, not where the agent guesses it is
      - Each run is narrower, so it is quicker and cheaper
    cons:
      - Two steps before any answer, with a wait in between
      - You need to know what you don't know; for a newcomer to the topic that is the hard part
resolution:
  choice: findings
  resolved_at: 2026-11-12T20:41:59Z
applied_at: 2026-11-13T01:50:45Z
---

## Context

foundations.md lists, among what you can do on a card: "ask for **more info** / research
(from primary sources, with quotes)". 0005 decided what **Teach me** gives and says More info
is "a separate button"; no card says what More info's answer looks like. Pull request 28 adds
the button next to Teach me, and wrote its request after 0005's `sources` option (not chosen
for Teach me). Whatever you pick, the answer follows 20261111mby8: it names no pick until you
press `r`.

Example: #0042 "Should failed requests throw or return a result?" You press **More info**.

## Option sources: A list of sources, each quoted (as built)

> 1. **`src/http.ts`, line 40**: `if (!res.ok) throw new HttpError(res.status)`. Why it
>    matters: the client already throws on 404, so option A needs no new wrapper.
> 2. **TypeScript handbook, narrowing**: "…" Why it matters: …
> 3. (one or two more)
>
> **Couldn't verify:** how often requests fail offline in practice.

## Option findings: Findings on what the card turns on, each backed by a quote

> **What this turns on:**
> 1. **Does the client already throw?** Yes, on any non-2xx status: `if (!res.ok) throw new
>    HttpError(res.status)` (`src/http.ts`, line 40).
> 2. **Can the compiler force callers to handle a failure?** Only with a result type: "…"
>    (TypeScript handbook, narrowing, link).
>
> **Couldn't verify:** how often requests fail offline in practice.

## Option ask-first: Ask what to look into, then research

> I could look into:
> 1. what our HTTP client does today on a failed request
> 2. how the compiler can force callers to handle failures
> 3. how often requests fail offline
>
> Pick one, or tell me what you want to know.

Then an answer in the `sources` shape on that one point.

## Sources

- `docs/foundations.md`, "Card interactions (must have)": "ask for **more info** / research (from primary
  sources, with quotes)".
- [0005](0005-teach-me-format.md): option `sources` ("Three to five primary sources …, each
  with the passage that matters quoted and one line on why it matters"; con: "Primary sources
  rarely address your exact decision, so the link to the options is left to you"); chosen
  `worked`. `docs/roadmap.md`, section E: "*More info / research* is a separate button."
- [20261111mby8](20261111mby8-chat-and-hidden-pick.md) (`neutral`), which covers "Teach me,
  More info and your questions".
- Pull request 28, `src/server/chat/prompts.ts`, `MORE_INFO_REQUEST`: "For each source, quote
  the passage that matters, say in a sentence why it matters for this decision, and give its
  link or file path. Say what you looked for and couldn't find or verify."
