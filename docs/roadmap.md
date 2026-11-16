# president — roadmap

Only work that isn't built yet. Decisions are in [foundations.md](foundations.md#settled-decisions);
the step-by-step checklist is [plan.md](plan.md). The old roadmap, all of it built, is in
[archive/roadmap-2026-11.md](archive/roadmap-2026-11.md).

Build what is written here; don't re-decide it. Direction, UX and scope questions get a card;
edge cases and mechanics are yours, listed in the PR under "Decided without a card"
([20261114509p](../decisions/20261114509p-which-president-questions-get-cards.md)).

## The freeze (until 2026-11-28)

For two weeks only bug fixes, the cleanup in plan.md and the items below are built
([202611147ch5](../decisions/202611147ch5-what-next-for-president.md)). A new feature goes in only
when real use on CellSignalMapper or geode asks for one. president is for its owner only: no npm
release, and Windows means the owner's workstation
([2026111411fs](../decisions/2026111411fs-who-is-president-for.md)).

## Cleanup (no card needed)

The 2026-11-14 cleanup is done ([plan.md](plan.md) section 4).

## Cards on the working branch

Decided in chat on 2026-11-16 (see [foundations](foundations.md#settled-decisions)); real use on
Blendeck asked for it, so the freeze doesn't hold it. Agents work on feature branches, often by
switching the project folder itself, and Sync only runs on main, so answers waited for hours.
A card exists to unblock one branch's work, so it lives and travels with that branch:

- **Agents** write a card in their own checkout's `decisions/` (worktree or folder, whichever
  holds the branch), commit it on that branch, apply the answer there and commit that too. The
  PR carries the card with the docs and code it decided, and merging puts it on main.
- **The hub** shows the cards of every checkout of a registered project (the folder and each
  `git worktree list` entry), says which branch each card is on, and writes your answer into the
  file in the checkout that holds it. The same card in several checkouts is shown once.
- **`preside`** (`pending`, `applied`, `seen`, `update`, `validate`) works in the checkout it runs
  in; the "use the main folder" rule and its worktree warning go.
- **Docs and skill**: `skills/decision-cards` (both files), `CLAUDE.md`, `README.md` and the
  engineering-process paragraph in foundations drop "no PR carries cards" and "Sync carries them".

Write cards for these before building them (direction and scope, not mechanics):

1. Answering from another machine: a branch's cards are on the machine whose checkout holds the
   branch. Is answering there enough, or must the other machine's hub show and answer them too
   (read pushed branches, and push answers onto the agent's branch)?
2. What Sync becomes: removed, kept only for cards that belong to no branch, or something else.

## Not built, held by the freeze

- **Splitting a card into sub-questions** ([foundations](foundations.md#card-interactions-must-have)).
  Build it only once a real project's card needs it.
