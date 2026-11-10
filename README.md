# president

A local web app where coding agents put **decision cards** in front of you.

You handle direction (product, UX, naming, research questions); agents handle implementation.
When an agent reaches a question that is yours to answer, it writes a card (a markdown file in
the project's `decisions/` folder) with the context, 2 to 4 concrete options, honest pros and
cons, and its recommendation. president collects the cards from all your projects into one
queue. You read, pick an option (or reject them all and say why), and move to the next card.
Agents then apply your decisions to the project's docs and code.

Background: [docs/foundations.md](docs/foundations.md). Card format: [docs/card-format.md](docs/card-format.md).

## Setup

Needs Node 24 or newer.

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

**Use `president`, not `npx president`, outside this repo.** An unrelated package called
`president` exists on npm, and `npx` would download and run it when the command isn't installed
locally. Inside this repo `npx president` runs the local copy.

### Install the agent skill

The skill in [skills/decision-cards/SKILL.md](skills/decision-cards/SKILL.md) teaches Claude Code
when and how to write cards, and how to act on your answers. Install it for all projects:

```sh
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/decision-cards" ~/.claude/skills/decision-cards
```

Because it's a symlink, pulling this repo updates the skill.

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
   | `u` | undo the last decision, deferral or "neither" (while its notice is shown) |
   | `?` | all shortcuts |

   Shortcuts never act while you are typing, while a button or link has focus (`Enter` then
   presses that button), or while the help is open.

   After you decide, president moves to the next card. Undo puts the card back exactly as it
   was, as long as nothing changed it since (an agent applying it, for example); after that,
   reopen it instead.

   Notes (`m`) reach agents through `president pending`, which lists notes they haven't read yet.

4. **Decisions** lists everything you decided, newest first, and whether an agent has applied it.

To try it with sample cards:

```sh
president add examples/demo-project
```

### CLI

```
president add <path> [--name <name>] [--create]   register a project
president list [--json]                           show registered projects
president remove <name-or-path>                   unregister (files are not touched)
president validate [path]                         check the cards in <path>/decisions, or one card file
president pending [path] [--json]                 what agents should act on: unapplied decisions,
                                                  rejected options, unread notes
president applied <card-file>                     mark a resolved card as applied
president seen <card-file>                        mark the human's notes on a card as read
president serve                                   start the hub (same as npm start)
```

The registry is `$XDG_CONFIG_HOME/president/projects.json` (default `~/.config/president/projects.json`).

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
src/server/   Hono API, registry, file access, watcher + server-sent events
src/cli/      the president command
src/web/      React UI
skills/       the Claude Code skill for agents
examples/     a demo project with sample cards (also used by the tests)
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
  whose Host isn't localhost (DNS rebinding) and writes whose Origin isn't the hub itself (scripts
  and curl must send `Origin: http://127.0.0.1:4747`).
- Every action must send the card's revision (a content hash). If an agent changed the file in the
  meantime, the action is refused and the card reloads, so you never decide on text you didn't
  see. Undo sends the revision its action returned, and restores the file only if it is still at
  that revision.
- A watcher on every `decisions/` folder and on the registry pushes changes to the UI over
  server-sent events.
- State transitions live in `src/core/actions.ts`, shared by the API and the CLI. The coming
  per-card chat ("ask", "teach me", "research") plugs in there and in
  `src/web/components/CardAssistant.tsx`.
