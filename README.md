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

### Install the `president` command

Agents use the `president` command to register projects and check their cards. Put it on your
PATH by linking the repo's script (no build needed; Node 24 runs the TypeScript directly):

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/bin/president.js" ~/.local/bin/president   # make sure ~/.local/bin is on PATH
president help
```

(`npm link` works too if your npm prefix is writable.)

**Use `president`, not `npx president`, outside this repo.** When a command isn't installed
locally, `npx` looks for an npm package with that name, and an unrelated package called
`president` exists on npm. Today that package has no command, so `npx president` only fails with
`could not determine executable to run`. But if a future release of it adds a command,
`npx president` would download and run it, without asking when there is no terminal
(as for an agent). Inside this repo `npx president` runs the local copy.

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
   president add ~/projects/my-app --create     # --create makes my-app/decisions/ if missing
   ```

   You can also add and remove projects on the **Projects** page.

2. Work with your agent as usual. When it hits a decision for you, it writes
   `decisions/0007-some-question.md`. The card shows up in the queue right away, no reload needed.

3. Go through the **Queue**. On a card:

   | Key | Action |
   |---|---|
   | `1`–`9` (`a`/`b` on A/B cards) | select an option, then `Enter` to decide (optionally type why first) |
   | `n` | neither: reject all options with a note; an agent writes new ones |
   | `m` | add a note without deciding |
   | `d` | defer |
   | `j` / `k` | next / previous card |
   | `u` | undo the last action on a card: a decision, deferral, "neither", note or reopen (while its notice is shown); an undone note or "neither" comes back in its panel |
   | `?` | all shortcuts |

   Shortcuts never act while you are typing or while the help is open. `Enter` and `Space` on a
   focused button or link press that control instead. While the Neither or Note panel is open,
   only `Esc` works (it closes the panel). What you type on a card and haven't sent (a note, a
   "why", your own answer) is kept until you send it, even if you close the panel or leave the
   card, and deferring (`d` or the Defer button) is refused while there is any.

   If an agent changes a card while you have it open, president shows what changed and refuses
   to send anything until you press **I've read it**, so you never decide on text you didn't see.

   After you decide, president moves to the next card. Undo puts the card back exactly as it
   was, as long as nothing changed it since (an agent applying it, for example); after that,
   reopen it instead. What you wrote with it (your "why", your answer, the Neither text) comes
   back as a draft, so you can fix it and send it again. An undone decision also leaves an
   `undo` entry in the card's history, so an agent that already saw it knows to revert its work.

   Notes (`m`) reach agents through `president pending`, which lists notes they haven't read yet.
   An agent marks a card handled with a token from `pending` that records what it was shown, so
   a note you add, or a decision you change, while it works is never marked as read or applied
   by mistake.

4. **Decisions** lists everything you decided, newest first, and whether an agent has applied it.

To try it with sample cards:

```sh
president demo        # copies examples/demo-project to a temporary folder and registers the copy
```

Work on the copy, not on `examples/demo-project` itself: deciding a card rewrites its file. Give
a folder (`president demo ~/president-demo`) to keep the copy around, and `president remove demo`
when you are done.

### CLI

```
president add <path> [--name <name>] [--create]   register a project
president list [--json]                           show registered projects
president remove <name-or-path>                   unregister (files are not touched)
president validate [path]                         check the cards in <path>/decisions, or one card file
president pending [path] [--json]                 what agents should act on: unapplied decisions,
                                                  rejected options, unread notes; each card ends
                                                  with the `done:` command to run once handled
president applied <card-file> --token <token>     mark a resolved card as applied
president seen <card-file> --token <token>        mark the human's feedback on a card as read
president update <card-file> <new-version-file>  replace an undecided card with an agent's rewrite,
                                                  only if the human changed nothing since the agent
                                                  read it
president demo [path] [--name <name>]             copy the sample project and register the copy
president serve                                   start the hub (same as npm start)
```

A project is named after its folder unless `--name` says otherwise; when that name is taken, `add`
uses `<name>-2`, `<name>-3`... and says so. The registry is a folder with one file per project,
`$XDG_CONFIG_HOME/president/projects/<name>.json` (default `~/.config/president/projects/`),
holding the project's path. There is no lock: `add` creates its file exclusively (a temp file
hard-linked into place), so agents that run `president add` at the same time all get
registered, each under its own name. If two `add`s of the same folder race, the folder is still
listed once, under the name that sorts first, and the duplicate file is removed. A
`projects.json` from an earlier version is moved into the folder the first time president runs
(it is kept as `projects.json.migrated`).

A project is its folder's path. If you move a project, run `president remove <name>` and then
`president add <new path>`: president doesn't follow the move, and a different repository later
created at the old path would be taken for the old project. `president list` and the Projects
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
src/server/   Hono API, registry, file access, watcher + live events (WebSocket)
src/cli/      the president command
src/web/      React UI
skills/       the Claude Code skill for agents
examples/     a demo project with sample cards (`president demo` copies it)
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
- State transitions live in `src/core/actions.ts`, shared by the API and the CLI. The coming
  per-card chat ("ask", "teach me", "research") plugs in there and in
  `src/web/components/CardAssistant.tsx`.
