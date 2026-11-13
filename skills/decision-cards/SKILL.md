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

The full format is in `docs/card-format.md` of the president repo (`preside help` and
`preside validate` print its absolute path). This skill has what you need to write cards
correctly.

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

## The main folder, and card files in git

The project's **main folder** is the one registered with president, where the human's answers
are. A git worktree has its own copy of `decisions/` without them: reading or marking cards
there misses the human's answers and changes only that copy.

- Below, `<main>` means the main folder's absolute path; replace it. If you work in a worktree,
  don't `cd` to the main folder: pass its absolute path to every `preside` command (they all
  take one; the `done:` lines are already absolute). Find it with `git worktree list`: the
  first entry is the main checkout (plus the project's subfolder, if the project is one). The
  warning `preside` commands print in a worktree also names it. Never register a worktree
  with `preside add`.
- **Never commit card files in your pull request; Sync carries them.** Your branch and pull
  request hold only the docs and code you changed, never a file under `decisions/`. (Sync is
  the hub's button that commits and pushes the card changes in the main folder; see
  **Projects Sync skips** below for the ones it doesn't.) Stage your files by path, not with
  `git add -A` or `git commit -a`: changes under `decisions/` in `git status` are the human's
  and Sync's.
- The line covers every card change you make, not only answers and `applied`: no pull request
  carries a file under `decisions/`, not even one that only writes cards. The cards you write
  or change reach the human in the main folder, and Sync (or a hand commit, in a project Sync
  skips) puts them in git:
  - **a new card** is drafted outside `<main>/decisions/`, validated, reviewed by a fresh
    session until nothing should-fix is left, and only then copied into `<main>/decisions/`
    and validated there (see **Writing a card**);
  - **a rewrite** of an existing card (new options after "neither", adding or removing
    `withdrawn`) goes straight to the main folder with `preside update`, unreviewed (see
    **Changing a card**), so its guard compares your version with the card the human has,
    notes included.

## At the start of a session

1. Make sure the project's main folder is registered with the hub (safe to repeat):

   ```sh
   preside add <main> --create
   ```

   If a command says the project is not registered, run the `preside add` it prints, unless
   the path in it is a worktree.

   The project is named after its folder. If another project already has that name,
   president adds `-2` (`app-2`) and says so. To choose the name yourself, add
   `--name <name>` (letters, digits, `.`, `_` and `-`), for example `--name shop-web` for the
   `web` folder of a `shop` monorepo.

   Use the `preside` command, not `npx preside` outside the president repo: `npx` would
   fetch a package from npm instead of running yours (and never type `npx president`: an
   unrelated package has that name). If `preside` isn't installed, tell the human (setup is
   in the president README) and keep going; cards work without the hub running.

2. See what is waiting for you:

   ```sh
   preside pending <main>
   ```

   It lists cards that were **resolved but not applied**, cards that **need new options**, and
   **new notes from the human** you haven't read yet. Handle all of them (below) before starting
   new work.

   Each card in the output ends with a `done:` line, for example
   `done: preside seen /abs/path/decisions/0012-x.md --token 2-0k3j5h2g9fd`. When you have
   handled that card, run that line exactly as printed, in a shell (a path that needs it is
   already in single quotes; don't add or remove any). The token records what `pending`
   showed you, so only that is marked as handled. If the human changed the card in the
   meantime, the command refuses and says so: run `preside pending <main>` again and handle
   the card as it is now. Never write a token yourself or reuse one from an earlier run.

## Writing a card

A new card reaches the human only once a fresh session has reviewed it: you write a draft
where the hub doesn't read it, check and review it there, then copy it into
`<main>/decisions/`. Nothing checks that the review ran, and the card looks the same without
it, so don't skip it.

1. Make the id: today's UTC date plus 4 random lowercase letters and digits, for example
   `20261110q4m8`. Don't make it up or count cards; run:

   ```sh
   echo "$(date -u +%Y%m%d)$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c4)"
   ```

   Older cards in the folder may have numbered ids (`0007`); leave them as they are, and use
   their full ids in `depends_on`. The file name is `<id>-<short-slug>.md`, e.g.
   `20261110q4m8-empty-state-copy.md`. Write the draft:
   - **in a worktree**: in the worktree's own `decisions/` (under the project's subfolder, if
     the project is one; create the folder if the worktree has none), e.g.
     `<worktree>/decisions/20261110q4m8-empty-state-copy.md`, and never commit it;
   - **in the main folder itself**: outside `decisions/`, in a scratch folder outside the
     project (for example one made with `mktemp -d`), e.g.
     `<scratch>/20261110q4m8-empty-state-copy.md`. Not under a `.` or `_` name inside
     `decisions/`: the hub ignores those, but `preside validate` refuses them ("is not a card
     file").

   Two cards almost never get the same id this way; step 7 checks for it anyway.
2. Get the current time for `created`; don't guess it or copy the example's:

   ```sh
   date -u +%Y-%m-%dT%H:%M:%SZ
   ```

3. Choose the kind:
   - `ab`: two concrete alternatives the human should compare side by side (two code styles,
     two wordings, two layouts). Exactly 2 options.
   - `choice`: 2 to 4 options shown one under another.
   - `open`: there is no sensible list of options ("what should the welcome text say?").
4. Write the frontmatter and the body, **short**: the human should read the whole card in
   under a minute (about 150 to 250 words, frontmatter text included). Give only what they
   need to choose; leave out the history, the internals and how you found things out.
   Template (every `...` is a placeholder you must replace; `preside validate` rejects cards
   that still have them). The question, ids and titles are an example; replace them too:

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

   The same card filled in, at the right length (about 110 words a human reads):

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
    People who open an empty list want to plan a trip, so the next step matters most. The
    download page already makes the offline promise.
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

   What goes where:
   - `title`: the question, in plain words.
   - `## Context`: at most about 3 short sentences: what is being decided and the constraint
     that matters, for someone who has not read the code. No history, no internals, no file
     links unless the human needs to open one.
   - `options`: each has a `title`, a one-sentence `summary` that says what the option is
     (with the actual text, number or name when that is the choice), and at most 2 `pros`
     and 2 `cons`, each a short phrase.
   - `recommendation.why`: one or two sentences, saying what the pick depends on if anything.
   - `depends_on`: other cards this one builds on. Refer to cards here, not in the prose.
   - `## Option <id>: <title>` sections: leave them out by default; the summary, pros and cons
     are shown without them. Add one only when the choice is about how something looks or
     reads and the summary can't show it: then a tiny example (a few lines of copy, code or
     a sketch), the same size for every option.
   - No `## Sources` section, and no other extra sections. Give the sources you used to the
     reviewer (step 6), not the human.

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

5. Check the draft: `preside validate <draft>` (for example
   `preside validate <worktree>/decisions/20261110q4m8-empty-state-copy.md`) must print `ok`. Fix
   anything it reports (each problem names the field and the line). In a worktree, two things
   it may say are not problems with the card:
   - a note that the worktree "is not registered with the hub ... Register it: preside add
     <worktree>": ignore it, and never register a worktree;
   - a warning that a `depends_on` "is not a card in this project", for a card that is in
     `<main>/decisions/`: the worktree's `decisions/` lacks the main folder's uncommitted
     cards, so its id and dependency checks are not authoritative. Only step 7's validate in
     the main folder is. (A draft in a scratch folder gets neither check: `validate` reads only
     that file, so its `depends_on` is checked first at step 7.)
6. Have a fresh session review the draft: one that didn't write it, for example a subagent
   you start for this. Give it the draft's absolute path, the sources you used and the
   **What makes a good card** list below (paste it in; it may not have this skill), and ask
   it to check the card against that list, to check every fact against its source, and to
   mark each finding should-fix (a wrong or one-sided fact, a missing or straw-man option,
   anything the human could decide wrongly from, a card over the length limits, or anything
   in it the human doesn't need in order to choose) or nit. Ask it to cut before it adds:
   for each sentence, would the human choose differently without it? If not, it goes. Fix what it finds, validate the draft again,
   and have a fresh session review the fixed draft, round after round, until a review finds
   nothing should-fix. If you can't start a fresh session, don't copy the card in: tell the
   human where the draft is.
7. List `<main>/decisions/` again. If another card has your id, give the draft a new one
   (make it as in step 1, change its `id` and rename the file to match). Check that every
   id in the draft's `depends_on` is a card in that list; if one isn't, fix the draft. If
   you changed the draft, validate it again. Then copy it into the main folder, by absolute
   path (`<main>/decisions/20261110q4m8-empty-state-copy.md`), never over an existing file,
   and run `preside validate <main>/decisions/20261110q4m8-empty-state-copy.md`: it must
   print `ok` and no `warning` line.
   - If it warns that a `depends_on` "is not a card in this project" (that card went away
     since you looked), the card is already in the human's queue: fix it with
     `preside update` (see **Changing a card**), not by editing it or copying over it.
   - If it reports `id "20261110q4m8" is also used by ...` (another agent copied the same id
     in since you looked), your copy is the newer card: give the file in `<main>/decisions/`
     a new id, not the draft (it is broken, so edit its `id` directly and rename it, see
     **Changing a card**). Then validate it and the other card's file again; if yours is
     reported as a duplicate again, give it a new id again. Leave the other card alone.

   Then delete the draft (and the scratch folder, if you made one), so your branch never
   commits it. The card is in the human's queue now; leave it uncommitted.

### What makes a good card

- **Short.** Readable in under a minute: about 150 to 250 words. Context at most about 3 short
  sentences; each option a title, a one-sentence summary, at most 2 pros and 2 cons as short
  phrases; the recommendation's `why` one or two sentences. No `## Sources` section, no
  history, no internals.
- **Only the main decision points.** Keep what would change the human's choice; cut the rest.
- **Neutral framing.** The title is the question, in plain words, not your answer. Describe
  every option the way its best advocate would.
- **Options that are genuinely different.** 2 to 4 of them. Not one real option and two straw
  men; not three variations of the same idea.
- **Concrete, and small.** Put the real text, number or name in the summary. An `## Option`
  section with a tiny example only when the choice is about how something looks or reads; in
  `ab` cards the two examples are directly comparable (same scenario, same length).
- **Honest tradeoffs.** Every option has a con, including the one you recommend.
- **A recommendation with reasoning,** in `recommendation`, separate from the options, saying
  what it depends on ("if you expect more than 1000 users...").
- **Correct facts.** Check them yourself, and give the reviewer your sources; the card
  doesn't list them.
- **One decision per card.** If the answer to one question changes another, write two cards and
  use `depends_on` (refer to other cards there, not in the prose).
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

For each one that `preside pending <main>` lists:

1. Read the whole card, including the resolution's `note` and the new notes `pending` shows.
   The note can change or narrow the chosen option; follow it.
2. On your branch, record the decision in the project's docs (for example
   `docs/decisions.md`, or wherever the project keeps settled decisions): what was decided,
   the short reason, and the card id.
   **If pending says "Decided again"** (the human reopened the card and decided differently;
   `feedback` has a `reopen` entry with `previous_resolution`), don't add a second entry:
   update or replace the earlier record for this card id, and undo work for the old decision
   that no longer applies.
3. Do the work it implies on the same branch, or note it as a follow-up task if it's large.
   Your pull request holds only these docs and code changes, no card file; since it doesn't
   show the decision, link to the card or quote it.
4. Run the card's `done:` line from `pending` (`preside applied <file> --token <token>`;
   it marks the card in the main folder and sets `applied_at` and `seen_at`). Don't change
   `status` or `resolution` yourself, and leave the card uncommitted: the human's Sync carries
   their answer and your "applied" to the main branch.

   If it refuses because the card changed and the decision you acted on is gone (the human
   took it back with Undo, or reopened it before you finished), revert the docs entry and the
   work you did for it, then run `preside pending <main>` again.

### Projects Sync skips

Sync (the hub's Sync button) skips a project whose folder isn't the top folder of its git
repository (a monorepo subfolder, a folder inside a home folder kept in git, a folder not in
git at all), a project whose repository has git submodules (a `.gitmodules` file or a
submodule in the index), and one whose file list is too long to check for them. Pressing
Sync says why. In such a project, if it is in git, the card changes in the main folder (the
human's answers, your `applied` marks, new cards you copied in, rewrites) reach the main
branch only when someone commits `decisions/` on it by hand, in the main folder, and pushes
it. Do that only when the human asks you to, and never in a pull request.

## Cards that need new options

When the human rejects all options, president appends their note to `feedback` (with
`type: neither`) and sets `needs_new_options: true`. The hub usually writes new options from
the note itself right away and removes `needs_new_options`; the card then shows up under
**New notes from the human** instead (see there). `pending` lists a card here when the flag is
still set (the hub's run failed or hasn't run). For each such card:

1. Read **all** the feedback `pending` shows for the card (every entry newer than `seen_at`, not
   only the latest `neither`). It says what was wrong or what they want instead.
2. Do any research it calls for.
3. Change the card with `preside update` (see **Changing a card** below): replace `options`
   with new ones that answer the feedback (new ids are fine), rewrite or remove the
   `## Option <id>` sections in the body to match, keep the card short (see **What makes a
   good card**), update `recommendation`, and remove `needs_new_options`.
   Keep `feedback`, `id`, `created`, `status` and `defer_until` as they are.
4. Once `preside update` has replaced the card, run the card's `done:` line from `pending`.

## New notes from the human

The human can add a note to a card without deciding (also to one already decided: the
decision stands; judge whether the note changes your work), give a reason when deferring,
reopen a decided card, take back a decision with Undo, or save the summary of a conversation
they had with an agent about the card. These land in `feedback` (`type: note`, `defer`,
`reopen`, `undo` or `chat`), and `preside pending` lists every card with feedback newer than its
`seen_at`. A `chat` entry (printed `chat <time>: <text>`) is a conversation summary the human
edited: read it as a note from them about a conversation you didn't see. Three of them need care:

- **`undo`**: the human took back a decision right after making it (`previous_resolution` is
  the decision). If you recorded it in the docs or changed code for it, revert that. If you
  never saw it, there is nothing to undo.
- **`reopen` alone** (the card is open again, not decided again yet): don't change the docs or
  the code yet; the earlier decision stands until there is a new one. Run the `done:` line.
  When the human decides again, `pending` lists the card as "Decided again": replace the
  earlier record then.
- **`neither`** (printed `neither <time>: <text>`; in `--json`, a `new_notes` entry with
  `type: "neither"`) on a card listed here, so without `needs_new_options`: the hub already
  wrote new options from that note, with `preside update`'s checks, and left the note unread
  for you. Don't answer the note again with options of your own. Read the hub's options
  against the code and your current work. If one of them states a fact that is wrong or
  leaves out one that matters, or clashes with what you are building, change only that, with
  `preside update` (see **Changing a card**), and add a line to the card's `## Context`
  saying what you changed, for example "Edited by the project's agent: noted that SQLite is
  already in the app (`src/db.ts`)." Otherwise change nothing. Then run the `done:` line.

For each:

1. Read the new entries. They may ask a question, add a constraint, ask for research, or say
   why the card is on hold.
2. Act on them (on a `neither` entry, only as its item above says): update the context or the
   options (and `recommendation`), do the research and put what changes the choice in the
   card, briefly, or change the code if the
   note is about work already done. If a note needs an
   answer, put it in the card's body where the human will read it. Change the card only with
   `preside update` (see **Changing a card**).
3. Run the card's `done:` line from `pending` (`preside seen <file> --token <token>`). Don't
   edit or remove `feedback`.

## Withdrawing a card

When an open or deferred card no longer matters (the feature was dropped, another decision
answered it, the code moved on), withdraw it rather than leaving it in the human's queue.
Don't delete the file, change its `status` or rewrite it into a "Drop this question" option.
Add a `withdrawn` field with **Changing a card** below (`preside update`):

```yaml
withdrawn:
  at: 2026-11-14T10:00:00Z
  reason: "The map screen was dropped, so the tiles no longer matter."
```

- `at` is the current UTC time (`date -u +%Y-%m-%dT%H:%M:%SZ`). `reason` is one or two
  sentences for the human; quote it, since a ` #` (as in `#0015`) or a `: ` would otherwise
  cut or break it.
- Keep everything else as it is, `status` included.
- If you change your mind, remove the field with another `preside update`.
- A decided card can't be withdrawn (`update` refuses it): apply the decision instead.
- The hub lists the card in its "Withdrawn by agents" section with your reason, and the human
  can put it back. The human can still decide it or add a note, so keep handling what
  `preside pending` shows for it. Cards that depend on it keep waiting until the human decides
  it.
- If the human puts it back (Back to queue), the hub removes the field and adds the note
  "Back in the queue", which `preside pending` shows you like any other note.
- `preside validate` prints `ok      <file> (withdrawn: <reason>)` for it, and `preside pending`
  marks it "(withdrawn)" after its title, with your reason on the next line.

## Changing a card

The human can add a note, decide or undo at any moment, and president writes that into the
card file. So never overwrite an existing card yourself, not with a write, not with a temp file
and a rename, not with an editor: a version you made from what you read a minute ago would drop
what the human added since, without any sign. Instead:

1. Read the card.
2. Write your whole new version of it to a file next to it whose name starts with `.` (president
   ignores those), for example `<main>/decisions/.20261110q4m8-empty-state-copy.md.new`: the card as
   you read it, with your changes. Keep `status`, `resolution`, `feedback`, `seen_at`,
   `applied_at` and `defer_until` exactly as they were.
3. Replace the card with it, then remove your file:

   ```sh
   preside update <main>/decisions/20261110q4m8-empty-state-copy.md \
     <main>/decisions/.20261110q4m8-empty-state-copy.md.new &&
     rm <main>/decisions/.20261110q4m8-empty-state-copy.md.new
   ```

   It checks your version like `preside validate`, and replaces the card only if what the
   human owns is still what you read. It never replaces a decided card (`status: resolved`):
   the decision is about the card as the human saw it, so don't rewrite it; apply the decision
   (see **Applying resolved cards**). Go by the words of the refusal. If it says "the card
   changed since you read it", it lists what changed (a note, a deferral, a reopen, or a
   decision the human made and took back since): read the card again, take that into account
   too, write your version again from the card as it is now, and run `preside update`
   again. If it says "its decision changed", don't write your version again: run
   `preside pending <main>` and handle the card as it shows it now.

   After a refused `update`, the `done:` line you have is from before the new entries: once
   your update went through, run `preside pending <main>` again and use its new `done:` line.

Every rewrite is made this way, straight in the main folder, with no review first. A new
card is not: it is drafted and reviewed outside `<main>/decisions/` and then copied in (see
**Writing a card**). Once it is in `<main>/decisions/`, the human can add to it, so change it
only this way.

A card `preside validate` reports as broken (a YAML error, a duplicate id) is the one
exception: president never writes a broken card, so neither the human nor `preside update`
can change it. Fix it by editing the file directly, or rename it for a duplicate id, then
validate it again.

## Rules

- Only edit cards to apply the steps above. Never resolve a card yourself, and never change a
  `resolution` the human made.
- Change existing cards only with `preside update` (see **Changing a card**), except to fix
  a broken one.
- Unknown frontmatter fields are kept by president, so you can add your own bookkeeping fields
  to an open or deferred card, through `preside update`. A decided card can't be changed.
