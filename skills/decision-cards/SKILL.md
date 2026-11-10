---
name: decision-cards
description: Use when you reach a decision the human should make instead of you (product direction, UX, naming, scope, architecture with real tradeoffs, anything you would otherwise guess or ask about in chat), and at the start of work in a project that has a decisions/ folder. Writes decision cards into <project>/decisions/ for the human to answer in the president app, applies resolved decisions, and rewrites options the human rejected.
---

# Decision cards

The human you work with makes the calls on direction (product, UX, naming, scope, research
questions) and you handle the implementation. When you hit a question that is theirs to answer,
don't guess and don't bury it in chat: write a **decision card**, a markdown file in the
project's `decisions/` folder. The human goes through cards in the president app, picks an
option (or rejects them all with a note), and you act on the answer.

The full format is in `docs/card-format.md` of the president repo. This skill has what you need
to write cards correctly.

## When to write a card

Write one when:

- there are 2 or more reasonable ways forward and the choice changes what the human gets
  (behaviour, look, wording, cost, scope, what is easy to change later);
- you would otherwise ask "should I do X or Y?" in chat;
- the human said they want to decide something.

Don't write one for things you own: code structure that doesn't change behaviour, library
details with an obvious answer, fixing bugs. Decide those yourself and keep the quality high.

Writing a card doesn't block you. Continue with work that doesn't depend on the answer, or build
the part that is the same for every option.

## At the start of a session

1. Make sure the project is registered with the hub (safe to repeat):

   ```sh
   president add . --create
   ```

   Use the `president` command, not `npx president` outside the president repo: an unrelated
   package with the same name exists on npm. If `president` isn't installed, tell the human
   (setup is in the president README) and keep going; cards work without the hub running.

2. See what is waiting for you:

   ```sh
   president pending
   ```

   It lists cards that were **resolved but not applied** and cards that **need new options**.
   Handle both (below) before starting new work.

## Writing a card

1. Pick the id: list `decisions/`, take the highest number and add one, zero-padded to 4 digits.
   The file is `decisions/<id>-<short-slug>.md`, e.g. `decisions/0012-empty-state-copy.md`.
2. Choose the kind:
   - `ab`: two concrete alternatives the human should compare side by side (two code styles,
     two wordings, two layouts). Exactly 2 options.
   - `choice`: 2 to 4 options shown one under another.
   - `open`: there is no sensible list of options ("what should the welcome text say?").
3. Write the frontmatter and the body. Template:

````markdown
---
id: "0012"
title: What should the empty trip list say?
status: open
kind: choice
priority: normal
created: 2026-11-10T14:03:00Z
created_by: claude-code
tags: [copy, onboarding]
depends_on: []
recommendation:
  option: action
  why: >-
    One sentence or two. Why you would pick it, based on what you know about this project.
options:
  - id: promise
    title: Lead with the offline promise
    summary: One sentence that says what this option is.
    pros:
      - A concrete advantage
    cons:
      - A concrete cost
  - id: action
    title: Lead with the next action
    summary: ...
    pros: [...]
    cons: [...]
---

## Context

What is being decided, why now, and what constrains it. Written for someone who has not read
the code. Link files and docs you relied on.

## Option promise: Lead with the offline promise

The concrete example: the actual text, a code snippet, a sketch of the screen.

## Option action: Lead with the next action

...

## Sources

- Where facts came from, with links and short quotes.
````

4. Check it: `president validate` must print `ok` for your file. Fix anything it reports.

### What makes a good card

- **Neutral framing.** The title is the question, not your answer. Describe every option the way
  its best advocate would.
- **Options that are genuinely different.** 2 to 4 of them. Not one real option and two straw
  men; not three variations of the same idea.
- **Concrete examples.** Show, don't describe: real code, real copy, real numbers. In `ab`
  cards the two examples should be directly comparable (same scenario, same length).
- **Honest tradeoffs.** Every option has cons, including the one you recommend.
- **A recommendation with reasoning,** in `recommendation`, separate from the options. Keep it
  short and say what it depends on ("if you expect more than 1000 users...").
- **Sources.** When you looked things up, link the primary source and quote the relevant line.
- **One decision per card.** If the answer to one question changes another, write two cards and
  use `depends_on`.
- `priority: high` only when work is blocked on it.

YAML pitfalls: quote ids (`id: "0012"`, `depends_on: ["0003"]`); quote strings containing `: `;
use `>-` for long text; timestamps need a timezone (`Z`).

## Applying resolved cards

A resolved card has `status: resolved` and a `resolution`:

```yaml
resolution:
  choice: action          # an option id, or "custom" with the answer in the note
  note: Keep it under 8 words.
  resolved_at: 2026-11-10T15:20:00Z
```

For each one that `president pending` lists:

1. Read the whole card, including the `note` and any `feedback`. The note can change or narrow
   the chosen option; follow it.
2. Record the decision in the project's docs (for example `docs/decisions.md`, or wherever the
   project keeps settled decisions): what was decided, the short reason, and the card id.
3. Do the work it implies, or note it as a follow-up task if it's large.
4. Mark it applied: `president applied decisions/0012-empty-state-copy.md` (this sets
   `applied_at`). Don't change `status` or `resolution`.

## Cards that need new options

When the human rejects all options, president appends their note to `feedback` (with
`type: neither`) and sets `needs_new_options: true`. For each such card:

1. Read the latest `neither` feedback carefully. It says what was wrong or what they want instead.
2. Do any research it calls for.
3. Replace `options` with new ones that answer the feedback (new ids are fine), rewrite the
   `## Option <id>` sections in the body to match, and update `recommendation`.
4. Remove `needs_new_options`. Keep `feedback`, `id`, `created` and `status: open` as they are.
5. Run `president validate`.

## Rules

- Only edit cards to apply the steps above. Never resolve a card yourself, and never change a
  `resolution` the human made.
- Write files atomically if you can (write a temp file whose name starts with `.`, then rename);
  president ignores dot-files.
- Unknown frontmatter fields are kept by president, so you can add your own bookkeeping fields.
