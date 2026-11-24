# president

A local web app where coding agents put decision cards in front of a human. See README.md.

## Layout

- `src/cli`: the `preside` CLI (agents' commands, tray install).
- `src/core`: the card model, parser and writer, shared by the CLI, hub and web UI.
- `src/server`: the Node hub (Hono): projects, cards, Sync, the card chat.
- `src/web`: the React web UI.
- `skills/decision-cards`: the skill agents load to write and apply cards.
- `docs`: the project docs (below).
- `test`: Vitest tests; `test/web` for the UI.
- `tray`: the tray helper's source (`linux`: TypeScript, `windows`: C#).
- `bin`: `preside.js`, the CLI entry point.
- `decisions`: president's own decision cards.

## Checks

CI (`.github/workflows/ci.yml`, Ubuntu and Windows) runs, in order:

```
npm ci
npm run typecheck
npm run lint
node bin/preside.js validate .
npm test
npm run build
```

On Windows it also installs the tray helper and runs its self-test.

## Where to work

Never branch or edit in the main checkout, the one registered with the hub: the hub runs
from it, and Sync pulls main into it. Work in a git worktree.

One exception, for the orchestrating session only: Sync never commits, so an answer to a
card that is already on main sits uncommitted in the main checkout, and Sync says "Not now"
once a merged PR changes that card. Before applying such answers, the orchestrating session
commits them straight on main there and pushes: only `decisions/` card files whose change is
the human's answer or feedback from the hub, by path, with a message like "decisions:
answers to <ids>". Never edit or commit any other file there.

## Cards and docs

- A card lives on the branch whose work it unblocks: write it in your worktree's
  `decisions/` (drafted elsewhere first, see the decision-cards skill), commit it and the
  answer on your branch, and the pull request carries them. The hub reads every worktree.
- `docs/foundations.md`: settled decisions.
- `docs/plan.md`: the current tracker. Tick an item in the PR that does it.
- `docs/roadmap.md`: unbuilt work.
- `docs/card-format.md`: the card format.

## Which questions get cards (20261114509p)

For president itself, write decision cards only for direction, UX and scope. Decide
mechanics and edge cases yourself, and list them in the PR body under
"Decided without a card".
