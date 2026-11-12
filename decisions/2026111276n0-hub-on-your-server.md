---
id: "2026111276n0"
title: Should the hub move to your always-on server, and if so, how much of president should move with it?
status: resolved
kind: choice
priority: normal
created: 2026-11-12T16:44:18Z
created_by: claude (orchestrator)
tags: [hosting, server, multi-machine, sync, architecture, security]
depends_on: ["0001", "0003", "0004", "0018", "0021", "0022", "0024", "20261111st0c", "2026111209dq", "20261112l9vh", "20261112xp4s", "202611114wet"]
recommendation:
  option: server-hub
  why: >-
    It gives you the half of what you asked for that needs no change for agents: one always-on
    queue you answer from any machine, even with the desktop off. It changes nothing for agents
    or the skill and amends #0001 only for the server's own copies; its two pull requests are
    two of server-direct's three, so it is a reversible first step that tests the server and
    the login before agents depend on them. Accepted: a card an agent writes after you leave a
    machine waits until you press Sync there (with many machines, one Sync each), and your
    answer reaches the agent only after Sync there too; a server hub reachable from outside, or on
    a private network, that holds every project and can push to it; anyone with your login can
    decide cards that agents then carry out; the server's small commits on main, and its sync
    conflicts happening with nobody watching. Pick server-direct (over SSH) instead if cards
    written while you're away should reach you without going back to that machine; server-git
    if agents must keep working when the server is down; local if you mostly work on one
    machine at a time or the server isn't reliably up.
options:
  - id: local
    title: Keep a hub on each machine, as today
    summary: Nothing changes; each machine runs its own hub on its own folders, and Sync, pressed by you, moves cards and answers through git.
    pros:
      - Nothing to build, host, secure or keep running; nothing about president is reachable from outside your machines
      - Agents and the hub work offline, and an agent's card is in that machine's queue the moment it is copied in
      - Every decided card, the skill and the roadmap stay as they are
    cons:
      - Answers given on one machine reach the others only after you press Sync there and on the other machine; a project Sync skips needs a hand commit
      - "A conversation (E) exists only on the machine where you had it (#0021, #0018, #0024)"
      - You can only answer on a machine that has the project checked out and a hub running
      - Can be revisited later, but moving costs more once E's per-machine stores hold conversations
  - id: server-hub
    title: Add an always-on hub on your server; everything else as today
    summary: The server becomes one more machine with a hub, with its own copy of each project that it syncs by itself; agents keep working through the main folder on their own machine.
    pros:
      - One queue you can open from any machine, 24/7, without that machine having the project checked out
      - "Nothing changes for agents, the skill or Sync on your machines (it amends #0001 only for the server's own copies); local hubs keep working, also when the server is down"
      - The least server-side code, and all of it is reused if you later pick server-git or server-direct
      - Conversations you have on the server's hub are all in one place, if E can run there (not checked yet)
    cons:
      - Gives only the answering half of "everyone can write to it"; a card an agent writes after you leave a machine waits until you press Sync there, and your answer reaches that agent only after Sync there too; a monorepo project (09dq) isn't on the server at all; you answer it on a local hub, as today
      - The server holds every project and can push to it, its hub needs a login or a private network, and anyone with your login can decide cards that agents then carry out
      - Its automatic sync adds small commits on main, each of which can start CI or a deploy; a protected main branch needs an exception for the server
      - A card answered on the server and on a laptop before either synced conflicts, and on the server nobody is watching when it does
  - id: server-git
    title: Hub on the server, git is where agents meet it
    summary: As server-hub, but agents stop using a main folder; they push each card and each mark straight to the project's main branch, and read your answers from it.
    pros:
      - Cards reach you about a minute after an agent pushes, and answers reach an agent about a minute after you give them, with no Sync to press anywhere
      - An agent never needs the server to be up, only the git host (GitHub); agents need no new password for president
      - One queue and one set of conversations (if E can run on the server)
    cons:
      - Every card an agent writes or marks is its own commit on main; each can start CI or a deploy, and a protected main branch needs an exception for every agent and the server
      - Agents need push rights to main, and the server holds every project and can push to it
      - Anyone with your login can decide cards that agents then carry out in every project
      - A new git-based mode for every agent command; overturns how agents deliver cards (#0022, 20261111st0c) and turns Sync (#0001) into the server's automatic job
  - id: server-direct
    title: Hub on the server is the one copy; agents reach it directly
    summary: The server keeps a full copy of each project, the cards live in it, and agents on every machine read and write them there (over SSH, or HTTPS with a token); the server commits the cards to main on a schedule as the record.
    pros:
      - Instant both ways, from any machine that can reach the server; no Sync to press anywhere
      - "One hub, one set of conversations and session ids, so the per-machine limits of #0021, #0018 and #0024 go away (if E can run on the server)"
      - The card format, the writer, the queue and the checks are reused as they are; over SSH even the agent commands are reused
    cons:
      - An agent can't write or read a card when it can't reach the server (offline, server down)
      - Anyone with your login can decide cards that agents then carry out in every project; an agent's SSH key or token can put cards in your queue
      - Overturns Sync (#0001 and its follow-ups), the skill's main-folder rules (#0022, 20261111st0c) and the foundation "plain files in each project repo"; the largest change of direction
      - Its scheduled commits on main can start CI or a deploy, as in server-hub
      - Over HTTPS, every agent command needs a mode that talks to the server, and every machine needs a token
resolution:
  choice: local
  resolved_at: 2026-11-12T17:00:01Z
---

## Context

**What you said.** "This could be a good idea to just live in my server, so everyone can write
to it and read from it, server alive 24/7." Asked who everyone is: "just me, many machines,
lots of projects". So: one human answering, agents on several of your machines, many
projects, one always-on hub on your own server.

This card asks how much moves to the server: nothing, just the hub, or also the place agents
deliver cards to (through git, or straight to the server). Details are left for later cards
(listed at the end). Nothing being built now depends on the answer, so it isn't urgent; it
should be settled before E (the per-card chat) is built, because E's per-machine stores are
what changes most.

**At a glance.** "Sync" means the hub's Sync button on the machine where the agent works.

| | Where you answer | An agent's card reaches you | Your answer reaches the agent | Server down | Reachable from outside | Agent-side change | Rough size |
|---|---|---|---|---|---|---|---|
| local | a machine with the project and a hub | after Sync there and here | after Sync here and there | no server | nothing | none | none |
| server-hub | the server, from any machine (or a local hub) | after Sync, then about a minute | about a minute, then Sync | local hubs still work | the server's hub | none | about 2 PRs |
| server-git | the server, from any machine | about a minute | about a minute | agents keep working; you answer only on a local hub, if you kept one | the server's hub | new mode for every command | 3 to 5 PRs |
| server-direct | the server, from any machine | at once | at once | agents and you stop | the hub, plus agent access | SSH: small; HTTPS: new mode and tokens | 3 (SSH) to 6 (HTTPS) PRs |

A **token** below means a password for one machine's agents, which you can revoke.

**How president works today, and where it assumes one machine.**

- **Cards are files in each project's `decisions/` folder** on the local disk. The hub knows
  your projects as local folder paths, and on this machine one project is registered:
  president.
- **The hub only answers this machine.** It listens on `127.0.0.1` port 4747, refuses any
  request not addressed to `127.0.0.1`/`localhost`, and requires every write to come from a
  page served by the hub itself, at an `http://` address. There is no login: being on the
  machine is the only access control.
- **Sync** (#0001, and 2026111209dq, 20261112xp4s, 20261112l9vh) runs git in your real
  project folders, the same ones agents work in. That is why it runs only when you press it
  and has so many checks (for example "Not now: an agent in shop has commits it hasn't
  pushed"). It skips a project that isn't the top folder of its own repository (09dq). So far
  only this machine has used Sync, so the multi-machine pain is mostly ahead.
- **Agents work through the main folder.** They read and write card files on disk and never
  talk to the hub. A new card is drafted, reviewed, then copied into the project's main
  folder (20261111st0c), and no pull request ever carries a card file (#0022).
- **E isn't built yet.** As decided, it runs Claude Code in the card's project folder on the
  machine with the hub (#0004) and keeps the session id (#0021), its own copy of the
  conversation (#0018, 202611114wet) and the "not summarized" reminders (#0024) on that
  machine; only its summary travels, with Sync.
- **Being built now:** C (PR #21) and D (PR #20); neither depends on where the hub runs.

**Cloud sessions (an assumption).** You didn't mention Claude Code sessions running in the
cloud. If you use them: under today's rules they have no main folder of yours to put a card
in, so neither local nor server-hub lets them give you a card; server-git would, if they can
push to main; server-direct would, over HTTPS with a token. My understanding, not checked,
is that a cloud session can't join a private network (Tailscale, WireGuard) and may need your
server's address allowed in its network settings. If you don't use them, they don't count
for any option.

**The ordinary day used below:** an agent on the desktop works on `shop`, and you answer
from the laptop in the evening.

## Option local: Keep a hub on each machine, as today

**Your day.** The desktop agent copies its card into `~/projects/shop/decisions/` on the
desktop; the desktop's hub shows it at once. On the laptop in the evening the card isn't there
until you have pressed Sync on the desktop and then on the laptop. You answer; the desktop
agent sees it after you press Sync on the laptop and again on the desktop (or a `git pull`
there). A chat you had on the laptop is only on the laptop.

**Cheap middle grounds, no new architecture:**

- Reach one machine's hub from another with an SSH tunnel, using a different local port if
  the laptop runs its own hub: `ssh -L 4748:127.0.0.1:4747 desktop`, then open
  `http://127.0.0.1:4748`. The hub accepts it with no code change. The desktop has to be on.
- Run Sync on a timer: that was #0001's `batched`, not chosen because git would run in the
  folders agents work in at moments nobody chose.

Overturns nothing. You can pick a server option later; the longer E has been in use, the more
conversations there are to move.

## Option server-hub: Add an always-on hub on your server; everything else as today

**Your day.** The desktop agent copies its card into the desktop's `shop` folder, as today.
When you press Sync on the desktop, the card goes to GitHub, and within a minute the server's
hub pulls it; a card the agent writes after you leave the desktop waits until you press Sync
there. In the evening you open the server's hub from the laptop (in a browser; the page
isn't designed for phones yet), log in and answer. A minute later the server has pushed your
answer; the desktop agent sees it after the next Sync or `git pull` on the desktop. A chat you
have on the server's hub is there from any machine (if E can run there, below).

**What changes:**

- **The server keeps its own copy of each project**, which nobody works in. Because no agent
  can be in the middle of something there, its hub can sync by itself after each answer or
  every few minutes, without Sync's checks.
- **Nothing changes for agents** or for your machines: same commands, same skill, same Sync.
- **E runs on the server** for the conversations you have there, in its copy of the project
  (which has what is on main, not an agent's branch in progress). This needs Claude Code
  signed in there with your subscription; that this works headless, and is within your plan's
  terms, isn't checked yet.
- **Security.** The hub needs a login and HTTPS, or to be reachable only on a private network.
  The server can push to every project. Anyone with your login (or the server) can decide
  cards, which agents then carry out in every project (#0006: the working agent applies
  decisions), so this is the main reason to prefer a private network or a strong login.
- **Before switching:** none needed; your machines keep their own changes until their next
  Sync.

**Decided cards it changes:** it amends #0001 for the server's own copies: their automatic
sync is #0001's `auto` or `batched` there. #0001's objection to git in folders agents work in
doesn't apply, but two others do: one commit per answer, and a conflict or failed push found
later by whoever looks. 09dq stands: the server keeps no copy of a monorepo project, and Sync
on the agent's machine still skips it. xp4s's notice applies to the server's automatic sync.
#0004, #0021, #0018, #0024 and 202611114wet stand, with the server as one more machine.

**Rough size:** about 2 pull requests: projects registered by git address with an automatic
sync, and a login with HTTPS (mostly a reverse proxy in front of the hub), plus docs.

## Option server-git: Hub on the server, git is where agents meet it

**Your day.** The desktop agent runs a new `preside send <card>`, which puts just that card on
`shop`'s main branch on GitHub without touching the desktop's folders. Within a minute the
server's hub has it. You answer from the laptop; the server pushes it a minute later, and the
desktop agent's next `preside pending` reads main on GitHub and sees it. Its "applied" mark is
another small commit on main.

**What changes:**

- **Everything in server-hub**, plus:
- **Agents read and write cards on the main branch on GitHub, not in a folder.** Each card,
  each "seen" and each "applied" is its own commit on main. When two pushes meet, one retries.
- **Your machines no longer need Sync** for cards: cards go straight to main, and a
  `git pull` brings them to your folders as a record.
- **Security.** As server-hub, and every agent needs push rights to main. Anyone with your
  login can decide cards that agents then carry out in every project.
- **Before switching:** press Sync (or commit by hand) on every machine, so no answer or new
  card is left in a main folder when agents stop using it.

**Decided cards it changes:** #0001 with 2026111209dq, 20261112l9vh and 20261112xp4s (Sync
becomes the server's automatic job); #0022 and 20261111st0c (agents push cards and marks to
main instead of copying them into the main folder; the skill changes); #0021, #0018, #0024,
202611114wet (their "only on this machine" limits mostly go away, since you answer on one
machine). #0004 stands, on the server.

**Rough size:** 3 to 5 pull requests: server-hub's two, plus a git-based mode for every agent
command, the skill and the docs.

## Option server-direct: Hub on the server is the one copy; agents reach it directly

**Your day.** The desktop agent sends its card to the server, and it is in your queue at once.
You answer from the laptop; the desktop agent's next `preside pending` asks the server and
sees the answer at once, and its "applied" goes to the server too. Every so often the server
commits the changed cards to each project's main branch, so `git pull` still brings them to
your folders as a record. A chat you start on the laptop is there when you open the card on
the desktop.

**What changes:**

- **Everything in server-hub**, except that the server's copy of each project is now where
  cards live: its `decisions/` folder is the one agents and you both use. No database: the
  card files, writer, queue and checks are reused as they are.
- **How agents reach it**, two forms:
  - **SSH:** agents run today's commands on the server through SSH, with the SSH keys your
    machines already have. No tokens and almost no new code for agents; the skill changes.
    An agent's key opens a shell on the server unless it is limited to `preside` only, which
    is the setup to aim for.
  - **HTTPS:** every `preside` command gets a mode that sends the request to the server, and
    each machine gets a token. Needed for machines that can't use SSH to the server.
- **No Sync button**: answers are on the server the moment you give them.
- **Security.** As server-hub, with agent access on top. Anyone with your login can decide
  cards that agents then carry out in every project. An agent's key or token can't decide, but
  can put cards in your queue (a convincing fake card is a way to steer you) and mark cards
  applied, until you revoke it.
- **Before switching:** a one-time move of every project's cards, from every machine, into the
  server's copies.

**Decided cards it changes:** everything server-git changes, plus: Sync (#0001, 09dq, l9vh,
xp4s) is replaced, not moved; the foundation "Card storage: plain files in each project repo,
git-tracked", whose reason is that "any agent can write them without president running",
becomes "files on the server, committed into each repo"; #0022 and 20261111st0c become
"agents send cards to the server"; the skill's main-folder and worktree rules mostly go away.

**Rough size:** about 3 pull requests over SSH (server-hub's two, plus the skill and the
docs), 4 to 6 over HTTPS (plus the client mode and tokens), and the move.

## Questions this would leave (for later cards)

- Private network only, or a public HTTPS address? (Cloud sessions, if you use them, likely
  need the second.)
- How often the server commits to main, and whether some projects should be left out because
  of CI, deploys or a protected main branch.
- For server-direct: SSH, HTTPS, or both; and what an agent does when the server is
  unreachable (keep the card and send it later, or stop and say so).
- What the server does, and how you hear of it, when its automatic sync conflicts or fails.
- Whether E runs headless on the server with your subscription, within your plan's terms
  (every server option that runs E there).
- Whether your local hubs stay as an offline fallback, and which time zone C's snooze dates
  use when the hub's clock is the server's.

## Technical detail (for the implementer)

- Loopback-only today: `export const HOST = "127.0.0.1"` and `DEFAULT_PORT = 4747` in
  `src/server/server.ts`; `app.use("*", localOnly())` in `src/server/app.ts`; `localOnly()`
  (`src/server/security.ts`) refuses a non-loopback Host (DNS-rebinding guard) and
  `isOrigin()` accepts only `url.protocol === "http:"`, so a hub behind HTTPS (a reverse proxy
  such as Caddy) fails every write until that changes. Live events use a WebSocket through the
  same middleware.
- An SSH tunnel keeps Host and Origin at `127.0.0.1:<local port>` (4747 or 4748) and passes
  `localOnly()` as is; Tailscale or a domain name doesn't.
- Registry: `src/server/registry.ts` stores `{ "path": ... }` per project in
  `~/.config/president/projects/<name>.json`; the watcher is `src/server/watcher.ts`. All
  server options need entries keyed by a clone URL (or a server folder).
- Sync (`src/server/sync.ts`, about 1,200 lines) exists mostly to protect folders agents work
  in. On server-owned clones, `commit --only -- decisions/`, `pull --rebase` and `push`
  without the agent-protection checks is enough; conflicts come only from another writer of
  the same card file. Deploy keys (SSH) per repository are safer than tokens in remote URLs.
- Agent commands (`pending`, `applied`, `seen`, `update`, `validate` in `src/cli/commands.ts`)
  read and write files directly and don't contact the hub. server-git would read
  `git show origin/main:decisions/<file>` after a fetch, and write each card as a one-file
  commit on top of `origin/main` with a temporary index (`GIT_INDEX_FILE`, `git update-index`,
  `git commit-tree`, `git push origin <sha>:refs/heads/main`), so the agent's checkout is never
  touched; a rejected push means re-fetch and retry, which also replaces `update`'s "card
  changed since you read it" guard. server-direct over SSH: `ssh server preside pending
  /srv/president/shop`, `scp` a reviewed draft into the server's `decisions/`, then
  `ssh server preside validate ...`; the `done:` lines already print absolute paths (the
  server's); limit agent keys with a forced command in `authorized_keys`. Over HTTPS: an API
  that calls the existing code in `src/server/cards.ts`.
- E on a server: `--restricted` (#0004) confines the session's file tools to the project
  folder, so keys in `~/.ssh` or a credential store are out of its reach; the exposure is a
  token written into a clone's `.git/config` remote URL, which deploy keys avoid. `claude
  setup-token` ("Set up a long-lived authentication token", Claude Code 2.1.302) exists;
  that it lets `claude -p` on a headless server use your subscription, and that running
  sessions there fits your plan's usage terms, is unverified. The roadmap's "Four
  per-machine stores, one folder" become one store under server-git and server-direct.
- C (PR #21) and D (PR #20) don't touch the server's host, registry, Sync or security code.

## Sources

- Your messages in this session: "this could be a good idea to just live in my server, so
  everyone can write to it and read from it, server alive 24/7", and, asked who everyone is,
  "just me, many machines, lots of projects".
- `docs/foundations.md`: "Card storage | Plain files in each project repo, git-tracked. |
  Decisions live next to the code they shape, and any agent can write them without president
  running."; "Syncing answers across machines" (#0001); "Where the hub keeps a card's session
  id" (#0021: "A conversation exists only on the machine that had it").
- `docs/roadmap.md`: B (Sync), E ("Where the conversation lives"), the `--restricted` row
  ("Confines the file tools to the project folder"), Cross-card consequences ("Four
  per-machine stores, one folder").
- Decided cards: #0001 (`batched` not chosen), #0006 (the working agent applies decisions),
  #0021, #0022, 20261111st0c.
- Code on `main`: `src/server/server.ts`, `src/server/security.ts` ("president only listens on
  127.0.0.1, but a web page in the human's browser can still send requests to it"),
  `src/server/app.ts`, `src/server/registry.ts`, `src/server/sync.ts` ("Not now: an agent in
  ${name} has commits it hasn't pushed"), `src/cli/commands.ts`.
- Branches `feat/queue-card-ux-c` (C, PR #21) and `feat/card-format-d` (D, PR #20):
  `git diff --stat main...<branch>`.
- `git log`: the only Sync commit so far is "decisions from thinkpad: ..." (`80394a6`), made on
  this machine, so Sync between machines hasn't been used yet.
- Not checked: what cloud sessions can reach (private networks, allowed domains), and whether
  they may push to main.
