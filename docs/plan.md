# Plan (from the 2026-11-14 reflection)

What we're working on now, kept up to date as items land. Tick an item (`[x]`) in the pull
request that does it, with the PR number. The direction calls are decision cards, all
answered on 2026-11-14. The unbuilt work, in short, is in [roadmap.md](roadmap.md).

## Where president is (2026-11-14)

- **Started** 2026-11-10 from the idea in `ideas/tj-video-transcript.txt`: a queue of open
  questions, decided fast, with agents applying the answers.
- **Now:** 16k lines of code and 17k of tests. 39 merged pull requests. A multi-project hub
  with Sync across machines, a per-card chat, a CLI for agents, tray icons for Linux and
  Windows, and CI on both.
- **Real use:** the core loop (queue → decide → `preside pending`/`applied` → Sync) works.
  It has been used for real on CellSignalMapper (12 cards, with notes that led to follow-up
  cards).
- **Mostly self-referential:** 56 of the 68 cards so far are president deciding about itself.
  You took the agent's pick on 55 of them, most in under half a minute.
- **Unused so far:** A/B cards (since 2026-11-11) and Withdrawn (since 2026-11-12) have no
  recorded use. The chat has been on main
  only since 2026-11-12 and "Neither" since 2026-11-13, and neither has a recorded use yet.
- **Not built:** splitting a card into sub-questions, which foundations lists, was never built.
- **Effort after the first day's build** (lines added in feature pull requests, roughly):
  about 20% went to the core loop, 40% to the chat and 40% to Sync and platform work.

## Decision cards (2026-11-14, all answered)

| Card | Question | Answer |
|---|---|---|
| [202611147ch5](../decisions/202611147ch5-what-next-for-president.md) | What should the next two weeks be? | `freeze`: bug fixes, this plan and these cards; new features only when CellSignalMapper or geode asks |
| [20261114509p](../decisions/20261114509p-which-president-questions-get-cards.md) | Which of president's own questions become cards? | `direction-only`: direction, UX, scope; mechanics listed in the PR |
| [2026111459oa](../decisions/2026111459oa-chat-on-cards-scope.md) | How much of the chat stays? | `trim`: new options start at once, Undo cancels them |
| [202611143v3q](../decisions/202611143v3q-windows-support.md) | How far does Windows support go? | `finish-windows`: `claude.cmd` too, chat tests on Windows CI (done, #44) |
| [20261114zuct](../decisions/20261114zuct-review-loop-stopping-rule.md) | When does a review loop stop? | `all`: every finding, nits included, fixed and re-reviewed |
| [20261114r0w8](../decisions/20261114r0w8-where-decisions-are-recorded.md) | Does the decisions table keep the reasons? | `one-line`: one line and a link per decision |
| [2026111411fs](../decisions/2026111411fs-who-is-president-for.md) | Only for you, or a package others install? | `personal`: public repo, no npm release, Windows = your workstation |

## Engineering, in order (sections 1-5 need no card; 6 applies the cards)

### 1. Test suite (do first; every review round pays for it)

- [x] Stop the `president-test-*` leak: close the ChatService (and wait for it to go idle)
  in `afterEach` of `test/web/chat.test.tsx` and `test/chat.test.ts`. Today a fake-claude
  run still going writes into the temp dir after it is removed. (#42)
- [x] Stop the `president-state-*` leak: the state dir's removal (`test/setup.ts:67`) runs
  only if the late-output `afterAll` check (:110) passes, and the gate fixtures fail it on
  purpose. Remove the dir either way. (#42)
- [x] Fix the Windows "only fetches…" flake (`test/sync-api.test.ts:300`): also wait until
  `shop` shows `remoteChanges: 1`, not only until some project has a fetch error. (#42)
- [x] Split `test/web/chat.test.tsx` (84 s of the suite's 88 s wall time) into 2–3 files.
  (#42: `chat-panel`, `chat-deciding` and `chat-gone-views`, sharing `chat-page.tsx`)
- [x] Move the shared test helpers (`until` ×6, `press` ×4, `FakeWebSocket` ×4, the web hub
  stub) into one harness. (#42: `until` in `test/helpers.ts`, the rest in
  `test/web/harness.ts`)
- [x] Where tests pin a whole user-facing sentence, assert the outcome or code instead,
  keeping one full-text check per message. (#42)
- [x] Re-review the comment-only change merged in #42 (close() docstring). It was merged
  without a re-review, so the next review round should cover it. (#43)

### 2. Agent context

- [ ] Add a short `CLAUDE.md` (under 300 words): layout, the check commands, "never branch
  in the main checkout (the hub runs from it)", where cards and docs live, and the 509p
  rule: for president, cards only for direction, UX and scope; mechanics are listed in the
  PR under "Decided without a card".
- [ ] Trim `skills/decision-cards/SKILL.md` from about 4k words toward 2k. Every agent
  session in every project loads it. Point to `docs/card-format.md` instead of repeating
  it, and move the rarely used parts ("New notes", "Changing a card") into a reference file
  the skill links to.
- [x] Update the stale parts of the Windows comments in `.github/workflows/ci.yml` (lines
  20-21 and 49-52); the chat-test exclusion itself goes in section 6. (#44)

### 3. Safety

- [x] Spawn `claude` by absolute path through `findExecutable`, as git is, on every OS.
  The chat runner spawned it by bare name in the project folder, so a `claude.exe`
  committed to a project (Windows), or an empty or relative PATH entry (Linux), would have
  run. (#44)
- [x] foundations.md still says "Repo | Private on GitHub"; it's public now. (#43)

### 4. Refactors (no behaviour change; section 6's chat trim, which cut the same code, is done)

- [ ] Split `src/server/sync.ts` (1.3k lines): `Repo` to `sync/repo.ts`, and `runSequence`
  (360 lines, 19 branches) into named checks, with `SyncService` in its own file.
- [ ] Split `src/web/views/CardView.tsx` (1.6k lines; unblocked by the chat trim). Make hooks
  for loading, actions and
  focus return, and move `ActionBar`, `DeferMenu`, `StatusNotice` and `BrokenCard` into
  `components/`.
- [ ] Split `src/server/chat/service.ts` (1.3k lines; unblocked by the chat trim): the run
  bookkeeping into one class, and new options and summaries into their own files.
- [ ] Split `createApp` in `src/server/app.ts` into route files.
- [ ] Move the agent-facing commands out of `src/cli/commands.ts`, and split `pending()` into
  collect, text and json.

### 5. Small extras

- [ ] Load only a few highlight.js languages (the web bundle is 635 kB, likely mostly highlight).
- [ ] Pin exact versions of the new toolchain (TypeScript 7, vite 8, vitest 5) in
  `package.json`.

### 6. What the 2026-11-14 cards decided

- [x] Slim the foundations table to one line per decision (20261114r0w8), and move
  `docs/roadmap.md` to `docs/archive/roadmap-2026-11.md` with a short new roadmap. (#43)
- [x] Record 20261114509p and 20261114zuct in foundations.md's "Engineering process". (#43)
- [x] README: drop the install notes meant for other people (2026111411fs). (#43)
- [x] Chat trim (2026111459oa): new options start at once and Undo cancels the run; the
  waiting and other-tab "Start now" code is gone. Section 4's `CardView.tsx` and
  `chat/service.ts` splits are now unblocked. (#45)
- [x] Windows chat (202611143v3q): on top of section 3's absolute-path spawn, find npm's
  `claude.cmd`, and run the chat tests on Windows CI. (#44)
- Freeze (202611147ch5): until 2026-11-28 nothing beyond this plan gets built, unless
  CellSignalMapper or geode asks for it.
