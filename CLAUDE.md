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
- `tray`: the tray icons (`linux`, `windows`).
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
and syncs from it. Work in a git worktree.

## Cards and docs

- Cards live in the main checkout's `decisions/` (see the decision-cards skill). Never
  commit them in a pull request; Sync carries them.
- `docs/foundations.md`: settled decisions.
- `docs/plan.md`: the current tracker. Tick an item in the PR that does it.
- `docs/roadmap.md`: unbuilt work.
- `docs/card-format.md`: the card format.

## Which questions get cards (20261114509p)

For president itself, write decision cards only for direction, UX and scope. Decide
mechanics and edge cases yourself, and list them in the PR body under
"Decided without a card".
