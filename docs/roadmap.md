# president — roadmap

The work that settled decisions imply and that isn't built yet. Each section says which card
decided it; the card file has the full reasoning, the options that weren't chosen and the
sources. The decisions themselves are listed in [foundations.md](foundations.md#settled-decisions).

Build what is written here; don't re-decide it. Where a section says something is still open,
that is a question for the human: write a card (see `skills/decision-cards/SKILL.md`) rather
than picking an answer.

Status on 2026-11-11: none of this is built.

| Work | Decided by | Blocked on |
|---|---|---|
| [Sync](#sync-0001) | #0001 | nothing; can start now |
| [PR 2: per-card chat](#pr-2-the-per-card-chat-0003-0004-0006) | #0003, #0004, #0006 | #0002 (placement), #0005 (Teach me), #0018 (showing the earlier conversation), #0019 (deciding while a conversation is open); the Neither button also on #0007; each part marked "Open — see #0020", "#0021" or "#0023" on that card |

## Sync (#0001)

Card: [0001-sync-across-machines.md](../decisions/0001-sync-across-machines.md), option
`sync`. Today president has no git code at all; card changes sit as uncommitted edits in each
project's working tree.

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
   whenever the remote changed one of those cards (for example after an apply PR that commits
   them), until someone fixed the checkout by hand.
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
- Document Sync in the README (Usage) when it ships.

## PR 2: the per-card chat (#0003, #0004, #0006)

PR 2 replaces the placeholder `src/web/components/CardAssistant.tsx` with a conversation with a
headless Claude Code session per card (see "Chat engine" in foundations.md), plus *Teach me*,
*More info / research* and *Neither, try again* buttons. Three cards fix how the session runs,
where the conversation lives and what it may change; #0002 and #0005 (see
[Cross-card consequences](#cross-card-consequences)) and the open questions #0018 and #0019
(below) must be decided before PR 2 can start.

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

(The first message of a conversation has no `--resume`: either take the new session's id from
the stream, or start it with `--session-id <uuid>`; see the next section.)

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

- New options (*Neither, try again*, if #0007 picks a session) come back as structured output
  (`--json-schema` with the card's `options` shape), and the hub writes them with the same
  validation and revision checks as `president update`.
- The conversation summary (next section) is returned as text; the hub writes it as a feedback
  entry after the human has read and edited it.

Weigh when building, without changing the decision: `--safe-mode` turns off installed mods,
CLAUDE.md and skills (whether a mod still loads under `--restricted` isn't documented). The
card's known cost stays: read access plus WebFetch is still a path for a prompt-injected page
to leak project text in a URL. A WebFetch domain allowlist would narrow it but limit research;
adding one is the human's call (write a card if it comes up). The session also can't run the
project's code to check a claim.

### Where the conversation lives (#0003)

Card: [0003-conversation-storage.md](../decisions/0003-conversation-storage.md), option
`summary`.

- **The full conversation stays in Claude Code's own store** on the machine that ran it
  (`~/.claude/projects/<project>/<session-id>.jsonl`, deleted after `cleanupPeriodDays`, 30
  days by default). president never copies it into the project, and later messages resume with
  `claude --resume <session-id>`.
- **Open — see #0018:** whether the page shows the earlier messages when you come back to a
  card on the same machine (after a reload or a hub restart): by reading Claude Code's `.jsonl`
  (its format is internal to Claude Code and changes between versions), by the hub keeping its
  own copy outside the project, or by showing only the saved summaries. #0003 decided where the
  log is stored, not this.
- **The card stores only `session_id`**, the field already reserved in `src/core/schema.ts`
  and docs/card-format.md. The hub writes it when the first message starts a session, and
  again when it has to replace it (see "On another machine" below). Individual messages never
  change the card file; these `session_id` writes are the only writes to the card while you
  chat. Each one changes the card's revision (a hash of the whole file), so it goes through the
  hub's card writer, and the page treats it as the hub's own write: it refreshes its revision
  without an "An agent changed this card" or "another president tab" notice, and deciding
  mid-conversation works as today.
  - Implementation option: generate the id up front and start the first run with
    `--session-id <uuid>` (in `claude --help`) instead of parsing it from the stream, so the
    hub writes `session_id` before the run starts.
  - **Open — see #0020:** on which card statuses the hub may write `session_id` (no action
    writes it today), which depends on whether the chat is available on decided cards at all.
- **When a conversation ends** (the human closes it, or decides the card), the session writes a
  short summary of what was learned and asked for. The hub shows it in an editable box; only
  what the human saves is appended to `feedback`, for example:

  ```yaml
  feedback:
    - at: 2026-11-12T09:14:00Z
      type: chat
      note: >-
        Discussed with the card's agent. I now see that B's extra code is one line per call
        with a helper. Asked it to check whether our HTTP client already throws on 404.
  ```

  **Open — see #0023:** whether this is a new `chat` feedback type or a plain `note` (the card
  leaves it open; it changes what the human sees in History and what agents read in
  `president pending`). A new type has to be added to `FEEDBACK_TYPES` in `src/core/model.ts`,
  the `LABEL` map in `src/web/components/FeedbackHistory.tsx` and the feedback section of
  docs/card-format.md; `president pending` prints any type as it is. Either way it reaches the
  project's working agent through `president pending` like any note.
- **On another machine** the card's `session_id` points at nothing (and on this machine after
  30 days). When `--resume` can't find the session, start a fresh one seeded with the card and
  its earlier summaries, say on the page that the earlier conversation isn't available here,
  and replace `session_id`. The conversation restarts from the summaries, not from where it
  was; that loss of detail is the accepted cost.
  - **Open — see #0021:** whether `session_id` is stored per machine (keyed by host, or outside
    the card). With one field, two machines that both chat about a card keep replacing it, and
    Sync then reports the card as changed on both machines.
- Summaries are card file changes, so they travel between machines with Sync (#0001); the
  local logs don't, and no transcript ever goes into git.

### The chat never applies decisions (#0006)

Card: [0006-who-applies-decisions.md](../decisions/0006-who-applies-decisions.md), option
`working`. Today's flow stays exactly as it is: Decide only rewrites the card, the card shows
"Waiting for an agent to apply it to the project.", and the project's working agent applies it
from `president pending` and runs `president applied`. For PR 2 this means:

- The chat session never records decisions in docs, edits code or runs `president applied`
  (it couldn't anyway: #0004 gives it no write tools and no Bash). Don't send it instructions
  to apply, and don't add a "Decide and apply now" button.
- Deciding keeps today's 10-second Undo window (`src/web/toast.tsx`), and nothing may write
  the card after the decision inside that window: Undo restores the card only if it is still
  the file president wrote for the decision.
- **Open — see #0019:** what happens when you decide while a conversation is open. #0003 says
  the summary is offered when you decide; neither card says how that fits Decide's single
  keypress (wait for the summary to be written and edited before recording the decision, decide
  at once and drop the summary, or offer it after the Undo window, which needs #0011 or a timed
  save), or whether the summary is lost if you leave the card or close the tab without closing
  the conversation. Whatever is chosen must keep the Undo-window constraint above.
- The working agent didn't hear the conversation. What it learns about it is the summary
  feedback entry (#0003), so the summary should state what the human concluded and asked for,
  not just what was discussed.
- The skill's "Applying resolved cards" and the apply flow in docs/card-format.md need no change
  for #0006.

## Cross-card consequences

- **PR 2 waits on #0002 and #0005**, both still open (and on the open questions #0018 and
  #0019, see the #0003 and #0006 sections):
  [#0002](../decisions/0002-conversation-placement.md) decides where the conversation sits on
  the card page (side panel, below the options, or a focus mode) and
  [#0005](../decisions/0005-teach-me-format.md) what *Teach me* produces. Every option on both
  works within a read-only session, so #0004 doesn't narrow them.
- **#0007 (who writes new options after "neither") depended on #0004**, which is now
  `readonly`. Its options `spawn` and `per-card` work under it as written: the session only
  reads and researches, returns the options with `--json-schema`, and the hub writes them with
  `president update`'s checks. No option on #0007 needs more permissions. Until #0007 is
  decided, the Neither button keeps today's flow (the working agent rewrites the options).
- **#0007 and #0010**: if #0007 picks `per-card` and #0010 picks `neither-plus`, the Neither
  panel gets three buttons (see #0007's last paragraph).
- **#0006 settled `working`**, so #0004's suggestion to revisit `ask` "if you later want the
  chat to apply decisions" doesn't apply.
- **#0003 and #0001**: the summary entries and `session_id` are ordinary card changes, so they
  sync like answers. Sync isn't needed for PR 2, but until it ships they travel only when
  someone commits `decisions/` by hand. **Open — see #0022:** whether agents that apply
  decisions should commit the human's card changes in their PRs.
- **#0003 and #0011** (notes on decided cards, open): a conversation that ends on a card the
  human has already decided would append a feedback entry to a resolved card. Whether that is
  allowed is the same question as #0011; until it is decided, save summaries only on open or
  deferred cards (for a summary offered when you decide, see #0019 above). **Open — see
  #0020:** whether the chat is available on decided cards at all, and if so whether the hub may
  write `session_id` and summaries there (#0011 covers only the human's notes).
