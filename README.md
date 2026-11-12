# president

A local web app where coding agents put **decision cards** in front of you.

You handle direction (product, UX, naming, research questions); agents handle implementation.
When an agent reaches a question that is yours to answer, it writes a card (a markdown file in
the project's `decisions/` folder) with the context, 2 to 4 concrete options, honest pros and
cons, and its recommendation. president collects the cards from all your projects into one
queue. You read, pick an option (or reject them all and say why), and move to the next card.
Agents then apply your decisions to the project's docs and code.

Background: [docs/foundations.md](docs/foundations.md). Card format: [docs/card-format.md](docs/card-format.md).
Planned work: [docs/roadmap.md](docs/roadmap.md).

## Setup

Needs Node 24.9 or newer.

```sh
git clone git@github.com:alexandreffaria/president.git
cd president
npm install
npm run build
npm start            # http://127.0.0.1:4747
```

president only listens on 127.0.0.1. Set `PRESIDENT_PORT` to use another port.

### Install the `preside` command

Agents use the `preside` command to register projects and check their cards. Put it on your
PATH by linking the repo's script (no build needed; Node 24 runs the TypeScript directly):

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/bin/preside.js" ~/.local/bin/preside   # make sure ~/.local/bin is on PATH
preside help
```

(`npm link` works too if your npm prefix is writable.)

The command used to be called `president`, and that name no longer works. If you installed it
under the old name, run the `ln -s` line above from this repo and remove the old link:
`rm ~/.local/bin/president`. If you used `npm link`, run it again (or delete `president` from
`$(npm prefix -g)/bin`).

**Use `preside`, not `npx preside`, outside this repo.** When a command isn't installed
locally, `npx` looks for an npm package with that name. The `preside` package on npm is a
placeholder of ours with no command, so `npx preside` only fails with
`could not determine executable to run`; it can't run someone else's code, but it doesn't run
president either. Never type `npx president`: an unrelated package called `president` exists
on npm, and if a future release of it adds a command, `npx president` would download and run
it, without asking when there is no terminal (as for an agent). Inside this repo `npx preside`
runs the local copy.

### Install the agent skill

The skill in [skills/decision-cards/SKILL.md](skills/decision-cards/SKILL.md) teaches Claude Code
when and how to write cards, and how to act on your answers.

**In this repo it's already active.** The repo commits a relative symlink,
`.claude/skills/decision-cards` → `../../skills/decision-cards`, and Claude Code loads project
skills from `.claude/skills/`. Any Claude Code session started in a clone of president has the
skill, with nothing to install. Other projects are unaffected.

On Windows, git checks symlinks out as plain text files unless `core.symlinks=true` is set.
Without it, `.claude/skills/decision-cards` is a text file containing `../../skills/decision-cards`
and the skill silently doesn't load. Clone with `git clone -c core.symlinks=true …` (creating
symlinks also needs Developer Mode or admin rights).

**For other projects**, pick one:

- Per project, local only: link it into that project's `.claude/skills/` and don't commit the link
  (the snippet lists it in the project's `.git/info/exclude`, so git doesn't offer to).
  `PRESIDENT` must be an absolute path. A symlink target resolves against the link's own folder
  (`.claude/skills/`), not your current directory, so a relative `PRESIDENT` gives a dangling link.

  ```sh
  # from the other project's root
  PRESIDENT=/absolute/path/to/president   # or: PRESIDENT="$(cd path/to/president && pwd)"
  mkdir -p .claude/skills
  ln -sfn "$PRESIDENT/skills/decision-cards" .claude/skills/decision-cards
  EXCLUDE="$(git rev-parse --git-path info/exclude)"   # .git/info/exclude
  mkdir -p "$(dirname "$EXCLUDE")"
  grep -qxF .claude/skills/decision-cards "$EXCLUDE" 2>/dev/null ||
    echo .claude/skills/decision-cards >> "$EXCLUDE"
  test -e .claude/skills/decision-cards/SKILL.md && echo ok || echo dangling
  ```

- Per project, committed: use a relative target, counted from `.claude/skills/`, the same way this
  repo does. Only commit it if everyone working on that project has president checked out at the
  same place relative to it. For president cloned next to the project:

  ```sh
  # from the other project's root, with president at ../president
  mkdir -p .claude/skills
  ln -sfn ../../../president/skills/decision-cards .claude/skills/decision-cards
  test -e .claude/skills/decision-cards/SKILL.md && echo ok || echo dangling
  ```

- Globally, for every project on this machine:

  ```sh
  # from the president repo root
  mkdir -p ~/.claude/skills
  ln -sfn "$PWD/skills/decision-cards" ~/.claude/skills/decision-cards
  ```

  This takes precedence over the in-repo copy; if you installed it globally before and only want it
  here, `rm ~/.claude/skills/decision-cards`.

Because these are symlinks, pulling this repo updates the skill everywhere it's linked.

## Usage

1. Register a project (or let an agent do it):

   ```sh
   preside add ~/projects/my-app --create     # --create makes my-app/decisions/ if missing
   ```

   You can also add and remove projects on the **Projects** page.

2. Work with your agent as usual. When it hits a decision for you, it writes
   `decisions/20261112k7q2-some-question.md`. The card shows up in the queue right away, no reload needed.

3. Go through the **Queue**. On a card:

   | Key | Action |
   |---|---|
   | `1`–`9` (`a`/`b` on A/B cards) | select an option, then `Enter` to decide (optionally type why first) |
   | `r` | show the agent's pick (hidden until you ask, and again each time you come back to the card) |
   | `n` | neither: reject all options with a note; an agent writes new ones. The same panel can also decide the card with what you typed as your own answer |
   | `m` | add a note without deciding; also works on a decided card (the decision stays) |
   | `c` | show or hide the conversation with the card's agent |
   | `d` | defer for a week: the card leaves the queue and comes back, marked "back from deferral", when the week is over |
   | `D` | defer until another date: tomorrow, next month or a day you pick (also the **Defer until…** button) |
   | `j` / `k` | next / previous card |
   | `u` | undo the last action on a card: a decision, deferral, "neither", note, saved conversation summary or reopen (while its notice is shown); an undone note, "neither" or summary comes back in its panel or box |
   | `?` | all shortcuts |

   Shortcuts never act while you are typing or while the help is open. `Enter` and `Space` on a
   focused button or link press that control instead. While the Neither or Note panel or the
   summary box is open, only `Esc` works (it closes the panel). What you type on a card and
   haven't sent (a note, a "why", your own answer, a message, a summary you are editing) is
   kept until you send it, even if you close the panel or leave the card, and deferring (`d`,
   `D` or the Defer buttons) is refused while there is any.

   The queue shows cards that are ready first, then the ones that depend on a card you haven't
   decided yet; each group by priority, then oldest first. A deferred card stays under
   **Deferred** until its date, then is back in the queue; a card deferred with no date (before
   this existed, or by hand) is back at once.

   A card an agent withdrew (it no longer matters, the agent says why) leaves the queue for the
   collapsed **Withdrawn by agents** list, even if it was deferred: its date is ignored while it
   is withdrawn. Its page shows the agent's reason, and you can still decide it, add a note or
   reject its options, but not defer it (`d`, `D` and the Defer buttons are gone there). **Back
   to queue** puts it back (with a "Back in the queue" note, so the agent hears of it); a
   deferred one goes back under Deferred if its date is still ahead, otherwise straight to the
   queue, and you can defer it from there. Cards that depend on it stay at the bottom, marked
   "depends on #0042, withdrawn", until you decide it. Once you decide it, its page keeps the
   agent's reason in a muted line under the decision: "An agent had withdrawn this card:
   <reason>".

   If an agent changes a card while you have it open, president shows what changed and refuses
   to send anything until you press **I've read it**, so you never decide on text you didn't see.

   After you decide, president moves to the next card. Undo puts the card back exactly as it
   was, as long as nothing changed it since (an agent applying it, for example); after that,
   reopen it instead. What you wrote with it (your "why", your answer, the Neither text) comes
   back as a draft, so you can fix it and send it again. An undone decision also leaves an
   `undo` entry in the card's history, so an agent that already saw it knows to revert its work.

   You can talk about a card with its own agent (`c`): a Claude Code session, run on this
   machine in the card's project, that reads the project and searches the web but can't change
   anything (it uses your Claude Code login). From about 1100 px wide the conversation sits
   beside the card; narrower, under it. The conversation stays on this machine, in
   `$XDG_STATE_HOME/president/` (by default `~/.local/state/president/`), never in the
   project. When you're done, **Write summary**: the agent drafts a summary, you edit it, and
   what you save is added to the card's history as a conversation summary, which the project's
   working agent reads like a note. Until then the card reminds you it isn't summarized;
   **Close without summary** in the summary box ends the reminder, drops the draft and adds
   nothing to the card (Undo on its notice brings them back).
   **Teach me** asks the agent for a worked example on one realistic scenario from the project
   (a guess first, then each option walked through it), and **More info** for the two or three
   facts the decision turns on, each answered briefly and backed by a quote from a primary
   source, with its link. Deciding a card whose conversation isn't summarized first
   shows the agent's summary to edit: **Save and decide** adds it and your decision in one
   write (Undo takes both back), **Decide without summary** decides and closes the conversation
   as Close without summary does (Undo brings the reminder back), and Esc goes back to the card.

   Notes (`m`) reach agents through `preside pending`, which lists notes they haven't read yet.
   An agent marks a card handled with a token from `pending` that records what it was shown, so
   a note you add, or a decision you change, while it works is never marked as read or applied
   by mistake.

4. **Decisions** lists everything you decided, newest first, and whether an agent has applied it.

5. **Sync** (the button in the top bar, or `s`) sends your answers to your other machines and
   brings theirs here. president writes card files but never commits them on its own; the top
   bar shows "3 answers not synced" while a project has card changes that aren't pushed, so
   press Sync before you leave a machine. Where that doesn't fit next to the menu, the number
   is on the Sync button instead. When the hub starts it only runs `git fetch`, which
   changes no file and no branch, and shows "2 card changes on the remote, press Sync".

   For each project with card changes, here or on the remote, Sync runs `git fetch`, checks
   that it is safe to touch the checkout, commits everything in `decisions/` in one commit
   ("decisions from laptop: 0003, 0005"), then `git pull --rebase --autostash` and `git push`.
   The top bar then lists what happened in each project. It says "Not now" and changes
   nothing when:

   - the checkout isn't on the remote's main branch (an agent's feature branch, say), a rebase,
     merge, cherry-pick, revert or bisect is in progress, a file has unresolved conflicts, or
     the branch has no upstream;
   - there are commits that aren't pushed and change files outside `decisions/`, or change
     nothing at all (an agent's work: the pull would rebase it and the push would publish it);
   - a file outside `decisions/` that changed on the remote has uncommitted edits here.

   An untracked file where the pull would write is left to git, which refuses to overwrite
   it: Sync then says a file git doesn't track is in the way, with git's error naming it,
   nothing is lost, and your answers stay in a local commit; move or commit that file, then
   press Sync again. Ignored files are expendable, as in any `git pull`:
   if the online copy adds a tracked file at the exact path of a file you ignore here, git
   replaces your file (and it removes ignored files in a folder the online copy turns into
   a file).

   If the same card changed on both machines, Sync puts everything back as it was, keeps your
   answers in a local commit and says "Not synced: 0001 changed on both machines"; fixing that
   is a manual git step, and pressing Sync again retries. If the pull or the push fails
   (offline, authentication), it shows git's error; your answers stay in the local commit for
   the next Sync. If an agent saves a file during the few seconds the pull takes, Sync stops
   before pushing and says so: git keeps the older copy in its stash entry named `autostash`,
   which Sync names exactly (the stash is shared with agents, so a bare `git stash drop` could
   remove theirs). After the pull Sync checks again, and if an agent committed or switched
   branches meanwhile, it doesn't push. A rebase left in progress (say the hub stopped during
   a pull) is shown in the top bar, with the files it set aside and `git rebase --abort` to
   get them back. Sync is the only time president changes a checkout (otherwise it
   only reads git's state, and fetches at start), and while it runs in a project, card
   actions there are refused (an Undo refused that way stays on offer, to try again). git never asks
   for a password or passphrase (a remote that needs one fails instead, so use a credential
   helper or an ssh agent), and each git command is stopped after a timeout. Sync only works
   on a project whose folder is the top folder of its git repository, and it skips a project
   with git submodules (a `.gitmodules` file or a submodule in the index), or whose file
   list is too long to check for them: commit and push `decisions/` there by hand. The top bar
   counts such a project's answers on a line of their own, "web: 2 answers not synced (Sync
   skips it)", which stays until they are committed and pushed (until committed, where the
   repository's branch tracks nothing or HEAD is detached) and never adds to the Sync
   button's number (a folder outside git shows no count). If git prints more than Sync reads
   (4 MiB) anywhere else, Sync stops with "git output too large". For every list it reads
   before its first change (the `git add` of the cards), that means it changed nothing; the
   lists it reads later are bounded by earlier ones, so they can't realistically be cut. A
   very large change on the online copy matters only when an agent has uncommitted edits
   here: then Sync can't compare the two, and you press Sync again once those edits are
   committed and pushed, or put away.

To try it with sample cards:

```sh
preside demo        # copies examples/demo-project to a temporary folder and registers the copy
```

Work on the copy, not on `examples/demo-project` itself: deciding a card rewrites its file. Give
a folder (`preside demo ~/president-demo`) to keep the copy around, and `preside remove demo`
when you are done.

### CLI

```
preside add <path> [--name <name>] [--create]   register a project
preside list [--json]                           show registered projects
preside remove <name-or-path>                   unregister (files are not touched)
preside validate [path]                         check the cards in <path>/decisions, or one card file
preside pending [path] [--json]                 what agents should act on: unapplied decisions,
                                                rejected options, unread notes; each card ends
                                                with the `done:` command to run once handled
preside applied <card-file> --token <token>     mark a resolved card as applied
preside seen <card-file> --token <token>        mark the human's feedback on a card as read
preside update <card-file> <new-version-file>   replace an undecided card with an agent's rewrite,
                                                only if the human changed nothing since the agent
                                                read it
preside demo [path] [--name <name>]             copy the sample project and register the copy
preside serve                                   start the hub (same as npm start)
```

A project is named after its folder unless `--name` says otherwise; when that name is taken, `add`
uses `<name>-2`, `<name>-3`... and says so. The registry is a folder with one file per project,
`$XDG_CONFIG_HOME/president/projects/<name>.json` (default `~/.config/president/projects/`),
holding the project's path. There is no lock: `add` creates its file exclusively (a temp file
hard-linked into place), so agents that run `preside add` at the same time all get
registered, each under its own name. If two `add`s of the same folder race, the folder is still
listed once, under the name that sorts first, and the duplicate file is removed. A
`projects.json` from an earlier version is moved into the folder the first time president runs
(it is kept as `projects.json.migrated`).

A project is its folder's path. If you move a project, run `preside remove <name>` and then
`preside add <new path>`: president doesn't follow the move, and a different repository later
created at the old path would be taken for the old project. `preside list` and the Projects
page say when a project's folder, or its `decisions/` folder, is missing.

## Development

```sh
npm run dev         # API on :4747 (restarts on change) + Vite with HMR on http://127.0.0.1:5173
npm test            # vitest (UI tests run in happy-dom)
npm run typecheck   # tsc for the server/CLI, the web app and the UI tests
npm run lint        # biome (npm run format to fix)
npm run build       # builds the UI into dist/web, which npm start serves
```

Layout:

```
src/core/     card format: zod schemas, parser/writer, state transitions, queue ordering (shared)
src/server/   Hono API, registry, file access, watcher + live events (WebSocket), Sync
src/cli/      the preside command
src/web/      React UI
skills/       the Claude Code skill for agents
examples/     a demo project with sample cards (`preside demo` copies it)
test/         vitest suites; test/fixtures/ has the tests' own copy of the demo cards
```

How it fits together:

- Cards are plain files; president is never the only copy of anything. Status lives in the
  frontmatter. A write changes only the bytes of the fields whose values changed: everything else
  (comments, quoting, folded text, line endings, the body) is kept byte for byte. Writes go
  through a temp file that is flushed to disk, keeps the file's permissions, and is renamed over
  the card.
- Cards are addressed only by project name and card id; files are found by listing the project's
  `decisions/` folder, so the API can't be pointed at other paths. Symlinked cards, and a
  `decisions/` folder that points outside the project, are refused. The server refuses requests
  whose Host isn't localhost (DNS rebinding), and writes and live-event WebSockets whose Origin
  isn't the hub itself (scripts and curl must send `Origin: http://127.0.0.1:4747`).
- Every action must send the revision (a content hash) of the card the human last read, not the
  newest one the page has loaded. If the file changed since, the action is refused and the page
  lists what changed. Undo sends the revision its action returned, and restores the file only if
  it is still the file president wrote then (the same bytes written again by an agent count as
  a change). The server remembers the revisions it wrote; a page asks for a
  card with the revision it last read (`?since=`), and the answer says whether only president's
  own writes happened since, so a change made in another tab, even one this tab missed, is not
  blamed on an agent. That memory is kept nowhere but in the running hub: after the hub
  restarts, a change from another tab that this tab missed is reported as an agent's change.
- A watcher on every `decisions/` folder and on the registry pushes changes to the UI over a
  WebSocket (`/api/events`), one per tab, hidden or not. Browsers keep WebSockets out of the 6
  connections per host that HTTP requests share, so any number of tabs and windows can be live
  at once without holding up API calls. The indicator in the top bar shows the socket's state:
  Live, or Offline from the moment it closes. The hub sends a `ping` message every 25 s, and a
  page that hears nothing for 62.5 s (a hub that hangs without closing the socket: stopped, or
  stuck on a slow disk) closes the socket and shows Offline too. The page reconnects with
  backoff (0.5 s doubling to 3 s) and refetches everything when it is back. The handshake passes the same Host and
  Origin checks as writes, so another site can't open one.
- Sync (`src/server/sync.ts`) runs the steps in [card #0001](decisions/0001-sync-across-machines.md)
  ("How Sync works in git"), one project after another and never two at once in the same
  project. Each step is a spawned `git` with an argument list (no shell), run in the
  registered project folder without the inherited variables that point git at another
  repository (the ones `git rev-parse --local-env-vars` lists, such as `GIT_DIR`; your own
  `GIT_SSH_COMMAND` or `GIT_CONFIG_GLOBAL` are kept), `GIT_TERMINAL_PROMPT=0`, no askpass
  program and no terminal, and a timeout (60 s for fetch, pull and push, 30 s for the rest)
  after which git and whatever it started are stopped. It pushes exactly the commit it
  checked, to the branch `main` tracks (`git push <remote> <commit>:refs/heads/main`), never
  with a bare `git push`.
  `POST /api/sync` passes the same Host and Origin checks as every write. While a project's
  Sync runs, card actions there are refused (409 `syncing`), and a Sync waits for a card
  write already under way.
- State transitions live in `src/core/actions.ts`, shared by the API and the CLI. The
  per-card chat (asking, Teach me, More info, summaries) is `src/server/chat/` and
  `src/web/components/CardChat.tsx`.
