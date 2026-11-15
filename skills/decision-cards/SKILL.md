---
name: decision-cards
description: Use when you reach a decision the human should make instead of you (product direction, UX, naming, scope, architecture with real tradeoffs, anything you would otherwise guess or ask about in chat), and at the start of work in a project that has a decisions/ folder. Writes decision cards into <project>/decisions/ for the human to answer in the president app, applies resolved decisions, and rewrites options the human rejected.
---

# Decision cards

The human makes the calls on direction (product, UX, naming, scope, research questions); you
handle the implementation. When a question is theirs, don't guess and don't bury it in chat:
write a **decision card**, a markdown file in the project's `decisions/` folder. The human
picks an option in the president app (or rejects them all with a note), and you act on the
answer.

The full format is in `docs/card-format.md` of the president repo (`preside help` and
`preside validate` print its absolute path). Less common tasks are in `reference.md` in this
skill's folder; **Less common tasks** below says when to read each part.

## When to write a card

Write one when:

- there are 2 or more reasonable ways forward and the choice changes what the human gets
  (behaviour, look, wording, cost, scope, what is easy to change later);
- you would otherwise ask "should I do X or Y?" in chat;
- the human said they want to decide something.

Not for things you own: code structure that doesn't change behaviour, library details with an
obvious answer, fixing bugs. Decide those yourself and keep the quality high.

A card doesn't block you: continue with work that doesn't depend on the answer, or build the
part that is the same for every option.

## The main folder, and card files in git

The **main folder** is the project folder registered with president, where the human's
answers are. A git worktree's `decisions/` is a copy without them: reading or marking cards
there misses the answers and changes only that copy.

- `<main>` below is the main folder's absolute path. In a worktree, don't `cd` there: pass it
  to every `preside` command (`done:` lines are already absolute). It is the first entry of
  `git worktree list` (plus the project's subfolder, if the project is one), and the warning
  `preside` prints in a worktree names it. Never register a worktree with `preside add`.
- **Never commit card files in a pull request; Sync carries them** (the hub's button that
  commits and pushes the main folder's card changes; for projects it skips, see
  **Less common tasks**). That covers every card change you make, not only answers and
  `applied`: no pull request carries a file under `decisions/`, not even one that only writes
  cards. Stage files by path, never with `git add -A` or `git commit -a`: changes under
  `decisions/` in `git status` are the human's and Sync's.
- A **new card** is drafted outside `<main>/decisions/`, reviewed, and only then copied in
  (**Writing a card**); a **rewrite** of an existing card goes straight to the main folder
  with `preside update` (**Less common tasks**).

## At the start of a session

1. Make sure the main folder is registered with the hub (safe to repeat):

   ```sh
   preside add <main> --create
   ```

   If a command says the project is not registered, run the `preside add` it prints, unless
   its path is a worktree. The project is named after its folder (to choose the name, see
   **Less common tasks**).

   Outside the president repo, run `preside`, not `npx preside` (`npx` would fetch a package
   from npm instead of yours), and never `npx president` (an unrelated package). If `preside`
   isn't installed, tell the human (setup is in the president README) and keep going; cards
   work without the hub running.

2. See what is waiting for you, and handle all of it before new work:

   ```sh
   preside pending <main>
   ```

   It lists cards **resolved but not applied** (**Applying resolved cards**), cards that
   **need new options** and **new notes from the human** you haven't read (both in
   **Less common tasks**).

   Each card ends with a `done:` line, e.g.
   `done: preside seen /abs/path/decisions/0012-x.md --token 2-0k3j5h2g9fd`. Once you have
   handled the card, run that line exactly as printed, in a shell (a path that needs quotes
   already has single quotes; don't add or remove any). The token records what `pending`
   showed you, so only that is marked handled. If the human changed the card meanwhile, the
   command refuses: run `preside pending <main>` again and handle the card as it is now.
   Never write a token yourself or reuse one from an earlier run.

## Writing a card

A new card reaches the human only once a fresh session has reviewed it: draft it where the
hub doesn't read it, review it there, then copy it into `<main>/decisions/`. Nothing checks
that the review ran, so don't skip it.

1. Make the id (today's UTC date plus 4 random lowercase letters and digits, e.g.
   `20261110q4m8`) with this command, never by hand or by counting cards:

   ```sh
   echo "$(date -u +%Y%m%d)$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c4)"
   ```

   Leave older numbered ids (`0007`) as they are, and use full ids in `depends_on`. The file
   name is `<id>-<short-slug>.md`, e.g. `20261110q4m8-empty-state-copy.md`. Write the draft:
   - **in a worktree**: in its own `decisions/` (under the project's subfolder, if the
     project is one; create it if needed), and never commit it;
   - **in the main folder itself**: in a scratch folder outside the project (e.g. from
     `mktemp -d`), not under a `.` or `_` name inside `decisions/`: the hub ignores those,
     but `preside validate` refuses them ("is not a card file").

   Duplicate ids are rare this way; step 7 checks anyway.
2. Get the current time for `created` (don't guess it or copy the example's):

   ```sh
   date -u +%Y-%m-%dT%H:%M:%SZ
   ```

3. Choose the kind:
   - `ab`: two concrete alternatives to compare side by side (two code styles, wordings,
     layouts). Exactly 2 options.
   - `choice`: 2 to 4 options shown one under another.
   - `open`: no sensible list of options ("what should the welcome text say?").
4. Write the card within the limits in **What makes a good card**. Template (replace every
   `...`, which `preside validate` rejects, and the example question, ids and titles):

````markdown
---
id: "20261110q4m8"
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
  why: ...
options:
  - id: promise
    title: Lead with the offline promise
    summary: ...
    pros:
      - ...
    cons:
      - ...
  - id: action
    title: Lead with the next action
    summary: ...
    pros: [...]
    cons: [...]
---

## Context

...
````


   Filled in, at a good length:

~~~~markdown
---
id: "20261110q4m8"
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
    People with an empty list want to plan a trip, and the download page already makes the
    offline promise.
options:
  - id: promise
    title: Lead with the offline promise
    summary: The list says "Your trips, even without signal" above a New trip button.
    pros:
      - Says what sets the app apart
    cons:
      - The next step is less obvious
  - id: action
    title: Lead with the next action
    summary: The list says "Plan your first trip" above a New trip button.
    pros:
      - Clear next step
      - Shortest text
    cons:
      - Doesn't mention offline use
---

## Context

A new user's trip list is empty: one line of text and a New trip button. Which line should
it show?
~~~~


   An `open` card needs no options; the human answers in their own words:

   ```markdown
   ---
   id: "20261110w2zd"
   title: What should the app say the first time someone opens it?
   status: open
   kind: open
   created: 2026-11-10T14:03:00Z
   created_by: claude-code
   ---

   ## Context

   The first screen is empty: one short line and a button. What tone do you want?
   ```

5. `preside validate <draft>` must print `ok`; fix what it reports. In a worktree, two things
   it may say are not problems with the card:
   - the worktree "is not registered with the hub": ignore it; never register a worktree;
   - a `depends_on` "is not a card in this project", for a card in `<main>/decisions/`: the
     worktree lacks the main folder's uncommitted cards, so only step 7's validate checks ids
     and dependencies. (A draft in a scratch folder gets neither check: `validate` reads only
     that file.)
6. Have a fresh session review the draft: one that didn't write it, e.g. a subagent you start
   for this. Give it the draft's absolute path, your sources and the **What makes a good
   card** list (paste it in; it may not have this skill). Ask it to check the card against
   that list and every fact against its source, and to mark each finding should-fix (a wrong
   or one-sided fact, a missing or straw-man option, anything the human could decide wrongly
   from, a card over the limits, anything not needed to choose) or nit. Fix, validate again,
   and have a fresh session review the fixed draft, round after round, until a review finds
   nothing should-fix. If you can't start a fresh session, don't copy the card in: tell the
   human where the draft is.
7. List `<main>/decisions/` again. If another card has your id, give the draft a new one (as
   in step 1: change its `id` and rename the file). Check that every `depends_on` id is in
   that list, and fix the draft if not; validate again if you changed it. Copy it into the
   main folder by absolute path, never over an existing file, and run
   `preside validate <main>/decisions/<file>`: it must print `ok` and no `warning` line.
   If it warns about a `depends_on` or reports a duplicate id instead, see **Less common
   tasks**.

   Then delete the draft (and your scratch folder), so your branch never commits it. The card
   is in the human's queue now; leave it uncommitted.

### What makes a good card

- **Short: at most about 250 words, usually fewer.** Only what would change the human's
  choice; no history, internals or how you found out. Cut before you add: a sentence the
  choice doesn't need goes.
- **The limits.** `## Context`: at most about 3 short sentences. Each option: a title, a
  one-sentence summary, at most 2 pros and 2 cons, each a short phrase. `why`: one or two
  sentences. No `## Sources` or other extra sections; your sources go to the reviewer.
- **Neutral framing.** The title is the question in plain words, not your answer. Describe
  each option as its best advocate would.
- **Options that are genuinely different.** 2 to 4, not straw men or variations of one idea.
- **Concrete.** The real text, number or name goes in the summary. A `## Option <id>` section
  only for a tiny example when the choice is about how something looks or reads, the same
  size for each option.
- **Honest tradeoffs.** Every option has a con, including the one you recommend.
- **A recommendation** saying what it depends on ("if you expect more than 1000 users...").
- **One decision per card.** If one answer changes another question, write two cards and use
  `depends_on`; refer to other cards there, not in the prose.
- `priority: high` only when work is blocked on it.

YAML pitfalls: quote ids (`id: "20261110q4m8"`, `depends_on: ["0003"]`); quote any text
containing ` #` or `: ` (unquoted, ` #` starts a comment and cuts the text off); use `>-` for long text;
timestamps need a timezone (`Z`).

## Applying resolved cards

A resolved card has `status: resolved` and a `resolution`:

```yaml
resolution:
  choice: action          # an option id, or "custom" with the answer in the note
  note: Keep it under 8 words.
  resolved_at: 2026-11-10T15:20:00Z
```


For each one `preside pending <main>` lists:

1. Read the whole card, including the resolution's `note` and the new notes `pending` shows.
   The note can change or narrow the chosen option; follow it.
2. On your branch, record the decision in the project's docs (e.g. `docs/decisions.md`, or
   wherever it keeps settled decisions): what was decided, the short reason, the card id.
   **If pending says "Decided again"** (the human reopened the card and decided differently;
   `feedback` has a `reopen` entry with `previous_resolution`), don't add a second entry:
   update or replace the earlier record for this card id, and undo work for the old decision
   that no longer applies.
3. Do the work it implies on the same branch, or note it as a follow-up task if it's large.
   The pull request holds only these docs and code changes, no card file; since it doesn't
   show the decision, link to the card or quote it.
4. Run the card's `done:` line (`preside applied <file> --token <token>`; it marks the card in
   the main folder and sets `applied_at` and `seen_at`). Don't change `status` or
   `resolution` yourself, and leave the card uncommitted: the human's Sync carries their
   answer and your "applied" to the main branch.

   If it refuses because the decision you acted on is gone (the human took it back with
   Undo, or reopened the card before you finished), revert the docs entry and the work for
   it, then run `preside pending <main>` again.

## Rules

- Only edit cards to apply the steps here and in `reference.md`. Never resolve a card
  yourself, and never change a `resolution` the human made.
- Never overwrite an existing card (with a write, a temp file and a rename, or an editor):
  change it only with `preside update`, except to fix a broken one.
- president keeps unknown frontmatter fields, so you can add your own bookkeeping fields to
  an open or deferred card, through `preside update`. A decided card can't be changed.

## Less common tasks

Read the section of `reference.md` (in this skill's folder) when:

- **Naming a project**: you want to choose the name `preside add` gives it, or it added
  `-2` to one.
- **Changing a card**: before you change a card already in `<main>/decisions/` (new options,
  a context rewrite, `withdrawn`, a broken card), and when `preside update` refuses.
- **Cards that need new options**: `pending` lists one.
- **New notes from the human**: `pending` lists new notes on a card (`note`, `defer`,
  `reopen`, `undo`, `chat`, or a `neither` the hub already answered).
- **A new card that fails its last check**: step 7's validate of your copy in
  `<main>/decisions/` warns about a `depends_on` or reports a duplicate id.
- **Withdrawing a card**: an open or deferred card no longer matters.
- **Projects Sync skips**: the project isn't the top folder of its git repository or has
  submodules, Sync says it skips it, or the human asks you to commit `decisions/` by hand.
