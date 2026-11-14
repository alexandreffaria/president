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

## 1. Simpler "Neither" (2026111459oa, `trim`)

[Card](../decisions/2026111459oa-chat-on-cards-scope.md). Asking, Teach me, More info and summaries
stay. What changes:

- **Ask for new options** starts the run at once, with no wait for the Undo notice to close.
  The "Sending when Undo closes" state goes.
- **Undo** while the run is going cancels it (stops the `claude` process) and writes nothing to
  the card. Your message stays in the agent's session; that is accepted (it may cost up to $1).
- **Other tabs** get no "hasn't started … Start now"; there is nothing waiting to start.
- This undoes [20261112160s](../decisions/20261112160s-undo-new-options-turn.md) and
  [20261112dfik](../decisions/20261112dfik-second-tab-during-wait.md): remove their code, tests
  and README text, and mark both rows in foundations.md as undone by 59oa.

Do this before splitting `CardView.tsx` and `chat/service.ts` (plan.md, section 4), since it
removes code both hold.

## 2. Cleanup (no card needed)

The detail and order are in [plan.md](plan.md):

- Agent context: a short `CLAUDE.md`, a shorter decision-cards skill.
- Refactors with no behaviour change: split `sync.ts`, `CardView.tsx`, `chat/service.ts`,
  `createApp` and the agent commands.
- Small extras: fewer highlight.js languages, exact toolchain versions.

## Not built, held by the freeze

- **Splitting a card into sub-questions** ([foundations](foundations.md#card-interactions-must-have)).
  Build it only once a real project's card needs it.
