# Decision cards: less common tasks

The parts of the decision-cards skill that most sessions don't need. `SKILL.md` (next to this
file) says when to read each section; its rules apply here too. The full card format is in
`docs/card-format.md` of the president repo (`preside help` prints its absolute path).

## Naming a project

`preside add` names the project after its folder. If another project already has that name,
president adds `-2` (`app-2`) and says so. To choose the name yourself, add `--name <name>`
(letters, digits, `.`, `_` and `-`), for example `--name shop-web` for the `web` folder of a
`shop` monorepo.

## Changing a card

The human can add a note, decide or undo at any moment, and president writes that into the
card file. So never overwrite an existing card yourself, not with a write, not with a temp file
and a rename, not with an editor: a version you made from what you read a minute ago would drop
what the human added since, without any sign. Instead:

1. Read the card.
2. Write your whole new version of it to a file next to it whose name starts with `.` (president
   ignores those), for example `<project>/decisions/.20261110q4m8-empty-state-copy.md.new`: the card as
   you read it, with your changes. Keep `status`, `resolution`, `feedback`, `seen_at`,
   `applied_at` and `defer_until` exactly as they were.
3. Replace the card with it, then remove your file:

   ```sh
   preside update <project>/decisions/20261110q4m8-empty-state-copy.md \
     <project>/decisions/.20261110q4m8-empty-state-copy.md.new &&
     rm <project>/decisions/.20261110q4m8-empty-state-copy.md.new
   ```

   It checks your version like `preside validate`, and replaces the card only if what the
   human owns is still what you read. It never replaces a decided card (`status: resolved`):
   the decision is about the card as the human saw it, so don't rewrite it; apply the decision
   (see **Applying resolved cards** in `SKILL.md`). Go by the words of the refusal. If it says
   "the card changed since you read it", it lists what changed (a note, a deferral, a reopen,
   or a decision the human made and took back since): read the card again, take that into
   account too, write your version again from the card as it is now, and run `preside update`
   again. If it says "its decision changed", don't write your version again: run
   `preside pending <project>` and handle the card as it shows it now.

   After a refused `update`, the `done:` line you have is from before the new entries: once
   your update went through, run `preside pending <project>` again and use its new `done:` line.

Every rewrite (new options after "neither", adding or removing `withdrawn`, any other change)
is made this way, straight in the card file, with no review first, so `update`'s guard
compares your version with the card the human has, notes included. Once a new card is in
`<project>/decisions/`, the human can add to it, so change it only this way.

A card `preside validate` reports as broken (a YAML error, a duplicate id) is the one
exception: president never writes a broken card, so neither the human nor `preside update`
can change it. Fix it by editing the file directly, or rename it for a duplicate id, then
validate it again.

## A new card that fails its last check

After you copy a new card into `<project>/decisions/` (step 7 of **Writing a card**),
`preside validate <project>/decisions/<file>` must print `ok` and no `warning` line. Otherwise:

- If it warns that a `depends_on` "is not a card in this project" (that card went away since
  you looked), the card is already in the human's queue: fix it with `preside update` (see
  **Changing a card**), not by editing it or copying over it.
- If it reports `id "20261110q4m8" is also used by ...` (another agent copied the same id in
  since you looked), your copy is the newer card: give the file in `<project>/decisions/` a new
  id, not the draft (it is broken, so edit its `id` directly and rename it). Then validate it
  and the other card's file again, and repeat if yours is still a duplicate. Leave the other
  card alone.

## Cards that need new options

When the human rejects all options, president appends their note to `feedback` (with
`type: neither`) and sets `needs_new_options: true`. The hub usually writes new options from
the note itself right away and removes `needs_new_options`; the card then shows up under
**New notes from the human** instead (see there). `pending` lists a card here when the flag is
still set (the hub's run failed or hasn't run). For each such card:

1. Read **all** the feedback `pending` shows for the card (every entry newer than `seen_at`, not
   only the latest `neither`). It says what was wrong or what they want instead.
2. Do any research it calls for.
3. Change the card with `preside update` (see **Changing a card**): replace `options` with new
   ones that answer the feedback (new ids are fine), rewrite or remove the `## Option <id>`
   sections to match, within the limits of **What makes a good card** in `SKILL.md`, update
   `recommendation`, and remove `needs_new_options`.
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
  `preside update` (see **Changing a card**), and rewrite the card's `## Context`, within its
  limit (not appending to it), so it says what you changed, for example "Edited by the
  project's agent: SQLite is already in the app." Otherwise change nothing. Then run the
  `done:` line.

For each:

1. Read the new entries. They may ask a question, add a constraint, ask for research, or say
   why the card is on hold.
2. Act on them (on a `neither` entry, only as its item above says): update the context or the
   options (and `recommendation`), do the research it asks for, or change the code if the
   note is about work already done. If a note needs an answer, put it in the card's body
   where the human will read it, rewriting the context rather than adding to it, so the card
   stays within the limits of **What makes a good card** in `SKILL.md`. Change the card only
   with `preside update` (see **Changing a card**).
3. Run the card's `done:` line from `pending` (`preside seen <file> --token <token>`). Don't
   edit or remove `feedback`.

## Withdrawing a card

When an open or deferred card no longer matters (the feature was dropped, another decision
answered it, the code moved on), withdraw it rather than leaving it in the human's queue.
Don't delete the file, change its `status` or rewrite it into a "Drop this question" option.
Add a `withdrawn` field with `preside update` (see **Changing a card**):

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

## Sync

A card's changes travel with its branch: you commit them there (see **Your checkout, and card
files in git** in `SKILL.md`), and the pull request takes them to main. The hub's Sync button
still commits, pulls and pushes the card changes in the registered folder while it has main
checked out, for cards that are already on main; what Sync becomes is the human's open
decision. So a card change in a folder on main (an answer to a card that was merged before it
was answered) reaches the other machines with Sync, or when you commit and push it on main
yourself, which you do only when the human asks. Sync skips a project whose folder isn't the
top folder of its git repository or whose repository has submodules, and says why when
pressed.
