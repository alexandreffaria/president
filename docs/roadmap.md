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

Status on 2026-11-11: none of this is built. Cards #0001 to #0024 are all decided.

Update on 2026-11-12, which replaces the status line above: A (PR #10) and B (Sync, PR #12)
are built; the rest isn't. PR #12 (branch `feat/sync` until it merges) also carries both Sync
follow-ups: 2026111209dq needed nothing, and 20261112xp4s is commit `b672fe1`. Cards #0001 to
#0024, the 13 cards of batch 3 (PR #11), which answered every question of the earlier
[Needs a card](#needs-a-card) list, and the two Sync follow-ups from PR #12's review (PR #13)
are all decided, each with its recommended option and no note. The new questions they leave
are in [Needs a card](#needs-a-card).

Later on 2026-11-12: the three cards of batch 4 (20261112l9vh, 2026111272fu, 20261112160s),
which answered the three questions [Needs a card](#needs-a-card) then held, are decided too,
each with its recommended option and no note. l9vh is new work for B, in a follow-up pull
request (row B2); 72fu and 160s are part of E. 160s left one new question, about a second
tab; card 20261112dfik answered it (`refuse-undo`, its recommended option, no note), also part
of E. [Needs a card](#needs-a-card) is empty for now.

Later still: A2 (the skill's rule for delivering new cards and rewrites, 20261111st0c) is
built in PR #17. B2 (20261112l9vh) is built in PR #18 (branch `feat/sync-followups`), with
three follow-ups from PR #12's review: S7-4, S4-6 and S8-1.

## Build plan

Each row is one pull request (PR 2 may be split, see its section). The order is a suggestion;
"Depends on" is what must be merged first.

| # | Work | Decided by | Depends on | Suggested order |
|---|---|---|---|---|
| A | [Agent rules: the skill line for #0022](#a-agent-rules-the-skill-line-for-0022) | #0022 | PR #7 (it edits `SKILL.md`) | **Built** in PR #10 |
| A2 | [Agent rules: how agents deliver new cards and rewrites](#a2-agent-rules-how-agents-deliver-new-cards-and-rewrites-20261111st0c) (agent-facing: the skill) | 20261111st0c | A (built) | **Built** in PR #17 |
| B | [Sync](#b-sync-0001) | #0001, #0022, 2026111209dq, 20261112xp4s | nothing | **Built** in PR #12, together with [the two follow-up decisions](#decided-while-pr-12-was-open-2026111209dq-20261112xp4s): 09dq is what it already did, and xp4s is commit `b672fe1` |
| B2 | [Sync: count a skipped project's answers apart](#b2-sync-count-a-skipped-projects-answers-apart-20261112l9vh) | 20261112l9vh | B (PR #12) merged | **Built** in the follow-up pull request (PR #18, branch `feat/sync-followups`) |
| C | [Queue and card UX](#c-queue-and-card-ux) | #0008, #0009, #0010, #0011, #0012, #0014 (hub part), #0015, #0017, 20261111nsaj, 202611112hzh, 202611116ff6 (hub part) | D's `withdrawn` definition, for the Withdrawn section only | Alongside B; before PR 2, which builds on #0010's Neither panel and #0011's notes on decided cards |
| D | [Card format and CLI](#d-card-format-and-cli) | #0013, #0014 (format part), #0023 (format part), 202611116ff6 (`pending` and `validate`) | PR #7 (it edits `card-format.md` and `SKILL.md`) | Before or with C and PR 2; `chat` must exist before PR 2 writes it |
| E | [PR 2: the per-card chat](#e-pr-2-the-per-card-chat) | #0002, #0003, #0004, #0005, #0006, #0007, #0018, #0019, #0020, #0021, #0023, #0024, 20261111mby8, 20261111sblu, 202611114wet, 20261111paot, 202611111ky9, 20261111is21, 202611111gpm, 20261111fauj, 2026111272fu, 20261112160s, 20261112dfik | C (#0010's panel, #0011's notes on decided cards), D (`chat` type) | After C and D |
| F | [Rename the command to `preside`](#f-rename-the-command-to-preside-0016-20261111dmvt) (agent-facing: the CLI, the skill and every printed command) | #0016, 20261111dmvt | A2 (both edit `SKILL.md`). The npm placeholder is published by the human (an agent prepares it). No card orders it against F; suggested: publish it before F merges (after repeating the name check), so the name F writes everywhere can't be taken meanwhile | At a moment with no other pull request open, since it touches about 200 lines everywhere; ideally before E, which adds new printed commands |
| F2 | [Remove the `president` alias](#the-president-alias-and-when-it-ends) | 20261111dmvt | F | One month after F ships, or once every registered project's own docs and agent instructions use `preside`, whichever is later |

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
path they are given). From a worktree, "in the main folder" means passing the main folder's
absolute path to each command, not `cd`-ing there: agent harnesses keep agents in their
worktree, and a `cd` would also send the agent's own git commands to the main checkout.

A shipped (PR #10) with the card's line as written plus the main-folder rule, and with an
interim reading for card changes outside an apply: write new cards and `update` drafts in the
main folder's `decisions/` by absolute path and leave them uncommitted. That question is now
decided by [20261111st0c](../decisions/20261111st0c-agent-card-changes.md), and A2 below changes
the skill to match.

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

## A2. Agent rules: how agents deliver new cards and rewrites (20261111st0c)

Card: [20261111st0c-agent-card-changes.md](../decisions/20261111st0c-agent-card-changes.md),
option `reviewed-main`: "New cards are reviewed by a fresh session and validated in the agent's
worktree, then written into the main folder; rewrites go straight to the main folder with
president update." An agent-facing pull request: it changes `skills/decision-cards/SKILL.md`
(`docs/card-format.md` doesn't say where an agent writes a card). Two things about step 2 for
the skill to say (or for a small code change to fix, the implementer's call): `president
validate` on a worktree's card prints "is not registered with the hub ... Register it: president
add <worktree>", which the agent must ignore (never register a worktree); and it checks
`depends_on` and duplicate ids against the worktree's `decisions/`, which lacks the main
folder's uncommitted cards (every card delivered this way since the last Sync). So its warning
there that a `depends_on` "is not a card in this project", for a card that exists in
`<main>/decisions/`, is not a real problem, and only step 4's validate in the main folder is
authoritative for ids and dependencies.

- **#0022's line reads literally.** "Never commit card files in your pull request; Sync carries
  them" covers new cards and rewrites too, not only answers and `applied`. No pull request
  carries a file under `decisions/`, card-writing batches included (this repo's batches 1 to 3
  came as pull requests #3, #6 and #11; the next one doesn't).
- **A new card**, as the card's technical detail gives the steps for "Writing a card":
  1. write the card in the worktree's `decisions/`, without committing it;
  2. run `president validate <file>` on it there;
  3. have a fresh session review it (as the reviews of PR #3 and PR #6 did), fix what it finds
     and have it reviewed again, until nothing should-fix is left;
  4. copy it into the main folder's `decisions/`, run `president validate` on it there, and
     delete the worktree copy, so the feature branch never commits it.

  It reaches the human's queue at step 4, as soon as its review is done, with no merge or
  pull to wait for; Sync (or a hand commit, where there is no Sync) puts it in git.
- **Rewrites** (`president update`: new options after "neither" when the hub's own run fails,
  #0007; adding or removing `withdrawn`, #0014) go straight to the main folder, unreviewed, as
  the skill already says (the `.new` file next to the main folder's card, by absolute path).
  `update`'s guard then compares the agent's version with the card the human has, notes
  included.
- **Replace the skill's "Not decided yet" paragraph** under *The main folder, and card files in
  git* (and its interim "write new cards ... only in `<main>/decisions/`") with the rule above,
  and *Writing a card*, step 1 (which today says to write the file in `<main>/decisions/`
  directly, and whose duplicate-id sentence points at step 5's validate, now the copy's), step
  5, and *Changing a card*'s last paragraph ("A new card has no human edits to lose: write its
  file directly (`<main>/decisions/<id>-<slug>.md`)"), with the four steps. The id is still
  picked from the main folder's list until D's dated ids (#0013) ship; with dated ids it
  doesn't depend on any folder.
- Cards the hub's own run rewrites (#0007) are written by the hub in the main folder; this card
  is only about cards agents write.
- The card describes an agent in a worktree. For an agent working in the main folder itself,
  the same rule (the card reaches the human once it passes review) means the draft must sit
  where the hub doesn't read it until then: outside `decisions/` (for example in a scratch
  folder), where `president validate <file>` checks it on its own. Not under a `.` or `_` name
  inside `decisions/`: the hub ignores those, but `validate` refuses them ("is not a card
  file"). Where exactly is the implementer's call (say it in the pull request).
- Not adopted: the card's optional bookkeeping field (for example `reviewed: 2 rounds`), which
  "would show that a review ran, but nothing checks it". Adding one is the human's call.
- Known costs the human accepted: the writing agent runs the review and decides when it is
  done, and nothing shows whether it ran; two rules (new cards reviewed then copied, rewrites
  straight in) and more steps per new card; CI checks the cards only after they reach main;
  rewrites reach the human unreviewed.

**Built** in PR #17, in the skill only (no code change): *The main folder, and card files in
git* states the rule, *Writing a card* has the four steps (as steps 1 and 5 to 7), *Changing
a card* says rewrites go straight in and new cards don't, and *Until Sync exists* became
*Projects Sync skips*. Step 2's two messages (the "not registered" note and a `depends_on`
warning in a worktree) are handled by the skill telling the agent to ignore them, not by a
code change. An agent working in the main folder itself drafts in a scratch folder outside
the project (for example one made with `mktemp -d`), so the draft is neither read by the hub
nor left as an untracked file in the checkout. `foundations.md`'s *Engineering process* says
cards are reviewed in the agent's folder and never carried by a pull request.

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
- Check 3 is exactly the card's: tracked files with uncommitted edits. Sync makes no guess of
  its own about **untracked or ignored files** in the pull's way (three review rounds of
  such guesses each regressed; the human cut it back in round 4). git refuses to overwrite
  an untracked file, so the pull fails, is undone, and Sync says a file git doesn't track
  is in the way (git's error names it) and to move or commit it; nothing is lost and the
  answers stay in a local commit.
  **Ignored files are expendable**, git's own rule: if the online copy adds a tracked file
  at the exact path of a file ignored here, git replaces it (and it removes ignored files in
  a folder the online copy turns into a file).
- A project with **git submodules** (a `.gitmodules` file, or a gitlink in the index) is
  skipped like one that isn't a repository's top folder, and its answers are counted only on
  a line of their own ([B2](#b2-sync-count-a-skipped-projects-answers-apart-20261112l9vh)): a
  pull can delete an agent's untracked files inside a submodule without a word. The check
  reads `git ls-files --format=%(objectmode)` (`--stage` on a git older than 2.38), and a
  list cut at Sync's output limit skips the project too, so a gitlink is never missed.
  Anywhere else, output cut at that limit stops Sync ("git output too large"). For every list
  Sync reads before its first change (the `git add` of the cards), it refuses before changing
  anything; the lists it reads after that are bounded by lists already read whole, so they
  can't realistically be cut. Check 3 reads `git diff --name-only HEAD` first and, only when
  that lists files outside `decisions/`, the whole `git diff --name-only HEAD...@{u}`. So a
  very large change list on the remote matters only when an agent has uncommitted edits here.
  If the remote's list is cut, the action says to press Sync again once those edits are
  committed and pushed, or put away; if check 2's log or the list of files edited here is cut,
  it says to commit and push that work by hand, or put it away. The pull runs with
  `LANGUAGE=en`, so git's untracked-file wording is matched in English under a localized git
  too.
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
- The notice an open card shows after this hub's Sync brought in a change reads "Sync just
  brought in a newer version of this card from the online copy." (decided in card
  `20261112xp4s`, option from-sync). Sync reads the revisions of the cards each pull changed
  right after the pull (an agent's later edit is the agent's), and `SyncService` records
  them before it sends its `cards` event; the card endpoint reports
  `changedBySync`, and a view that reloaded mid-pull (and took the change for an agent's)
  picks the sentence again on that event. Other changes keep their notices.
- Only a project at the top folder of its repository gets Sync (card `2026111209dq`, decided
  top-only).

From review round 1 of the PR (each with a test in `test/sync.test.ts` that fails without it):

- The push is `git push <remote> <commit>:refs/heads/<main>` (no tags, no submodules), with
  the remote `main` tracks, never a bare `git push`: that follows `push.default` (`matching`
  pushes every local branch with a namesake on the remote, an agent's included),
  `remote.pushDefault` and `branch.main.pushRemote`. After the push, `<remote>/<main>` must be
  that commit.
- After the pull, Sync reads `HEAD` once and checks again: still `main`, still tracking the
  same upstream, nothing in progress, and check 2 on `@{u}..<that commit>`. An agent may have
  committed or switched branches while the commit's hooks and the pull ran; then nothing is
  pushed and the answers stay in the local commit.
- "In progress" in check 1 also covers a cherry-pick, a revert, a sequence of those
  (`sequencer/`), a bisect, and unmerged files (`git ls-files --unmerged`), and it runs again
  right before `git add`.
- Check 2 also refuses an unpushed commit that changes no file (an agent's empty commit).
- Sync pushes nothing when the remote already has `HEAD` (`merge-base --is-ancestor`), as
  when a fetch moved `<remote>/<main>` past it after the pull (round 2).
- The look before pushing calls only a new stash entry with the subject `autostash` git's,
  names it (its `stash@{n}` and commit), and never suggests a bare `git stash drop`: the
  stash is shared with agents. Any other new entry also stops the push, with no drop advice.
- A rebase in progress (one a Sync cut short by the hub stopping leaves behind) is shown in
  the top bar's report, and Sync's "Not now", with the files its autostash set aside and
  `git rebase --abort` to get them back.
- An Undo refused because a Sync is running stays on offer in its toast, to try again.
- git runs without the variables `git rev-parse --local-env-vars` lists (plus
  `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, `GIT_EXEC_PATH` and, from round 4, the four
  `GIT_*_PATHSPECS`, which change what `-- decisions/` matches), not without every `GIT_*`
  one: the user's `GIT_SSH_COMMAND`, `GIT_CONFIG_GLOBAL` and the like are kept.

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
- After a pull brings in a change to an open card, the card says "Sync just brought in a newer
  version of this card from the online copy." (`src/web/views/CardView.tsx`; decided in card
  `20261112xp4s`), not "An agent changed this card while you had it open".
- Sync carries everything under `decisions/`: answers, notes, `applied_at` from agents
  (#0022), conversation summaries (#0003, #0023), `defer_until` (#0017) and `withdrawn` (#0014).
  Session ids, the hub's copy of conversations and the "not summarized" list never travel
  (#0018, #0021, #0024): they live outside the project.
- The README documents Sync (PR #12). `SKILL.md`'s *Until Sync exists* note, which PR #12
  didn't touch and which said Sync is "not built yet", is narrowed to the projects Sync skips
  (2026111209dq, below) as *Projects Sync skips* (A2, PR #17): their card changes reach git
  only by a hand commit in the main folder, done when the human asks, never in a pull request.

### Decided while PR 12 was open (2026111209dq, 20261112xp4s)

Both came from PR #12's review and belong to PR #12 (`feat/sync`).

**Which projects Sync works for.** Card
[2026111209dq-sync-inside-bigger-repo.md](../decisions/2026111209dq-sync-inside-bigger-repo.md),
option `top-only`: "As built in pull request 12; a project inside a bigger repository is
skipped, and pressing Sync says why, so its answers move only when someone commits them by
hand." Nothing more to build: Sync runs only when the project folder is the top folder of its
repository (or worktree); otherwise pressing Sync shows, greyed out, "Not synced: web is skipped
because it isn't the top folder of a git repository" (the same sentence for a folder that isn't
in git at all). Sync never pulls, sets aside or pushes a repository that holds more than the
project. Accepted cost: a project in a monorepo or a home folder kept in git never gets Sync.
Whether the top bar counts a skipped project's unsynced answers was decided afterwards, by
20261112l9vh: yes, on a line of its own. PR #12 left them out; the count is built in the
follow-up pull request, see [B2](#b2-sync-count-a-skipped-projects-answers-apart-20261112l9vh).

**The notice when Sync changes the card you have open.** Card
[20261112xp4s-notice-after-sync.md](../decisions/20261112xp4s-notice-after-sync.md), option
`from-sync`. When the change arrived with this hub's Sync, the open card's notice says:

```
Sync just brought in a newer version of this card from the online copy.
Read what changed before you act on it.
  • It is now resolved (was open).
  • It was decided: "Lead with the next action".
                                                        [I've read it]
```

Other changes keep today's wording: an agent on this machine, "An agent changed this card while
you had it open."; another president tab, "You changed this card in another president tab."
The pause stays as today: until "I've read it", the hub refuses a decision or note on the old
text, and a picked option is cleared.

- From the card's technical detail: `SyncService` keeps, per project, the card revisions its
  last pull brought in (it already reports the `received` cards); the card endpoint adds
  `changedBySync` to `CardDetailDto` next to `writtenByPresident`, and `CardView` picks the
  sentence from it (on `feat/sync` since `b672fe1`: `setChangedBy(card.writtenByPresident ?
  "other-tab" : card.changedBySync ? "sync" : "agent")`). The watcher can reload the card mid-pull, before the Sync knows what it brought
  in, so record the revisions before emitting the `cards` event and pick the sentence again on
  that reload.
- Accepted costs: the notice doesn't say whether it was you on the other machine, an agent or
  a merged pull request (the list of changes is the only clue); a change brought in some other
  way (`git pull` in a terminal) still says "An agent changed this card".
- Built in PR #12 (commit `b672fe1`), and its roadmap B describes it. Item 10 of PR #12's
  description ("Not built: ... The notice still says 'An agent changed this card'") was written
  before that commit.

## B2. Sync: count a skipped project's answers apart (20261112l9vh)

Card: [20261112l9vh-unsynced-count-skipped-projects.md](../decisions/20261112l9vh-unsynced-count-skipped-projects.md),
option `count-apart`: "The top bar adds, per skipped project, a line such as "web: 2 answers not
synced (Sync skips it)"; the number on the Sync button still counts only what Sync can move."

**Built** in the pull request "Sync follow-ups: count skipped projects apart (B2), S7-4, S4-6,
S8-1" (PR #18, branch `feat/sync-followups`), as written below: `Repo.skippedCardChanges` and
`repoStatus` in `src/server/sync.ts`, `skippedUnsynced` in `ProjectSyncStatus`
(`src/core/api.ts`), and `SyncSkipped` in `src/web/components/Sync.tsx`, a list under the top
bar's first line (`.sync-skipped`). The count runs for every skipped project:
`git rev-parse --show-toplevel` first (one git process for a folder outside git, which keeps
0), then `localCardChanges` against the checked-out branch's upstream, if any. A project git
can't read also keeps 0. `skippedUnsynced` is set for every skipped project (0 included) and
left out for the others. Tests: `test/sync.test.ts` ("a skipped project's answers, counted
apart", and the submodule tests), `test/sync-api.test.ts`, `test/web/sync.test.tsx`.

The same pull request carries three follow-ups from PR #12's review:

- **S7-4.** `splitZ` (`src/server/git.ts`) dropped any path made only of whitespace (a file
  named " "), so check 3 never saw it; it now drops only empty entries.
- **S4-6.** The summary next to the Sync button is no longer hidden below a fixed 66rem: the
  top bar measures whether, with it shown, the end group still fits on the nav's line, and
  if not hides it and puts the count on the button (`data-squeezed`, re-measured when the bar
  or the end group changes size and when the text changes). "1 answer not synced" now shows
  from 480 px up.
- **S8-1.** The README and B above said Sync refuses before changing anything for every list
  it reads "before committing"; it is "before its first change (the `git add` of the cards)",
  since the staged list is read after that `git add`.

**Where it goes.** A small pull request of its own, started from main once PR #12 (`feat/sync`)
has merged. Not inside PR #12: it is in a late review round and its `sync.ts` is still
changing, and the card itself says it "doesn't hold up pull request 12, which leaves them out
today".

**What the human sees.** With answers on the laptop in a skipped `web` and a note in
`president`:

```
Top bar:      1 answer not synced                [Sync 1  s]
              web: 2 answers not synced (Sync skips it)
After Sync:   president  Synced: sent 0031.
              web        Not synced: web is skipped because it isn't the top folder of a git repository.
Top bar now:  web: 2 answers not synced (Sync skips it)
```

- One line per skipped project with at least one unsynced card change. The Sync button's
  number and "N answers not synced" don't include it: they keep meaning "what pressing Sync
  will send or bring in", so the button goes from 1 to 0 above while the `web` line stays.
- The line stays until someone commits that project's `decisions/` and pushes it (you, or an
  agent you ask). Pressing Sync never clears it.
- A folder that isn't in git at all is skipped too, but shows no count: git keeps no record of
  what has been sent anywhere.
- Sync still does nothing in a skipped project; only what you are told changes. Pressing Sync
  shows the same skipped sentence as today.
- Accepted costs (the card): a line pressing Sync never clears; a little more to build; if you
  keep a skipped project on one machine only, the line is always there.

**What to build** (the card's technical detail, against `feat/sync` at `b672fe1`; check the
merged code, since PR #12 changed after that):

- `Repo.unavailable()` reports "it isn't the top folder of a git repository" as soon as the
  project folder has no `.git` entry, without running git, so a project inside a bigger
  repository and a folder outside git look the same. When `.git` is missing, run
  `git rev-parse --show-toplevel` in the project folder. If it succeeds, the project is inside
  that repository (as in the `realTop !== realDir` case): run `localCardChanges` anyway. Its
  pathspec `decisions/` is relative to the project folder, so it counts only this project's
  cards. The `@{u}...HEAD` part needs the bigger repository's upstream; without one, only
  uncommitted changes count. If `rev-parse` fails, the folder is outside git: keep 0. This adds
  one git process per status refresh for such a folder, which today costs none (see the
  comment at `unavailable()`).
- `repoStatus` returns that count in a separate field (for example `skippedUnsynced`), never in
  `unsynced`, so it isn't added to the button's number or to "N answers not synced".
- `SyncControl` (`src/web/components/Sync.tsx`) shows one line per project with
  `skippedUnsynced > 0`.

**Merging with PR #12.** PR #12 leaves a skipped project's answers out of every count; B2
adds them on a line of their own.

**Projects with submodules.** PR #12's round 4 (`0b126cc`) also skips a project whose
repository has git submodules (a `.gitmodules` file, or a gitlink in the index), in
`Repo.unavailable()` ("it has git submodules, which Sync doesn't handle"), so like every other
skipped project its answers are left out of `unsynced`. Such a project is a project Sync skips,
which is what this card's question and `count-apart` are about ("per skipped project"), so B2
covers it too: its count goes on its own line, never in the button's number. B2 counts it with
`localCardChanges` and the project's own upstream, since the project is its own repository.
The line's wording comes from the card's example; "(Sync skips it)" fits every reason.

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
- **"Stays shown" lasts until you leave the card**
  ([20261111nsaj-revealed-pick-duration.md](../decisions/20261111nsaj-revealed-pick-duration.md),
  option `visit`): "The pick shows until you move to another card or the queue; coming back, it
  is hidden again." That includes going back with `k` right after `j`, a reload and the next
  day. From the card's technical detail: the state lives in the card view and is reset when the
  card changes; nothing is stored (not in the browser, not in the card). A new recommendation
  (#0007's new options) is hidden like any other (E). Accepted costs: going back to a card you
  just looked at means pressing `r` again; nothing shows whether you already looked at the pick
  there; on a card you discussed after revealing, the conversation panel still shows what the
  chat said about it.
- What the chat may say before you reveal the pick is decided by 20261111mby8 (`neutral`), in E.
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
    drop the field and leave the card deferred for good. The field lists in `SKILL.md`
    ("Keep `status`, `resolution`, …" in *Changing a card*, and "Keep `feedback`, `id`,
    `created` and `status`" in *Cards that need new options*, since the human can defer a card
    after "neither"; a test in `test/card-file.test.ts` quotes the second) and
    `docs/card-format.md` ("…are still the same in both") gain it too. Not added before the
    field exists: an agent would be told to keep a field no card has.
- `defer_until` goes in `docs/card-format.md` (D can document it, or this PR).
- **A deferred card without `defer_until`** (deferred before snooze ships, or set to
  `status: deferred` by hand) comes back to the queue once
  ([202611112hzh-deferred-without-date.md](../decisions/202611112hzh-deferred-without-date.md),
  option `back-now`): "No date counts as a date already passed; the card appears in the queue
  marked 'back from deferral', and d snoozes it again for a week." The queue treats a missing
  `defer_until` as already passed; this never writes the card. `d` on it sets a real
  `defer_until` (the `ALLOWED_FROM.defer` change above). Accepted costs: on the day snooze
  ships, every old deferral lands in the queue at once, and a card deferred by hand comes
  straight back. The demo project's `0003-first-run-copy.md` is such a card, so after this
  ships `president demo` shows it in the queue, not under Deferred.
- Accepted cost: cards come back whether or not anything changed.

### Withdrawn cards in the hub (#0014)

Card: [0014-withdrawn-status.md](../decisions/0014-withdrawn-status.md), option `field`. The
format part is in D.

- The queue leaves out open cards that have a `withdrawn` field and lists them in a collapsed
  **Withdrawn by agents (n)** section. A withdrawn **deferred** card is listed under
  Withdrawn, and the queue ignores its `defer_until` while it is withdrawn ("the agent's later
  word wins"); Back to queue removes the withdrawal and the date applies again
  ([202611116ff6-withdrawn-cards-elsewhere.md](../decisions/202611116ff6-withdrawn-cards-elsewhere.md),
  the same under every option and not changed by a note). It follows that a withdrawn deferred
  card with no `defer_until` also stays under Withdrawn, rather than coming back by
  202611112hzh's rule: the date, missing or not, is what is ignored.
- The card page shows "Withdrawn by the agent: <reason>" above the options, which still work:
  you can decide, note, or reject a withdrawn card as usual.
- A **Back to queue** button removes the field **and** appends a note to `feedback` (the card's
  example: "Back in the queue"). The note is required: `president update` doesn't compare
  `withdrawn`, so without it an agent's update made from an earlier read would withdraw the card
  again.
- **A withdrawn card still sinks the cards that depend on it** (202611116ff6, option
  `labelled`): `openDependencies` (`src/core/queue.ts`) is unchanged, so its dependents stay at
  the bottom (#0009) until you decide the withdrawn card (your own answer, such as "Dropped
  with the map screen", is enough) or decide them where they are. Only the dependency mark
  changes: in the queue and in the card page's notice it says the dependency was withdrawn, for
  example "depends on #0042, withdrawn". There is no button to accept a withdrawal (the
  option's stated cost). What `president pending` and `validate` say is in D.

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
- Document the field in `docs/card-format.md` and the skill (when and how to withdraw).
- **`president pending` and `validate` label a withdrawn card**
  ([202611116ff6-withdrawn-cards-elsewhere.md](../decisions/202611116ff6-withdrawn-cards-elsewhere.md),
  option `labelled`: "president pending and validate say a card is withdrawn and why"):
  - `validate` adds the reason to the `ok` line:

    ```
    $ president validate
    ok      0042-map-tiles.md (withdrawn: We dropped the map screen.)
    ok      0047-map-pins.md
    ```

  - `pending` lists a withdrawn card only when it would anyway (you added a note, decided it),
    with "(withdrawn)" after its title; its `--json` output gains a `withdrawn` mark.
  - Nothing else changes for dependents: they stay sunk (C).

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
- **A/B cards get three columns**
  ([20261111sblu-side-panel-on-ab-cards.md](../decisions/20261111sblu-side-panel-on-ab-cards.md),
  option `three`): option A, option B and the conversation side by side; each option column gets
  narrower while the panel is open. From the card's technical detail: the page's max width
  (72rem, `.card-page-wide`) grows by the panel's width while it is open, and `.options-ab`
  keeps two columns inside the card column. The 1100-pixel fallback from #0002 still applies.
  The panel's width isn't fixed by any card (the card's numbers assume 24rem); it is the
  implementer's call. Accepted costs: each option is about 13% narrower on a 1440-pixel window
  and about 27% on a 1280-pixel one, so long code lines scroll sideways more often, and three
  columns of text is a busy screen on a laptop.

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

**On an `open` card with no options**
([20261111fauj-teach-me-without-options.md](../decisions/20261111fauj-teach-me-without-options.md),
option `scenario`), Teach me keeps that shape minus the comparison: "The agent picks one
realistic scenario, asks what you'd want to happen in it, then walks through what an answer has
to cope with there, and says what the scenario leaves out." It doesn't draft candidate answers
of its own. The hub picks the prompt by whether the card has options
(`fm.options.length === 0`), as the Neither button already does (`src/web/views/CardView.tsx`).
An `open` card that does list suggestions gets #0005's format on them as is. Accepted costs:
with nothing to contrast you learn less about the differences that matter, and one scenario can
mislead if it isn't typical.

### The chat stays neutral until you reveal the pick (20261111mby8)

Card: [20261111mby8-chat-and-hidden-pick.md](../decisions/20261111mby8-chat-and-hidden-pick.md),
option `neutral`: "Until you press r, the chat explains and compares the options without naming
the card's pick or recommending one of its own; asked directly, it says the pick is behind r.
After you reveal it, the chat is free." This covers the session's answers in the conversation:
Teach me, More info and your questions.

- The card's example, asked "Which one would you go with?" before `r`: "The card's pick is
  behind **r**; I'll keep my view out of it until you've formed yours. What decides it is ..."
- **Where the instruction goes** (the card's technical detail): not only in the system prompt,
  which Claude Code records once per conversation and reuses on every resume
  (`--system-prompt-snapshot`). The hub adds a line such as "The human has not revealed the
  card's pick" to every message until `r`, then "has revealed it" (or, with
  `--system-prompt-snapshot off`, puts it in a per-run `--append-system-prompt`).
- "Revealed" means revealed on that card as 20261111nsaj defines it (until you leave the card).
  Once the chat has named the pick, the conversation's history keeps it, so the line sent stays
  "revealed" for that conversation, even when the page hides the pick again on your next visit,
  until new options replace that pick (2026111272fu, below).
- The session still reads the card file, `recommendation` included (`withheld`, which blocked
  that, was not chosen). Accepted costs: it rests on the session following an instruction and
  can slip, with no check; neutral facts can still point at one option; "which is safer?" gets a
  comparison, not an answer, until `r`.
- The new-options run (#0007) still writes a `recommendation`, hidden on the page like any
  other; the card says it "doesn't change that run".
- **The new pick after "neither"** ([2026111272fu-new-pick-and-neutral-chat.md](../decisions/2026111272fu-new-pick-and-neutral-chat.md),
  option `reset`): "The run's message explains how the new options answer your note without
  naming its pick, and every conversation on the card is neutral about the new pick until you
  press r, even one where you had revealed the old pick."
  - The run's message (a turn in the conversation, 202611111gpm) never names or argues for the
    new pick. Its prompt says: "Explain how the new options answer the note; don't say which you
    recommend. Your pick goes only in `recommendation`." The run's argument for the pick goes in
    the new `recommendation`'s reasoning, shown when you press `r`.
  - After the hub writes new options, every conversation on the card is neutral about the new
    pick until you press `r` on the new options, even one in which you had revealed the old
    pick and the chat had been free. One rule for every pick a card ever has. The page treats
    it the same way (the card's reasoning: "hidden on the page and in the chat until you press
    r, wherever you had got to with the old one"; 20261111nsaj's `visit` already keeps the
    reveal as "state in the card view, reset when the card changes"), so a pick you revealed
    during this visit doesn't make the new one show.
  - **How** (the card's technical detail): the per-conversation "revealed" flag, kept per
    machine (for example next to the session id of #0021), records which recommendation was
    revealed, for example a hash of `recommendation`. When the hub writes new options, the flag
    no longer matches, and the line sent with each message becomes "The human revealed an
    earlier pick on this card, which the new options replaced; they have not revealed the new
    one." Pressing `r` on the new options sets the flag again. The run itself gets the line too.
  - The card's example, in a conversation where you had pressed `r` on Monday:

    ```
      you, Tue       Neither: Both assume a server. Compare on-device storage only.
      agent, Tue     Here are three on-device options. Browser storage needs no setup but the
                     browser can clear it; a small database file survives and can be searched,
                     at the cost of a library; plain files are the simplest to back up. My pick
                     among them is behind r.
      you, Tue       Which one would you go with now?
      agent, Tue     The new pick is behind r; I'll keep my view out of it until you've formed
                     yours. What decides it is whether you need to search old trips ...
    ```

  - Accepted costs: the run's message is a description of the new options rather than "here is
    what I'd do and why"; in a conversation where you had revealed the old pick, the chat now
    dodges questions it answered freely before; the earlier messages stay in the panel, and what
    the chat said about the old pick can still hint at the new one.

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
    this conversation; your next message starts from the summaries." A summary can still be
    written from the hub's copy (20261111paot, under "Leaving a conversation" below).
  - **The copy is kept as long as its card exists**
    ([202611114wet-hub-copy-retention.md](../decisions/202611114wet-hub-copy-retention.md),
    option `with-card`): "A conversation is kept while its card is in a registered project;
    once the card file or the project has been gone for 30 days, the hub deletes it." From the
    card's technical detail: at hub start, and once a day while it runs, list the copies; for
    each, check that its project is registered and its card exists; record when it was first
    found missing (this machine's state folder), and delete it 30 days after that, unless the
    card is back by then. The 30 days cover a checkout on another branch and a project removed
    and added back. There is no time limit otherwise: a conversation on a decided card stays
    readable for good. Accepted costs: text the agent quoted from your files stays on disk as
    long as the card exists; a renumbered card loses its conversation after 30 days, since the
    copy is filed under the old id (rare with dated ids).
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
option `remind`. For open and deferred cards, and for decided cards too
([202611111ky9-leaving-chat-on-decided-card.md](../decisions/202611111ky9-leaving-chat-on-decided-card.md),
option `remind`: "Remind you, as on open cards"):

- **Leaving saves nothing and runs nothing.** "Leaving" is moving to another card or the queue,
  reloading, closing the tab, or restarting the hub.
- On leaving within the page, a notice like the one for unsent text: "Your conversation on
  #0042 isn't summarized; it's there when you come back." (the same moment the unsent-text
  reminder uses, in `CardView.tsx`). Closing the tab shows nothing of president's (a browser
  only shows its own `beforeunload` question).
- **Coming back** to the card, also after a reload or a hub restart, the conversation area says
  "Conversation not summarized yet. [Write summary]" above the message box.
- **If Claude Code has deleted the conversation meanwhile, Write summary still works, from the
  hub's copy**
  ([20261111paot-summary-after-claude-deletes.md](../decisions/20261111paot-summary-after-claude-deletes.md),
  option `from-copy`: "a fresh session reads the saved messages and writes the summary, which
  you edit and save as usual"). #0018's "no longer remembers" line stays, and #0024's "This
  conversation is no longer on this machine" is replaced by the card's sketch:

  ```
  Discuss
    you, 2 Oct      Does our HTTP client already throw on 404?
    agent, 2 Oct    It does: src/http.ts line 40 ...
    The agent no longer remembers this conversation.
    Not summarized yet.  [Write summary from these messages]
  ```

  The run (the card's technical detail): a new `claude -p` with #0004's flags and a new session
  id, given the hub's copy on standard input (never as an argument) with the summary request,
  `--max-budget-usd 1` still capping it; nothing is saved to the session store (#0021) for it,
  or it runs with `--no-session-persistence`, since nobody continues it. Accepted costs: the
  fresh session sees only what the page showed, not the files the original agent read; one
  more run, and a long conversation costs more to read. Under 202611114wet's `with-card` the
  copy outlives Claude Code's, so this case does arise.
- The hub keeps the list of cards with an unsummarized conversation on this machine, outside
  the project (`$XDG_STATE_HOME/president/`), or derives it from the conversation's last
  message time against the card's last summary (the card offers both).
- The reminder is per machine; on another machine the card shows nothing, and a summary can only
  be written where you talked. Accepted cost: if you never come back, what you discussed never
  reaches the agent. (#0024 also named "after 30 days", when Claude Code deletes the session;
  20261111paot's `from-copy` lifts that for as long as the hub keeps its copy.)
- **On a decided card** (202611111ky9): the same notice when you leave ("Your conversation on
  #0043 isn't summarized; it's there when you come back."), and back on the card "Conversation
  not summarized yet. [Write summary]". The per-machine "not summarized" list includes decided
  cards. Saving the summary uses the action #0020 allows on resolved cards, with the Undo-window
  rule (nothing saved to a card decided less than 10 seconds ago), and it reaches the agent in
  `president pending` under "New notes from the human". Accepted costs: a quick look-up on an
  old decision also leaves a reminder until you close the conversation; decided cards with
  pending reminders are easy to miss, since decided cards aren't in the queue.

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
- **Decide this as my answer waits too**
  ([20261111is21-own-answer-with-open-chat.md](../decisions/20261111is21-own-answer-with-open-chat.md),
  option `wait`): "With an unsummarized conversation, 'Decide this as my answer' first shows the
  agent's summary to edit, then saves the summary and your answer together; 'Decide without
  summary' skips it." The same box, buttons and Esc as above. It is the same `resolve` action as
  Save and decide, with `choice: custom`, your answer as the decision's note and the summary as
  a separate `chat` entry, in one write, so `undoLastAction`'s `ours.action === "resolve"`
  check covers it and Undo takes both back. Accepted costs: a few seconds' wait and one more
  agent run even when your answer says it all, and two boxes in a row.
- When Claude Code's session for the conversation is gone, the summary Decide (and Decide this
  as my answer) offers is written the way 20261111paot writes it for Write summary: from the
  hub's copy. Neither card says so in words; it follows from both being the same summary.

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
  session, once the action's Undo notice has gone away (20261112160s, below) or when you press
  Start now in another tab (20261112dfik, below), with a prompt
  built from the card and its unseen feedback, and
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
- Under #0008, the new `recommendation` stays hidden until you reveal it, like any other. The
  run's message doesn't name it either, and every conversation on the card is neutral about it
  until you press `r`, even one where you had revealed the old pick (2026111272fu `reset`; see
  [The chat stays neutral until you reveal the pick](#the-chat-stays-neutral-until-you-reveal-the-pick-20261111mby8)).
- Undoing Ask for new options puts the card back as today (#0012). Under 20261112160s the run
  hasn't started while Undo is offered, so there is nothing to stop (if another tab started it,
  20261112dfik refuses the Undo instead); the hub still writes the
  run's options only against the card as the run read it (`update`'s feedback guard).
- **The run is a turn in the card's conversation, without the reminder**
  ([202611111gpm-new-options-run.md](../decisions/202611111gpm-new-options-run.md), option
  `shown-no-reminder`): "The run is a turn in the card's conversation (stored, shown in the
  panel, follow-ups reach the agent that wrote the options), but it doesn't mark the
  conversation as not summarized, since its result is already on the card."
  - It resumes the card's session, or starts one with `--session-id` and adds a session-store
    entry (#0021); both messages are saved in the hub's copy (#0018). The panel shows them:

    ```
    Discuss
      you, 14:02     Is IndexedDB available in the app's webview?
      agent, 14:02   Yes ...
      you, 21:00     Neither: Both assume a server. Compare on-device storage only.
      agent, 21:02   Here are three on-device options: IndexedDB, SQLite (OPFS), plain files...
                     (the options are now on the card)
    ```

  - The run doesn't add the conversation to the "not summarized" list (#0024); a conversation
    already on it from earlier messages stays there. A follow-up question you then ask, and its
    answer, make the conversation "not summarized" as usual.
  - The readable message and the options can come back in one `--json-schema` output (a
    message field next to the options).
  - **When the run fails** or returns options the checks refuse: nothing is written (the card
    stays `needs_new_options: true`, waiting for the working agent, as today), and the page says
    why, for example:

    ```
    Couldn't write new options: the agent's options didn't pass the card checks
    (option "b" has no title). The card waits for the project's agent, as before.
    [Try again]
    ```

    Try again starts the run again with the same note. There is no automatic retry (the card:
    "If you want one automatic retry, say so in your note"; there was no note).
  - Accepted costs: the reply has to be both a readable message and options the hub can check,
    which makes the run more fragile; the run's reasoning reaches the working agent only through
    the options unless you go on to discuss them; every "neither" starts or extends a stored
    conversation on this machine, even on a card you never chatted on (one you undo doesn't,
    below).
- **Your "Neither" message reaches the agent only once Undo is gone**
  ([20261112160s-undo-new-options-turn.md](../decisions/20261112160s-undo-new-options-turn.md),
  option `wait-out`): "Your "Neither" message shows in the panel at once, marked "Sending when
  Undo closes"; the run starts only when the Undo notice goes away (10 seconds, longer while you
  hover over it or it has keyboard focus), so an Undo before then removes the message, and
  nothing ever reached the agent."

  ```
  Right after pressing Ask for new options:
    you, 14:02     Is IndexedDB available in the app's webview?
    agent, 14:02   Yes ...
    you, 21:00     Neither: Both assume a server. Compare on-device storage only.
                   Sending when Undo closes

  Right after Undo:
    you, 14:02     Is IndexedDB available in the app's webview?
    agent, 14:02   Yes ...
  ```

  - On Undo: the card is restored (#0012), your note comes back as a draft in the Neither
    panel, the pending message leaves the panel, and nothing reaches the session, the session
    store (#0021) or the hub's copy (#0018). A later question goes to the conversation as it was,
    which never saw the "Neither" message. On a card with no conversation before, none is left.
  - Without Undo, the run starts when the notice goes away and the panel shows its reply as
    202611111gpm decided. A failed run behaves as decided there (message, Try again).
  - **How** (the card's technical detail): Ask for new options records the note as today, and the
    page shows the message as pending. The page asks the hub to start the run only when its
    `undo:<project>/<id>` toast closes (`src/web/toast.tsx`; the timer pauses while the toast is
    hovered or focused). `toast.tsx` has no close callback today; add one (for example
    `onClose`). A message you send in the panel during the wait is held until the run has
    started, so it reaches the session after the "Neither" message.
  - **Tab closed or reloaded before the notice goes away:** no run starts, and the card stays
    `needs_new_options: true`, waiting for the project's agent. The hub records the run as "to
    start" when the note is recorded, and as "started" once the run starts. Any page other than
    the one showing the Undo notice (a second tab, or this tab after a reload) that opens the
    card while the record says "to start" shows the second-tab message below, with
    **Start now** (20261112dfik replaced 160s's "didn't start" and Try again here: the page
    can't tell a tab closed early from a notice still waiting in another tab).
  - Accepted costs: every run starts about 10 seconds later, even when you never undo, which
    bends #0007's "starts an agent right away"; while you hover over the Undo notice the run
    keeps waiting; a tab closed in those seconds starts no run until you press Start now.
- **The same card open in a second tab while the run waits: that tab can start the run, and
  Undo is then refused**
  ([20261112dfik-second-tab-during-wait.md](../decisions/20261112dfik-second-tab-during-wait.md),
  option `refuse-undo`): "The second tab says the run hasn't started yet and offers "Start now";
  pressing it starts the run, and Undo in the first tab is then refused with "Couldn't undo: the
  run for this note already started from another tab", as 0012 already does when another tab
  changed the card."

  ```
  Tab B, 21:00:03 (you pressed Ask for new options in tab A at 21:00)
    you, 21:00     Neither: Both assume a server. Compare on-device storage only.
    The run for your note at 21:00 hasn't started. If another tab still shows
    its Undo notice, it starts when that closes.   [Start now]

  You press Start now in tab B, then go back to tab A and press u:
    Tab A   Couldn't undo: the run for this note already started from another tab.
  ```

  - Tab B first shows today's "You changed this card in another president tab." notice, as for
    any change made in another tab; the message above follows it.
  - If you don't press Start now, tab B replaces it with "Writing new options..." once tab A's
    notice closes and the run starts. If tab A was closed early, Start now is the Try again
    160s described.
  - **The hub tells every tab when a run starts.** Starting a run writes nothing to the card,
    so today no event goes out: when the hub's record turns to "started", it emits `cards` (or
    a new hub-to-tab event), so that tab B replaces Start now with "Writing new options..." and
    tab A drops "Sending when Undo closes". Tabs still send nothing on the socket.
  - **Undo checks the record.** `undoLastAction` (`src/server/cards.ts`) for a `neither`
    refuses with a new code (for example `run_started`) once the hub's record for that note
    says "started"; the page shows the message above. The Undo journal alone can't tell, since
    starting a run doesn't change the card's revision or file stamp.
  - The second tab's text uses only what the hub knows: the note's time and "to start".
  - **Ordering rules** (the card's "Under every option"): the hub starts at most one run for a
    note and never starts one for a note already undone (Undo clears its "to start" record). An
    Undo and a start are handled one after the other: the first tab's notice closing after the
    run started never starts a second one, and a start that comes at the same moment as an Undo
    either starts the run (and the Undo is refused) or finds the note already gone.
  - Accepted costs: one click on Start now in the second tab takes Undo away from the first
    tab; the second tab doesn't know whether a notice is still waiting elsewhere, so its message
    says "if", in that case and after a tab closed early alike; an Undo pressed in the first tab
    after the run started from the second is refused, so your note stays sent and the new
    options still come.

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

## F. Rename the command to `preside` (#0016, 20261111dmvt)

Cards: [0016-rename-the-cli.md](../decisions/0016-rename-the-cli.md), option `rename`, and
[20261111dmvt-command-name.md](../decisions/20261111dmvt-command-name.md), option `preside`. An
agent-facing pull request: it changes the CLI, the skill and every command agents are told to
type.

- The command becomes **`preside`**, and **that name is reserved on npm with a placeholder
  package**, so `npx preside` can only ever find ours or nothing. The product can still be
  called president; only what you type changes.

  ```sh
  preside pending
  # done: preside seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
  ```

- **Check the name again right before publishing.** On 2026-11-11 `npm view preside` gave 404
  (free), and so did its punctuation variants `pre-side`, `pre.side` and `pre_side` (npm
  refuses a new name that matches an existing one once punctuation is removed). A name free
  then can be taken before the placeholder is published.
- **The placeholder** (the card's technical detail): a `package.json` with the name `preside`,
  a version such as `0.0.0`, a README saying what it is, and no `bin`, published with
  `npm publish` from the human's npm account. An agent prepares it and asks the human to
  publish it or approve publishing.
- The work: about 200 mentions of `president <command>` in `src`, `bin`, `skills`, `docs`,
  `README.md` and `test` (the card counted 181); the `bin` entry in `package.json` (today
  `"president": "bin/president.js"`); the help text (`src/cli/main.ts`); the `done:` lines
  `pending` prints (`src/cli/commands.ts`); error messages; the README's install line
  (`ln -s "$PWD/bin/president.js" ~/.local/bin/president`) and its "Use `president`, not
  `npx president`" warning (and the skill's); `docs/card-format.md`. Existing installs need
  relinking. The skill changes with the rename, since projects link to the copy in this repo.
- #0016 and dmvt rename only the command. Other names with "president" in them (the
  `PRESIDENT_PORT` variable, the `~/.config/president/` and `~/.local/state/president/`
  folders, the package's own `name`, the product) are not renamed by them.
- Accepted costs: `preside` begins like `president`, so habit can turn one into the other in
  either direction; it is a common word, so searches for it mostly find chairing meetings.

### The `president` alias and when it ends

The card's recommendation, with no "no alias" in a note: **`president` keeps working next to
`preside`** for a while, so old `done:` lines printed before the rename and agents typing the
old name from habit still find the installed command, rather than failing and trying
`npx president`, the exact mistake the rename guards against.

- In F: a second `bin` entry (`"president": "bin/president.js"` next to the new one) and a
  second link in the README's install step. Everything president prints and every doc uses
  `preside`.
- **F2 removes it**, in a pull request, one month after the rename ships, or once every
  registered project's own docs and agent instructions (its `CLAUDE.md`, its `docs/`) use the
  new name, whichever is later. Whoever removes it checks both: the month has passed, and a
  `grep` for `president <command>` in each registered project's `CLAUDE.md` and `docs/` finds
  nothing.
- Accepted cost: agents keep seeing and typing `president` longer, and the old name has to be
  removed in a second step.

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
- **#0018 `hub-copy` + #0024 `remind`, settled by 20261111paot `from-copy`.** They disagreed
  after Claude Code deletes a conversation; now #0018's "no longer remembers" line stays,
  #0024's "no longer on this machine" goes, and Write summary works from the hub's copy.
  202611114wet's `with-card` keeps that copy as long as the card, so the case is real.
- **Four per-machine stores, one folder.** Session ids (#0021), the hub's copy (#0018), the
  "not summarized" list if it is kept rather than derived (#0024), and the "first found
  missing" dates 202611114wet's cleanup records all live in `$XDG_STATE_HOME/president/`, keyed
  by project name and card id, and none travels with Sync. 2026111272fu adds the
  per-conversation "revealed" flag, with which recommendation was revealed; its card suggests
  keeping it next to the session id, so on the same machine and not in the card.
- **202611111gpm `shown-no-reminder` + #0002 + 20261111sblu.** Every "neither" now gives the card
  a stored conversation, and #0002 opens the panel by default once a card has one, so after a
  "neither" the panel is open on that card (three columns on an A/B card). The run's
  conversation is kept as long as the card (202611114wet).
- **20261112160s `wait-out` + #0007 `spawn` + #0012 `hybrid`.** The run starts when the Undo
  notice closes rather than at once, so an undone "neither" leaves no trace in the card (#0012),
  the panel, the hub's copy or the session. It also means the run never needs stopping on
  Undo, and the new-options run can only write against a card whose Undo window is over.
- **20261112dfik `refuse-undo` + #0012 `hybrid` + 20261112160s `wait-out`.** A run started from
  another tab counts like another tab writing the card: Undo is refused (#0012's rule), so an
  Undo that goes through still means nothing reached the agent. The one exception to 160s's
  "the run starts when the notice closes" is a run you start yourself with Start now.
- **20261112l9vh `count-apart` + 2026111209dq `top-only` + 20261111st0c.** A skipped
  project's line counts every unsynced card change in its `decisions/`, including new cards an
  agent copied into the main folder, which reach git there only by a hand commit.
- **202611111gpm + #0019 / 20261111is21.** The run doesn't make a conversation "not summarized",
  so deciding a card whose only conversation is the new-options run doesn't wait for a summary;
  a follow-up question does make it wait.
- **20261111nsaj `visit` + 20261111mby8 `neutral`.** The page hides the pick again on every new
  visit, but a conversation in which the pick was revealed stays "revealed" for the chat (mby8's
  technical detail), and its earlier messages may name the pick. Both cards accepted this.
  2026111272fu `reset` ends it at new options: once the hub writes them, the conversation is
  neutral again about the new pick until you press `r`, though its earlier messages still
  name the old one.
- **202611112hzh `back-now` + 202611116ff6 + #0009.** A missing `defer_until` counts as passed,
  except on a withdrawn card, whose date is ignored either way. A dependency that came back from
  deferral is still undecided, so its dependents stay sunk, as with any deferred dependency.
- **20261111st0c `reviewed-main` + #0013 `dated`.** With numbered ids, another card can take a
  draft's number in the main folder while the draft is under review; the duplicate-id rule
  (renumber the newer card, at the copy) still applies. Dated ids (D) make that rare.
- **20261111st0c + 2026111209dq `top-only`.** In a project Sync skips, a new card copied into the
  main folder reaches git only by a hand commit there, like the human's answers.
- **#0007 `spawn` + #0010 `neither-plus`**: the Neither panel has two buttons, Ask for new
  options (now runs the session) and Decide this as my answer. #0007 works under #0004 as
  written: the session reads and researches, and the hub writes.
- **#0008 `hidden` + the chat (#0005, #0007), settled by 20261111mby8 `neutral`.** The session
  still reads the whole card file, `recommendation` included, but an instruction sent with
  every message keeps it from naming the pick before you press `r`. 2026111272fu `reset`
  extends it to the new-options run: its message never names the new pick, and a new pick is
  hidden in every conversation on the card until you press `r`, even where the old one was
  revealed.
- **20261111fauj `scenario` + #0008.** Teach me on an option-less card drafts no answers of its
  own, for the same reason #0008 hides the pick: the agent's ideas shouldn't come before yours.
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
- **#0016 `rename` + 20261111dmvt `preside` touch everything.** Every printed command and doc
  line in A2 to E changes name. If F comes later, those PRs write `president`; F renames them
  with the rest, and the alias keeps anything missed working until F2.

### Existing docs that now contradict a decision

Not edited here (this pull request records decisions in `foundations.md` and the roadmap
only); the build PR named in brackets fixes each.

- `docs/card-format.md` and the skill, picking an id ("add one to the highest number"):
  replaced by #0013's dated ids [D].
- `docs/card-format.md`, `session_id` "Reserved for the per-card chat": unused under #0021 [E].
- `docs/card-format.md`, feedback types (`neither | note | defer | reopen | undo`): gains `chat`
  (#0023) [D]; fields: gains `withdrawn` (#0014) [D] and `defer_until` (#0017) [C or D].
- `docs/card-format.md` Lifecycle, notes only on open and deferred cards: #0011 allows them on
  resolved cards [C].
- README `d` row ("defer"): under #0017 `d` defers for a week [C].
- The card-format Lifecycle (`deferred ──reopen──▶ open` is the only way back): under #0017 a
  deferred card also returns when `defer_until` passes [C].
- README, the `n` row ("an agent writes new ones"): under #0007 the hub starts the card's
  session at once [E].
- README and the skill, "Use `president`, not `npx president`": #0016 renames the command, to
  `preside` (20261111dmvt) [F].
- The skill's "Not decided yet" paragraph (card changes outside an apply), its interim rule to
  write new cards straight into `<main>/decisions/`, *Writing a card*, step 1, and *Changing a
  card*'s "A new card has no human edits to lose: write its file directly
  (`<main>/decisions/<id>-<slug>.md`)": 20261111st0c has new cards reviewed in the agent's
  worktree first, then copied [A2; fixed in PR #17].
- The skill's pointer "(president's `docs/roadmap.md`, 'Needs a card' 1)": that item has since
  held other questions (the list is empty now); the card it meant is 20261111st0c, decided [A2;
  fixed in PR #17, which removes the paragraph that held the pointer].
- foundations.md, *Engineering process*, "Every task ... ends in a PR" and "the loop repeats
  until **every** finding, non-blocking ones included, is fixed": a task that only writes cards
  now ends with them reviewed in the agent's worktree and copied into the main folder, with no
  pull request, and its review loop stops when nothing should-fix is left (20261111st0c) [A2,
  when the skill changes; fixed in PR #17].
- The deferred card page, "Deferred. It stays out of the queue until reopened."
  (`CardView.tsx`): a deferred card without a date comes back at once (202611112hzh) [C].

## Needs a card

Questions the decided cards leave open. Each is the human's to answer: write a card before
building the part it blocks. Grouped by the build PR that needs the answer.

The thirteen questions this list held after batch 2 were all answered on 2026-11-12: 1 by
20261111st0c, 2 by 202611112hzh, 3 by 202611116ff6, 4 by 20261111nsaj, 5 by 20261111mby8, 6 by
20261111sblu, 7 by 202611114wet, 8 by 20261111paot, 9 by 202611111ky9, 10 by 20261111is21, 11
by 202611111gpm, 12 by 20261111fauj and 13 by 20261111dmvt. B's "Suggestion, not decided" about
the notice after a pull was answered by 20261112xp4s.

The three questions this list held after PR #14 were answered on 2026-11-12: 1 by
20261112l9vh, 2 by 2026111272fu and 3 by 20261112160s.

The question this list held after PR #15 (the same card open in a second tab while the run
waits for Undo) was answered on 2026-11-12 by 20261112dfik.

None at the moment.
