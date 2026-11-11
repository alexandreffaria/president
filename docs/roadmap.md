# president — roadmap

The work that settled decisions imply and that isn't built yet. Each section says which card
decided it; the card file has the full reasoning, the options that weren't chosen and the
sources. The decisions themselves are listed in [foundations.md](foundations.md#settled-decisions).

Build what is written here; don't re-decide it. Where a section says something is still open
("Not decided", or a [Needs a card](#needs-a-card) entry), that is a question for the human:
write a card (see `skills/decision-cards/SKILL.md`) rather than picking an answer. Small
details no card fixes and that only an implementer would notice (which free key a new shortcut
gets, a variable name) are yours; say in the pull request what you picked so the human can
object.

Status on 2026-11-11: B (Sync) is built; the rest isn't. Cards #0001 to #0024 are all decided.

## Build plan

Each row is one pull request (PR 2 may be split, see its section). The order is a suggestion;
"Depends on" is what must be merged first.

| # | Work | Decided by | Depends on | Suggested order |
|---|---|---|---|---|
| A | [Agent rules: the skill line for #0022](#a-agent-rules-the-skill-line-for-0022) | #0022 | PR #7 (it edits `SKILL.md`). It doesn't wait for [Needs a card](#needs-a-card) 1: A ships the card's line as written plus the main-folder rule, and a later pull request narrows them once that card is answered | First: every agent that applies a decision needs it, starting with the next one |
| B | [Sync](#b-sync-0001) | #0001, #0022 | nothing | **Built** (`src/server/sync.ts`, `src/web/components/Sync.tsx`) |
| C | [Queue and card UX](#c-queue-and-card-ux) | #0008, #0009, #0010, #0011, #0012, #0014 (hub part), #0015, #0017 | D's `withdrawn` definition, for the Withdrawn section only | Alongside B; before PR 2, which builds on #0010's Neither panel and #0011's notes on decided cards |
| D | [Card format and CLI](#d-card-format-and-cli) | #0013, #0014 (format part), #0023 (format part) | PR #7 (it edits `card-format.md` and `SKILL.md`) | Before or with C and PR 2; `chat` must exist before PR 2 writes it |
| E | [PR 2: the per-card chat](#e-pr-2-the-per-card-chat) | #0002, #0003, #0004, #0005, #0006, #0007, #0018, #0019, #0020, #0021, #0023, #0024 | C (#0010's panel, #0011's notes on decided cards), D (`chat` type); the PR 2 cards in [Needs a card](#needs-a-card) | After C and D |
| F | [Rename the command](#f-rename-the-command-0016) | #0016 | the [new name](#needs-a-card) card | When the name is chosen, at a moment with no other pull request open, since it touches about 200 lines everywhere; ideally before E, which adds new printed commands |

Nothing here needs Sync to be built first: B is early because of #0022, not because the others
depend on it.

## A. Agent rules: the skill line for #0022

Card: [0022-card-changes-in-apply-prs.md](../decisions/0022-card-changes-in-apply-prs.md),
option `sync-only`. An agent that applies decisions:

1. reads the decision with `president pending` **in the project's main folder** (the folder
   registered with president). The skill today says only "the project root, the folder that
   contains `decisions/`", which in a worktree is the worktree's copy; A changes it to the main
   folder;
2. does the docs and code work on its own branch; its pull request contains **only** the docs
   and code it changed, never a file under `decisions/`. Because the pull request doesn't show
   the decision, it links to the card or quotes it;
3. runs the `done:` line (`president applied ... --token ...`) **in the main folder**, so the hub
   shows "applied" as soon as the agent is done and no other agent picks the card up again;
4. leaves the human's card changes (the answer and "applied") uncommitted: Sync carries them.

The skill gains the card's line: "Never commit card files in your pull request; Sync carries
them." Today's skill says nothing about committing. A also changes "Run every `president`
command from the project root" to: run them in the project's main folder (the registered one),
never in a worktree, and never run `president add` from a worktree. The chosen option reads and
marks the decision "in the project's main folder", and from a worktree an agent following
today's line would miss the human's uncommitted answers (`president pending` reads the folder
it runs in) and mark the worktree's copy applied (`applied`, `seen` and `update` act on the card
path they are given).

Not decided: whether the line also covers card changes an agent makes outside an apply (new
cards, `president update` rewrites; see [Needs a card](#needs-a-card) 1); read literally, it
does. A doesn't wait for that card: it ships the card's line as written plus the main-folder
rule, and once the card is answered a later pull request narrows them if the answer calls for it.

Known costs the human accepted: main can say "applied" before the docs are merged, and if the
pull request is dropped, nothing on the card says so.

### Until the Sync button exists

(Sync, B, is now built: press Sync in the hub. What follows is for a checkout without it.)
Your answers reach main only when someone commits `decisions/` on main by hand in the main
folder (the step Sync will automate); an agent can do it when you ask. Agents must not do it
inside their pull requests. Because those pull requests never touch `decisions/`, a plain
`git pull` in the main folder keeps working while your answers are uncommitted there, as long
as nothing pushed changes those same cards (a pull stops when it brings in a change to a file
you have changed; that was PR 5's problem).

## B. Sync (#0001)

Card: [0001-sync-across-machines.md](../decisions/0001-sync-across-machines.md), option
`sync`. Under #0022 this is the only way your answers reach git, apart from a hand commit.

**Built** as written below: the git sequence and its checks in `src/server/sync.ts` (git is
run by `src/server/git.ts`), `GET` and `POST /api/sync` in `src/server/app.ts`, the fetch at
hub start in `src/server/server.ts`, the top bar's Sync button, `s` key, counts and report in
`src/web/components/Sync.tsx`. Tests against scratch repositories: `test/sync.test.ts`,
`test/sync-api.test.ts`, `test/web/sync.test.tsx`. Usage is in the README. Details this
section left open were settled the simplest safe way, and the human can change any of them:

- Card actions in a project are **refused** (409, "Sync is running in shop, so nothing was
  changed; try again when it finishes"), not held, while its Sync runs; what the human typed
  stays as a draft. A Sync waits for a card write already under way.
- Sync only works on a project whose folder is the **top folder of its git repository** (or
  worktree). A project inside a bigger repository (a home folder kept in git, a monorepo
  subfolder) is reported as skipped rather than committed into that repository.
- Check 1 also requires the checked-out branch to have the **same name** as the remote's
  default branch, not only to track it: `git checkout -b feat origin/main` tracks
  `origin/main` too. The remote's default comes from `refs/remotes/<remote>/HEAD` (git 2.48+
  records it on fetch), else from `git ls-remote --symref`.
- Check 3 also counts **untracked files** at a path the remote added as uncommitted edits
  (the pull would otherwise fail on them).
- The rebase, merge, detached-HEAD and no-upstream parts of check 1 run **before** the fetch
  (they need no network); the rest after it, as in the card.
- Sync skips a project with no card changes here or on the remote (after its fetch) without
  saying anything; if every project had none, the page says "Nothing to sync".
- Commits run the project's own git hooks (no `--no-verify`) and sign as the user's git
  config says. The machine's name in the commit message is the short hostname.
- Timeouts: 60 s for `fetch`, `pull`, `push` and `ls-remote`, 30 s for local commands; git
  gets SIGTERM, then SIGKILL 2 s later, with everything it started. git never prompts:
  `GIT_TERMINAL_PROMPT=0`, an empty `GIT_ASKPASS` (which also turns off `core.askPass` and
  `SSH_ASKPASS`), `SSH_ASKPASS_REQUIRE=never`, no stdin and no terminal.
- The last result per project is kept in the running hub (every tab shows it until
  dismissed in that tab); a restart forgets it.
- The notice an open card shows after a pull brought in a change ("An agent changed this
  card...") is unchanged; the suggestion under "Notes for whoever builds it" is not built.

### What the human sees

- **A Sync button in the top bar**, with a single-key shortcut (the card suggests `S`; it must
  not clash with the existing keys in `src/web/keyboard.ts` and goes in the help overlay).
  Pressing it runs the steps below for every registered project that has card changes, here or
  on the remote, and reports the result per project.
- **"3 answers not synced"** in the top bar whenever a project has card changes that haven't
  been pushed, so leaving a machine without syncing is visible. Count changed and new files
  under `decisions/` plus cards changed by local commits not yet pushed.
- **At hub start, fetch only.** For each project the hub runs `git fetch`, which changes no
  file and no branch, and shows "3 card changes on the remote, press Sync" (the cards the
  remote changed: `git diff --name-only HEAD...@{u} -- decisions/`, with three dots, so answers
  here that aren't pushed yet don't count). It never pulls, commits or pushes on its own.
  A fetch that fails (offline, no remote) is shown, not fatal.
- Each refusal or failure is a sentence that says why, for example "Not now: an agent in shop
  has commits it hasn't pushed", "Not synced: 0001 changed on both machines".

### What Sync runs, per project

Exactly the sequence from the card's "How Sync works in git" section, in the project folder
(step 3 below clarifies which files the third check looks at):

```sh
git fetch
# checks; if one fails, stop here, change nothing and say why:
#  - the project's main branch (the remote's default, usually main) is checked out, and no rebase or merge is in progress
#  - git log @{u}..HEAD shows no unpushed commit that changes files outside decisions/
#  - no file the remote changed (git diff --name-only HEAD...@{u}) has uncommitted edits here
git add -- decisions/
git commit --only -m "decisions from laptop: 0003, 0005, 0009" -- decisions/    # skipped when there is nothing new to commit
git pull --rebase --autostash    # if it fails: git rebase --abort if a rebase is in progress, and don't push
# before pushing: stop if any file is conflicted or git stash list has a new entry
git push
```

The commit message names the machine (for example its hostname) and the ids of the cards it
contains.

Every step is load-bearing; each was tested in scratch repositories (git 2.56.0) and the card
explains what goes wrong without it:

1. **Branch check.** Refuse unless the remote's default branch is checked out and no rebase or
   merge is in progress. This keeps answers off an agent's feature branch and out of a rebase
   the agent started. A project with no upstream (`@{u}` doesn't resolve) fails the checks too:
   change nothing and say so.
2. **No unpushed code commits.** Refuse if `git log @{u}..HEAD` has a commit that touches
   anything outside `decisions/`; otherwise the pull would rebase an agent's unpushed work and
   the push would publish it. Unpushed commits that only touch `decisions/` (an earlier Sync
   that couldn't push) are fine.
3. **No uncommitted edits to files the remote changed.** Refuse if any file **outside
   `decisions/`** in `git diff --name-only HEAD...@{u}` has uncommitted changes here; otherwise
   putting the autostash back can leave conflict markers in an agent's file with exit code 0.
   *This clarifies the card's sketch, whose check doesn't mention `decisions/`.* The card's
   reason for the check is the autostash: `--autostash` sets aside "the checkout's other
   uncommitted changes" and putting one back can conflict. Card files are committed before the
   pull (step 5), so they never go into the autostash; a card also changed on the remote stops
   the rebase instead, which is the card's "Not synced: 0001 changed on both machines" path.
   Read literally, the check would also match the human's own unsynced answers and refuse
   whenever the remote changed one of those cards (for example after a Sync or a hand commit
   on another machine), until someone fixed the checkout by hand.
4. **`git add -- decisions/` before the commit.** `git commit --only -- decisions/` alone
   silently leaves out cards git doesn't track yet (new cards an agent just wrote).
5. **Commit before pulling.** Uncommitted answers would go into the autostash, and a card also
   changed on the remote would come back with `<<<<<<<` markers and exit 0. Committed first,
   the same conflict stops the rebase with an error instead.
6. **On a failed pull:** if a rebase is in progress, take the conflicted cards from
   `git diff --name-only --diff-filter=U` first, then run `git rebase --abort` (this puts the
   checkout back as it was, the agent's uncommitted files included). Keep the answers in the
   local commit, don't push, and show "Not synced: 0001 changed on both machines", naming those
   cards. A pull can also fail without a conflict (offline, authentication); then show git's
   error instead. Resolving a conflict is a manual git step, as today; pressing Sync again
   retries.
7. **Look before pushing.** Even after a successful pull, stop without pushing if any file is
   conflicted (`git diff --name-only --diff-filter=U`) or `git stash list` has an entry that
   wasn't there before Sync started. This catches an agent writing a file while the pull had
   it set aside: git keeps the old copy in the stash ("could not apply autostash; your changes
   are safe in the stash") and exits 0. Tell the human, including that a stash entry was left
   behind and needs clearing.

Known costs the human accepted: Sync has to be remembered; it says "not now" while an agent
has unpushed code commits or edits a file the remote changed; it waits while the checkout is on
another branch. A stricter check (refuse whenever anything outside `decisions/` has
uncommitted changes, so `--autostash` isn't needed) was considered and not adopted, because
Sync would then refuse whenever an agent has work in progress.

### Notes for whoever builds it

- Run git with an argument array (no shell), in the registered project folder only, and only
  from a request that passed the hub's Host and Origin checks (`src/server/security.ts`).
- Run every git call with `GIT_TERMINAL_PROMPT=0` and a timeout, so a fetch (including the one
  at hub start) can't hang on a credential prompt.
- Sync from two tabs at once must not run two git sequences in one project; serialize per
  project. The hub must not write a card in a project while that project's Sync runs either:
  hold or refuse card actions there until it finishes.
- If `git push` fails, the answers stay in the local commit and the "not synced" count stays;
  show git's error. Pressing Sync again retries.
- After a pull brings in the human's own answers from another machine, an open card currently
  says "An agent changed this card while you had it open" (`src/web/views/CardView.tsx`),
  because this hub didn't write it. Suggestion, not decided: make the notice say the change
  came from Sync.
- Sync carries everything under `decisions/`: answers, notes, `applied_at` from agents
  (#0022), conversation summaries (#0003, #0023), `defer_until` (#0017) and `withdrawn` (#0014).
  Session ids, the hub's copy of conversations and the "not summarized" list never travel
  (#0018, #0021, #0024): they live outside the project.
- Document Sync in the README (Usage) when it ships.

## C. Queue and card UX

Hub changes (`src/core/queue.ts`, `src/core/actions.ts`, `src/web/views/QueueView.tsx`,
`src/web/views/CardView.tsx`, `src/web/components/OptionCard.tsx`) that don't need the chat.
They can ship together or one by one.

### The recommendation is hidden until you ask (#0008)

Card: [0008-recommendation-placement.md](../decisions/0008-recommendation-placement.md), option
`hidden`.

- No **Recommended** tag on the option and no **The agent's take** section until you press a key
  (the card's example is `r`; it is free today) or a **Show the agent's pick** button, shown
  where the take would be.
- After revealing, the tag and "The agent's take" appear as they do today, and stay shown on
  that card.
- Nothing preselects the recommended option today (`draft.selected` starts empty), so Enter
  doesn't leak it; keep it that way.
- Not decided: how long "stays shown" lasts (this visit, this browser session, or remembered
  for good), and whether the chat may mention the pick before you reveal it. See
  [Needs a card](#needs-a-card).
- The card's guide for revisiting: "If you find yourself always revealing it first, switch to
  `after`."

### Dependent cards sink (#0009)

Card: [0009-dependent-cards-in-queue.md](../decisions/0009-dependent-cards-in-queue.md), option
`sink`.

- In `buildQueue`, cards with an undecided dependency (`openDependencies`, where a deferred
  dependency counts as undecided, as today) go after every ready card. Within each of the two
  groups the order is #0015's: priority, then oldest first.
- They keep the "depends on #0003" mark in the queue and the warning on the card page.
- Once the dependency is decided they move back among the ready cards. `j`/`k` follow the same
  order.
- Accepted costs: a high-priority dependent card can sit below low-priority cards, and cards
  move when another card is decided.

### Queue order stays priority, then oldest (#0015)

Card: [0015-queue-order.md](../decisions/0015-queue-order.md), option `priority-oldest`.
`compareQueue` stays as it is (priority, `created` oldest first, then project name and id).
Nothing to build beyond keeping it under #0009's sink and #0017's returning cards.

### Your own answer from the Neither panel (#0010)

Card: [0010-custom-answer-on-choice-cards.md](../decisions/0010-custom-answer-on-choice-cards.md),
option `neither-plus`.

- The Neither panel (`n`) keeps **Ask for new options** (`Ctrl ⏎`) and gains **Decide this as my
  answer**, which resolves the card with `choice: custom` and what you typed as the note (already
  valid on every kind: `applyAction`, `src/core/schema.ts`). The card gives the new button no
  key.
- The panel's question is reworded to fit both buttons, as in the card's sketch: "None of these.
  What would you rather see, or what is your answer?"
- No new action-bar key and no "Own answer" action. Open cards keep today's "Your answer" field.
- Under #0007 (PR 2), **Ask for new options** starts the card's session; until PR 2 ships it
  keeps today's flow.

### Notes on decided cards (#0011)

Card: [0011-notes-on-decided-cards.md](../decisions/0011-notes-on-decided-cards.md), option
`allow`.

- `ALLOWED_FROM.note` in `src/core/actions.ts` gains `resolved`. The note is appended to
  `feedback`; `status`, `resolution` and `applied_at` stay.
- A resolved card's action bar: "This decision is made. [Note… m] [Reopen]".
- `president pending` already lists it under "New notes from the human" (`withNotes`), or with
  the card under "Resolved, not yet applied" if it isn't applied yet; no change there. The agent
  judges whether the note changes its work.
- Undo of such a note follows #0012: byte for byte, no trace.
- `docs/card-format.md` (the Lifecycle diagram, and "Deferred cards can also be … noted
  directly") says notes are for open and deferred cards; update it here, and add to the README's
  `m` row that it also works on decided cards.

### Undo keeps today's rule (#0012)

Card: [0012-undo-history.md](../decisions/0012-undo-history.md), option `hybrid`. Nothing to
build: `undoLastAction` and `afterUndoingDecision` stay. Every new action in this roadmap follows
the rule: only undoing a decision leaves an `undo` entry; undoing anything else restores the
card byte for byte. That covers a note on a decided card (#0011), a deferral with
`defer_until` (#0017) and putting a withdrawn card back (#0014). For a decision saved together
with a summary, see #0019 in E.

This holds as long as every decision is journaled as `resolve`: #0019's Save and decide must be
the `resolve` action carrying the summary, or `undoLastAction`'s `ours.action === "resolve"`
check (`src/server/cards.ts`) must include it. (#0010's "Decide this as my answer" is a
`resolve` with `custom`, so it is covered.)

### Snooze (#0017)

Card: [0017-deferred-resurfacing.md](../decisions/0017-deferred-resurfacing.md), option
`snooze`.

- `d` defers for a week at once, one key as today (the card's summary, pro and recommendation:
  "keeps d a single key"). A small menu (**Tomorrow**, **Next week**, **Next month**, **Pick a
  date…**, as in the card's sketch) offers the other dates. How the menu opens (the Defer
  button, another key) is an implementation detail, not decided UX: pick one and say which in
  the pull request. `d` itself must not wait for a second key.
- Deferring sets `status: deferred` and a new `defer_until` field (a UTC timestamp). (The
  action still accepts an optional note; the hub sends none today.)
- The queue shows deferred cards whose `defer_until` has passed among the open ones, sorted as
  usual, marked "back from deferral". **The file isn't rewritten when the date passes**; the
  queue computes it.
- Cards whose date hasn't passed stay in the collapsed "Deferred" list. **Back to queue** works
  as today.
- Build requirements that today's code doesn't meet (checked against `main`):
  - `ALLOWED_FROM.defer` is `["open"]` (`src/core/actions.ts`) and `CardView`'s `d` does
    nothing unless the card is `open`, so a card back from deferral (still `status: deferred`)
    can't be snoozed again. `ALLOWED_FROM.defer` gains `deferred`, and `d` works on a card that
    is back from deferral (it sets a new `defer_until`).
  - The deferred card's page says "Deferred. It stays out of the queue until reopened."
    (`CardView.tsx`). It says instead that the card is back from deferral, or, before the date,
    when it comes back.
  - Reopen (Back to queue), resolve, and `neither` (which also makes a deferred card `open`)
    remove `defer_until`.
  - `defer_until` joins `HUMAN_FIELDS` in `president update` (`src/cli/commands.ts`; the CLI
    part can go in D), so an agent's rewrite can't drop or change it. Today `update` guards only
    `status`, `resolution`, `feedback`, `applied_at` and `seen_at`, so a rewrite could silently
    drop the field and leave the card deferred for good.
- `defer_until` goes in `docs/card-format.md` (D can document it, or this PR).
- Not decided: what a deferred card **without** `defer_until` does (deferred before this
  ships, or by a hand edit). See [Needs a card](#needs-a-card).
- Accepted cost: cards come back whether or not anything changed.

### Withdrawn cards in the hub (#0014)

Card: [0014-withdrawn-status.md](../decisions/0014-withdrawn-status.md), option `field`. The
format part is in D.

- The queue leaves out open cards that have a `withdrawn` field and lists them in a collapsed
  **Withdrawn by agents (n)** section. Not decided: whether a withdrawn **deferred** card is
  listed under Deferred or Withdrawn, and whether it comes back when its `defer_until` passes
  (#0017). See [Needs a card](#needs-a-card).
- The card page shows "Withdrawn by the agent: <reason>" above the options, which still work:
  you can decide, note, or reject a withdrawn card as usual.
- A **Back to queue** button removes the field **and** appends a note to `feedback` (the card's
  example: "Back in the queue"). The note is required: `president update` doesn't compare
  `withdrawn`, so without it an agent's update made from an earlier read would withdraw the card
  again.
- Not decided: whether a withdrawn card still sinks the cards that depend on it (#0009); it is
  still `open`, so today's `openDependencies` would say yes. See [Needs a card](#needs-a-card).

## D. Card format and CLI

Changes to `docs/card-format.md`, `skills/decision-cards/SKILL.md`, `src/core/` and
`src/cli/`. Wait for PR #7, which edits the same two docs.

### Dated card ids (#0013)

Card: [0013-card-ids.md](../decisions/0013-card-ids.md), option `dated`.

- A new card's id is the UTC date plus 4 random lowercase letters and digits, for example
  `20261111k7q2`; the file is `decisions/20261111k7q2-sync-shortcut.md`. The card's way to make
  one:

  ```sh
  echo "$(date -u +%Y%m%d)$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c4)"
  ```

- Already valid: `CARD_ID_PATTERN` allows 1 to 32 lowercase letters and digits.
- The skill's "Writing a card", step 1, and the id paragraph of `docs/card-format.md` change to
  this rule. The duplicate-id rule (renumber the newer card) stays for the rare collision.
- **Existing cards keep their numbers**, so a project mixes both styles (the option's stated
  cost); nothing is renumbered. Old ids sort before dated ones in the folder.
- The UI shows the short form `#k7q2` (unique within its day) next to the date for dated ids;
  `0001`-style ids show as today. `depends_on`, file names and `president pending` use the full
  id.

### The `withdrawn` field (#0014)

- An agent retracts an open or deferred card by adding, through `president update`:

  ```yaml
  withdrawn:
    at: 2026-11-14T10:00:00Z
    reason: The queue was rewritten in #0015; dependencies no longer affect ordering.
  ```

  and changes its mind by removing it with another `president update`. `status` doesn't change.
  `update`'s guard already refuses the agent's version if you acted on the card meanwhile.
- Document the field in `docs/card-format.md` and the skill (when and how to withdraw). The
  card's con applies: `president pending` and `validate` don't know the field yet. Not decided:
  what they should say or do with a withdrawn card. See [Needs a card](#needs-a-card).

### The `chat` feedback type (#0023)

Card: [0023-chat-summary-feedback-type.md](../decisions/0023-chat-summary-feedback-type.md),
option `chat`.

- Add `"chat"` to `FEEDBACK_TYPES` in `src/core/model.ts`, the label **Conversation summary** to
  `LABEL` in `src/web/components/FeedbackHistory.tsx`, the type to the feedback section of
  `docs/card-format.md`, and to the skill's "New notes from the human".
- `president pending` prints it as `chat <time>: <text>` with no change.
- In a card:

  ```yaml
    - at: 2026-11-12T09:14:00Z
      type: chat
      note: I now see that B's extra code is one line per call with a helper. ...
  ```

- Accepted cost: a machine running an older president shows a card with a `chat` entry as
  broken until president is updated there. Update every machine before E ships.

## E. PR 2: the per-card chat

PR 2 replaces the placeholder `src/web/components/CardAssistant.tsx` with a conversation with a
headless Claude Code session per card (see "Chat engine" in foundations.md), plus *Teach me*,
*More info / research* and *Neither, try again*. It is large; a reasonable split is E1 (the
session, the panel, the hub's copy and session store, summaries, deciding and leaving) and E2
(*Teach me*, *More info*, Neither's new options), E2 after E1.

### The session: read and research only (#0004)

Card: [0004-chat-session-permissions.md](../decisions/0004-chat-session-permissions.md), option
`readonly`. Every run of the card's session, in the card's project folder, is:

```sh
printf '%s' "$MESSAGE" | claude -p --output-format stream-json --verbose --resume "$SESSION_ID" \
  --restricted --strict-mcp-config \
  --tools "Read,Grep,Glob,WebSearch,WebFetch" \
  --allowedTools "WebSearch,WebFetch" \
  --permission-mode dontAsk --permission-prompts none \
  --max-budget-usd 1
```

(The first message of a conversation has `--session-id <uuid>` instead of `--resume`; see
"Where the hub keeps the session id" below.)

What each flag guarantees, so none is dropped by accident:

| Flag | Why it is there |
|---|---|
| `--tools "Read,Grep,Glob,WebSearch,WebFetch"` | The only tools that exist in the session. No Edit, Write, Bash or other code-running tool. |
| `--allowedTools "WebSearch,WebFetch"` | The two web tools run without a prompt. Read, Grep and Glob need no rule: `dontAsk` runs file reads in the working directory without approval. Never add a bare `Read` rule: it matches every file on the machine (`~/.ssh`, other projects). |
| `--restricted` | Confines the file tools to the project folder (a read of `/etc/hostname` was refused in testing), skips user, project and local settings files so no hook or allow rule there widens the session, and refuses `bypassPermissions`. Keeps the user's Claude Code login (no API key needed), unlike `--bare`. Makes `--setting-sources user` unnecessary. |
| `--strict-mcp-config` | Ignores every MCP server not passed with `--mcp-config`: the project's `.mcp.json` (which `-p` connects even in an untrusted folder) and the user's own servers. |
| `--permission-mode dontAsk` | Anything that would prompt is denied without asking, so the chat never stalls on an approval. |
| `--permission-prompts none` | Nobody answers prompts; nothing is sent to a host or prompt tool. |
| `--max-budget-usd 1` | Caps the spend of one run. |
| `--output-format stream-json --verbose` | The hub streams the reply into the page. |
| `$MESSAGE` on stdin | The hub writes the message to the process's standard input (`claude --help`: `-p` is "useful for pipes", and `--input-format` is `text` by default), never as a command-line argument: a message starting with `-` is parsed as an option (`error: unknown option '--why-not-both'`), and one placed after a list flag (`--tools`, `--allowedTools`) would be taken as a tool name. |

The session never writes anything itself. **Every change to a card goes through the hub**,
with the same checks as today:

- New options (#0007, below) come back as structured output (`--json-schema` with the card's
  `options` shape), and the hub writes them with the same validation and revision checks as
  `president update`.
- Conversation summaries are returned as text; the hub writes them as a `chat` feedback entry
  (#0023) after the human has read and edited them.

Weigh when building, without changing the decision: `--safe-mode` turns off installed mods,
CLAUDE.md and skills (whether a mod still loads under `--restricted` isn't documented). The
card's known cost stays: read access plus WebFetch is still a path for a prompt-injected page
to leak project text in a URL. A WebFetch domain allowlist would narrow it but limit research;
adding one is the human's call (write a card if it comes up). The session also can't run the
project's code to check a claim, or read git history (no Bash).

### Where the conversation sits: a side panel (#0002)

Card: [0002-conversation-placement.md](../decisions/0002-conversation-placement.md), option
`side`.

- The card stays in the left column; the conversation fills a right-hand column with a close
  button, the messages, the **Teach me** and **More info** buttons and the message box, as in
  the card's sketch. The action bar (Decide, Neither, Note, Defer) stays across the bottom.
- The panel opens and closes with a key (the card names none; pick a free one and add it to the
  help overlay). It is **open by default once the card has a conversation**.
- **Below about 1100 px of width** it falls back to the conversation sitting in the page's flow,
  under the options, where the "Discuss" placeholder is today (#0002's `below` layout).
- The panel keeps its own scroll position while you move around the card. Single-key shortcuts
  already don't fire while you type, so the message box doesn't conflict with them.
- Not decided: A/B cards, which already use the 72rem two-column layout: three columns, or the
  panel overlaying the card. See [Needs a card](#needs-a-card).

### Teach me: a worked example (#0005)

Card: [0005-teach-me-format.md](../decisions/0005-teach-me-format.md), option `worked`. The first
answer to **Teach me**:

1. picks **one realistic scenario from this project**;
2. **asks you to predict** which option handles it better (before any explanation);
3. walks **each option through the scenario step by step** (the card's example is a table, one
   column per option) and points out **where they differ**;
4. says **what the scenario leaves out**.

The conversation continues after it as usual. *More info / research* is a separate button.
The card's guide: worked examples lose their edge for someone who already knows the area.

Not decided: what Teach me gives on an `open` card with no options (`docs/card-format.md` lets
one leave `options` out, so there is nothing to compare). See [Needs a card](#needs-a-card).

### Where the conversation lives (#0003, #0018, #0021)

Cards: [0003-conversation-storage.md](../decisions/0003-conversation-storage.md) (`summary`),
[0018-show-earlier-conversation.md](../decisions/0018-show-earlier-conversation.md)
(`hub-copy`), [0021-session-id-per-machine.md](../decisions/0021-session-id-per-machine.md)
(`local`).

- **The full conversation stays in Claude Code's own store** on the machine that ran it
  (`~/.claude/projects/<project>/<session-id>.jsonl`, deleted after `cleanupPeriodDays`, 30
  days by default). president never copies it into the project, and later messages resume with
  `claude --resume <session-id>`. president never parses that file (its format is internal to
  Claude Code) and doesn't add the Agent SDK.
- **The hub keeps its own copy for showing it (#0018).** The hub saves each message it
  streamed and showed you, in president's own format, to a file in president's state folder
  (`$XDG_STATE_HOME/president/`, by default `~/.local/state/president/`), for example
  `~/.local/state/president/chats/shop/0042.jsonl`: outside the project, never in `decisions/`,
  never committed. When you come back to the card on the same machine (after a reload, a
  closed tab or a hub restart) the page shows it. This copy is only for showing; continuing
  still resumes Claude Code's session.
  - If Claude Code has already deleted its copy, the page adds: "The agent no longer remembers
    this conversation; your next message starts from the summaries."
  - The hub copy needs its own cleanup. Not decided: how long it keeps conversations, and what
    happens to them when a project is unregistered or a card is removed or renumbered. See
    [Needs a card](#needs-a-card).
- **Where the hub keeps the session id (#0021).** Each machine's hub keeps its own small list
  of "project, card → session id" in `$XDG_STATE_HOME/president/` (not beside the registry in
  `$XDG_CONFIG_HOME/president/`: the registry is configuration, this is state). Example:
  `{ "president/0007": "3f2c9a8e-1b7d-4c55-9e0a-6d2f8b1c4e77" }`.
  - Generate the id up front and start the first run with `claude -p --session-id <uuid>`, so it
    is known before the run starts.
  - **Chatting never changes the card file.** Only saved summaries (and new options from #0007)
    do. So there is no `session_id` write to treat as the hub's own, no "An agent changed this
    card" notice mid-chat, and no Sync conflict from two machines chatting.
  - The card's `session_id` field goes unused: `docs/card-format.md` and the comment in
    `src/core/schema.ts` change to say it is no longer used (#0021's technical detail).
  - Accepted cost: if a card is renumbered or a project is registered under a new name, the hub
    loses track and starts a new conversation from the summaries. Dated ids (#0013) make
    renumbering rare for new cards.
- **When `--resume` can't find the session** (another machine, where there is no entry, or this
  machine after 30 days), start a fresh session seeded with the card and its earlier summaries,
  say on the page that the earlier conversation isn't available here, and replace this
  machine's entry. The conversation restarts from the summaries; that loss of detail is the
  accepted cost. Each machine keeps its own entry from then on.
- **When a conversation ends** (you close it, or decide the card, #0019), the session writes a
  short summary of what was learned and asked for (one more `claude -p --resume` run with a
  summary request). The hub shows it in an editable box; only what you save is appended to
  `feedback`, as a `chat` entry (#0023):

  ```yaml
  feedback:
    - at: 2026-11-12T09:14:00Z
      type: chat
      note: >-
        Discussed with the card's agent. I now see that B's extra code is one line per call
        with a helper. Asked it to check whether our HTTP client already throws on 404.
  ```

  History labels it "Conversation summary"; it reaches the working agent through
  `president pending` like any note. The working agent didn't hear the conversation, so the
  summary should state what the human concluded and asked for, not just what was discussed.
- Summaries are card file changes, so they travel between machines with Sync (#0001); the hub
  copy, the session ids and Claude Code's logs don't, and no transcript ever goes into git.

### Leaving a conversation without closing it (#0024)

Card: [0024-leaving-an-open-conversation.md](../decisions/0024-leaving-an-open-conversation.md),
option `remind`. For open and deferred cards:

- **Leaving saves nothing and runs nothing.** "Leaving" is moving to another card or the queue,
  reloading, closing the tab, or restarting the hub.
- On leaving within the page, a notice like the one for unsent text: "Your conversation on
  #0042 isn't summarized; it's there when you come back." (the same moment the unsent-text
  reminder uses, in `CardView.tsx`). Closing the tab shows nothing of president's (a browser
  only shows its own `beforeunload` question).
- **Coming back** to the card, also after a reload or a hub restart, the conversation area says
  "Conversation not summarized yet. [Write summary]" above the message box.
- If Claude Code has deleted the conversation meanwhile, the card says "This conversation is no
  longer on this machine" instead of Write summary (see the conflict with #0018 under
  [Cross-card consequences](#cross-card-consequences)).
- The hub keeps the list of cards with an unsummarized conversation on this machine, outside
  the project (`$XDG_STATE_HOME/president/`), or derives it from the conversation's last
  message time against the card's last summary (the card offers both).
- The reminder is per machine; on another machine the card shows nothing, and a summary can only
  be written where you talked. Accepted costs: if you never come back, or after 30 days, what
  you discussed never reaches the agent.
- Not decided: leaving an unsummarized conversation on a **decided** card (#0024 covers open and
  deferred cards; #0020 allows the chat on decided ones). See [Needs a card](#needs-a-card).

### Deciding while a conversation is open (#0019)

Card: [0019-decide-during-conversation.md](../decisions/0019-decide-during-conversation.md),
option `wait`.

- When the card has a conversation without a summary on this machine (still open, or left
  earlier: #0024's context says that if you leave and later decide, "under its `wait`, Decide
  offers it first"), **Decide** first shows "Writing a summary..." for a few seconds, then:

  ```
  ┌ Before deciding: summary of your conversation ─────────────┐
  │ (the agent's summary, editable)                             │
  │ [Save and decide  ⏎]   [Decide without summary]   [Esc]      │
  └──────────────────────────────────────────────────────────────┘
  ```

- **Save and decide** makes **one write** that appends the `chat` entry and records the
  decision (with the "Why?" note, if any). **Decide without summary** is today's Decide. **Esc**
  goes back to the card without deciding.
- The summary is a separate `chat` entry, not text in the decision's "Why?" (the card's variant
  that would prefill "Why?" was not chosen).
- **Undo** (10 seconds, #0006) restores the card from before that one write, which removes both,
  adds the `undo` entry for the decision (#0012), and puts the summary back in the box. This
  holds as long as every decision is journaled as `resolve`: Save and decide must be the
  `resolve` action carrying the summary, or `undoLastAction`'s `ours.action === "resolve"` check
  must include it.
- Accepted costs: deciding a discussed card is no longer one keypress, and writing the summary
  is one more agent run.
- Not decided: whether **Decide this as my answer** in the Neither panel (#0010), which also
  resolves the card, waits for the summary the same way. See [Needs a card](#needs-a-card).

### Talking about a decided card (#0020)

Card: [0020-chat-on-decided-cards.md](../decisions/0020-chat-on-decided-cards.md), option
`chat-saved`.

- The conversation area is the same on a resolved card as on an open one. Closing the
  conversation offers the summary box; saving it appends a `chat` entry to the decided card.
  `resolution` and `applied_at` stay (as for #0011's notes), and `president pending` lists it
  under "New notes from the human" (or with the card under "Resolved, not yet applied" if it
  isn't applied yet: `withNotes` leaves out cards listed there, which show their notes with them).
- The action that saves a summary must be allowed on `resolved` cards in `src/core/actions.ts`
  (`ALLOWED_FROM`), like #0011's note.
- **The Undo window:** the hub must not save anything to a card decided less than 10 seconds
  ago from this page. With #0021 starting a conversation no longer writes the card, so only
  saving is affected.
- Accepted cost: a summary that really changes the decision can slip in as a note; the agent
  must judge whether to redo its work.
- The session can answer "does the README use the new name now?" by reading the files as they
  are now, but not what an agent changed (no git, #0004).

### Neither: new options right away (#0007)

Card: [0007-neither-try-again.md](../decisions/0007-neither-try-again.md), option `spawn`.

- **Ask for new options** in the Neither panel (`Ctrl ⏎`) applies today's `neither` action (the
  note goes to `feedback` as `neither`, `needs_new_options: true`) **and** starts the card's
  session at once, with a prompt built from the card and its unseen feedback, and
  `--json-schema` for the options. The run uses #0004's flags; it can see the card's earlier
  conversation on this machine, if any, and do research.
- While it runs, the card says "Writing new options..." and sits under "Waiting for new
  options".
- When the options come back, the hub writes them with `president update`'s checks (replacing
  `options`, the `## Option` sections and `recommendation`, removing `needs_new_options`), and
  the card is back in the queue with a notice: "New options, written from your note at 21:00".
- The hub does not run `president seen`: the working agent still finds the card in
  `president pending` (the `neither` entry is unread) and reads options it didn't write. That is
  the card's accepted cost, along with one Claude Code run per "neither".
- With #0010 the panel has two buttons: **Ask for new options** and **Decide this as my
  answer**. (A third, "Ask for new options now", belonged to #0007's `per-card`, not chosen.)
- Under #0008, the new `recommendation` stays hidden until you reveal it, like any other.
- Undoing Ask for new options stops the run. The hub writes the run's options only against the
  card as the run read it (`update`'s feedback guard then refuses after an undo).
- Not decided: what the page says and does when the run fails or returns options the checks
  refuse (nothing is written, so the card stays waiting for the working agent, as today);
  whether the run's exchange shows in the card's conversation panel; and whether the run counts
  as a conversation at all (a session-store entry, #0021; the hub's copy, #0018; a "not
  summarized" reminder, #0024). See [Needs a card](#needs-a-card).

### The chat never applies decisions (#0006)

Card: [0006-who-applies-decisions.md](../decisions/0006-who-applies-decisions.md), option
`working`. Today's flow stays exactly as it is: Decide only rewrites the card, the card shows
"Waiting for an agent to apply it to the project.", and the project's working agent applies it
from `president pending` and runs `president applied` (in the main folder, #0022). For PR 2:

- The chat session never records decisions in docs, edits code or runs `president applied`
  (it couldn't anyway: #0004 gives it no write tools and no Bash). Don't send it instructions
  to apply, and don't add a "Decide and apply now" button.
- Deciding keeps today's 10-second Undo window (`src/web/toast.tsx`), and nothing may write
  the card after the decision inside that window: Undo restores the card only if it is still
  the file president wrote for the decision. #0019 (one write) and #0020 (nothing saved in the
  window) keep this.
- The skill's "Applying resolved cards" and the apply flow in docs/card-format.md need no change
  for #0006.

## F. Rename the command (#0016)

Card: [0016-rename-the-cli.md](../decisions/0016-rename-the-cli.md), option `rename`.

- The command becomes a name nobody owns on npm, and **that name is reserved on npm with a
  placeholder package**, so `npx <name>` can only ever find ours or nothing. The product can
  still be called president; only what you type changes.
- **The name is not chosen.** The card's `presctl` is an example ("tell me the name you want in
  the note"), and the decision came without a note. Names the card found free on npm on
  2026-11-11: `presctl`, `prescards`, `pres-cards`, `decicards`, `president-cli`; check again
  before using one. See [Needs a card](#needs-a-card).
- Publishing the placeholder needs the human's npm account: ask the human to do it, or to
  approve it, once the name is chosen.
- The work: about 200 mentions of `president <command>` in `src`, `bin`, `skills`, `docs`,
  `README.md` and `test`; the `bin` entry in `package.json`; the help text (`src/cli/main.ts`);
  the `done:` lines `president pending` prints; error messages; the README's install steps and
  its "Use `president`, not `npx president`" warning (and the skill's); existing installs need
  relinking.
- Not decided: whether `president` stays as an alias for a while. See
  [Needs a card](#needs-a-card).

## Cross-card consequences

- **#0020 `chat-saved` works because #0011 is `allow`.** A summary saved on a decided card is
  #0011's note in all but its type (`chat`, #0023): the decision and `applied_at` stay and the
  agent reads it in `pending`. Had #0011 been `reopen-only`, `chat-saved` wouldn't fit; under
  `amend`, every summary would have sent the card back to be re-applied.
- **#0021 `local` removes #0020's `session_id` question** and the "treat the `session_id` write
  as the hub's own" work the earlier roadmap described: starting or continuing a conversation
  never writes the card.
- **#0019 `wait` + #0012 `hybrid` + the Undo window (#0006).** The summary and the decision are
  one write, so Undo stays a single byte-for-byte restore of the card from before it, plus
  hybrid's `undo` entry for the decision; the summary goes back into the box. Nothing writes the
  card in the 10 seconds after (#0020's rule). `wait` doesn't depend on #0011, but #0011's
  `allow` is what lets #0020 save summaries on decided cards outside that window.
- **#0019 + #0024.** A conversation you left unsummarized (#0024) is still offered when you
  later decide the card (#0019's `wait`), so it can't silently miss the decision.
- **#0018 `hub-copy` + #0024 `remind`: they disagree after Claude Code deletes a conversation.**
  #0018 keeps showing the messages from the hub's copy ("The agent no longer remembers this
  conversation"), while #0024 has the card say "This conversation is no longer on this machine"
  instead of Write summary. Both texts can't be right, and whether a summary can still be
  written from the hub's copy is not decided. See [Needs a card](#needs-a-card).
- **Three per-machine stores, one folder.** Session ids (#0021), the hub's copy (#0018) and the
  "not summarized" list, if it is kept rather than derived (#0024), all live in
  `$XDG_STATE_HOME/president/`, keyed by project name and card id, and none travels with Sync.
- **#0007 `spawn` + #0010 `neither-plus`**: the Neither panel has two buttons, Ask for new
  options (now runs the session) and Decide this as my answer. #0007 works under #0004 as
  written: the session reads and researches, and the hub writes.
- **#0008 `hidden` + the chat (#0005, #0007).** *Teach me* asks you to predict before
  explaining, which fits forming your own view first. But the session reads the whole card
  file, `recommendation` included, and nothing stops it naming the agent's pick before you press
  `r`. Not decided; see [Needs a card](#needs-a-card).
- **#0009 `sink` + #0015 `priority-oldest` + #0017 `snooze`.** One order everywhere: ready cards
  first, then dependent ones, each by priority and age; snoozed cards whose date has passed sort
  among them like open ones. A dependency that is deferred (snoozed) still counts as undecided,
  so its dependents stay sunk until it is decided.
- **#0013 `dated` + #0021 `local`.** Dated ids make the renumbering that #0021's store can't
  follow rare for new cards; old numbered cards can still collide and be renumbered.
- **#0022 `sync-only` and this repo.** Until B ships, every decided card stays uncommitted in the
  main folder until someone commits `decisions/` on main by hand; pull requests that apply
  decisions (this one included) carry no card files, and their links to `../decisions/<card>`
  show the card as decided once the answers reach main.
- **#0016 `rename` touches everything.** Every printed command and doc line in A to E changes
  name. If F comes later, those PRs write `president`; F renames them with the rest.

### Existing docs that now contradict a decision

Not edited here (another pull request, #7, is editing `SKILL.md` and `card-format.md`); the
build PR named in brackets fixes each.

- `docs/card-format.md` and the skill, picking an id ("add one to the highest number"):
  replaced by #0013's dated ids [D].
- `docs/card-format.md`, `session_id` "Reserved for the per-card chat": unused under #0021 [E].
- `docs/card-format.md`, feedback types (`neither | note | defer | reopen | undo`): gains `chat`
  (#0023) [D]; fields: gains `withdrawn` (#0014) [D] and `defer_until` (#0017) [C or D].
- `docs/card-format.md` Lifecycle, notes only on open and deferred cards: #0011 allows them on
  resolved cards [C].
- README `d` row and the card-format Lifecycle: a deferred card returns only by reopen; under
  #0017 it also returns when `defer_until` passes [C].
- README, the `n` row ("an agent writes new ones"): under #0007 the hub starts the card's
  session at once [E].
- README and the skill, "Use `president`, not `npx president`": #0016 renames the command [F].
- The skill has no rule about committing card files: #0022 adds one [A].
- The skill, "Run every `president` command from the project root, the folder that contains
  `decisions/`": under #0022 that is the main folder, not a worktree [A].

## Needs a card

Questions the decided cards leave open. Each is the human's to answer: write a card before
building the part it blocks. Grouped by the build PR that needs the answer.

**A (agent rules)**

1. **Card changes outside an apply, and pull requests.** #0022 weighed only the human's answers
   and `applied_at` in apply pull requests, but its skill line, "Never commit card files in your
   pull request; Sync carries them", read literally covers every card change an agent makes
   outside an apply: new cards (as PR #6 did) and `president update` rewrites (new options after
   "neither" when the hub's run fails, adding or removing `withdrawn`). Do agents still put those
   in a reviewed pull request (where CI validates them), or write them straight into the main
   folder for Sync to commit (Sync's step 4 expects such untracked new cards)? Until this is
   answered, A ships the line as written plus the main-folder rule.

**C (queue and card UX)**

2. **Deferred cards without `defer_until`** (#0017): cards deferred before snooze ships, or by
   hand. Do they stay deferred until Back to queue, or get the default week?
3. **Withdrawn cards elsewhere** (#0014): what `president pending` and `president validate` say
   about a withdrawn card; whether it still sinks the cards that depend on it (#0009); and, with
   #0017, whether a withdrawn deferred card is listed under Deferred or Withdrawn, and whether it
   comes back to the queue when its `defer_until` passes.
4. **How long a revealed recommendation stays revealed** (#0008): this visit, this browser, or
   recorded.

**E (PR 2)**

5. **The chat and the hidden recommendation** (#0008 with #0005 and #0007): may the session
   (Teach me, More info, answers) name or argue for the agent's pick before you reveal it?
6. **The side panel on A/B cards** (#0002): three columns, or the panel overlays the card.
7. **The hub's copy of conversations** (#0018): how long it keeps them, and what happens to them
   when a project is unregistered or a card is removed or renumbered.
8. **A conversation Claude Code has deleted** (#0018 against #0024): the page still shows it
   from the hub's copy, but #0024 says "no longer on this machine". Can "Write summary" still
   work (a fresh session given the hub's copy), or is the conversation gone for summaries?
9. **Leaving a conversation on a decided card** (#0024 covers open and deferred cards only):
   remind as on open cards, or something else?
10. **Deciding from the Neither panel with a conversation open** (#0019 with #0010): does
    "Decide this as my answer" also wait for the summary, as Decide does?
11. **The new-options run** (#0007): when it fails, what the page says and whether it retries;
    whether the run's exchange appears in the card's conversation; and whether the run counts as
    a conversation at all: a session-store entry (#0021), the hub's copy (#0018), and a "not
    summarized" reminder (#0024).
12. **Teach me on `open` cards with no options** (#0005): `worked` asks you to predict "which
    option handles it better" and walks each option through the scenario, but
    `docs/card-format.md` lets an `open` card leave `options` out, so there is nothing to
    compare. What does Teach me give there?

**F (rename)**

13. **The new command name** (#0016), and whether `president` stays as an alias for a release.
    Then the human publishes (or approves publishing) the npm placeholder.
