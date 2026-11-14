# president — foundations

president is a local web app where coding agents put **decision cards** in front of a human.
The human handles direction (research, psychology, UX, ideation) and the agents handle implementation.
It's inspired by TJ's language-design workflow (see `ideas/tj-video-transcript.txt`): a `docs/` folder of
settled decisions, a `questions/` folder of open ones, a queue that opens a fresh agent chat for each
question, A/B "flashcards", and "resolve → agent updates the docs → next card".

## Settled decisions

One line per decision. The card has the reasons, the options not chosen and the sources. The
first five were settled before president had cards. Work not built yet is in
[roadmap.md](roadmap.md); how the built work was planned is in
[archive/roadmap-2026-11.md](archive/roadmap-2026-11.md).

| Date | Decided | Card |
|---|---|---|
| 2026-11-10 | One hub for all projects; each project keeps its cards as files in its own repo. | |
| 2026-11-10 | Cards are plain, git-tracked files in each project repo. | |
| 2026-11-10 | The chat runs headless Claude Code (`claude -p`) in the card's project, resumed per card. | |
| 2026-11-10 | Dogfood: ship a bare version, then decide about president with president's cards. | |
| 2026-11-10 | The repo is on GitHub (public now); `package.json` stays `private`. | |
| 2026-11-11 | A Sync button commits, pulls and pushes card changes; the hub only fetches at start. | [#0001](../decisions/0001-sync-across-machines.md) |
| 2026-11-11 | The conversation panel sits beside the card (below it under about 1100 px). | [#0002](../decisions/0002-conversation-placement.md) |
| 2026-11-11 | A conversation's summary goes in the card; the full log stays on the machine. | [#0003](../decisions/0003-conversation-storage.md) |
| 2026-11-11 | The chat session only reads the project and researches the web. | [#0004](../decisions/0004-chat-session-permissions.md) |
| 2026-11-11 | Teach me gives a worked example comparing the options. | [#0005](../decisions/0005-teach-me-format.md) |
| 2026-11-11 | The project's working agent applies decisions, never the chat. | [#0006](../decisions/0006-who-applies-decisions.md) |
| 2026-11-11 | After "Neither", the hub starts the card's session to write new options. | [#0007](../decisions/0007-neither-try-again.md) |
| 2026-11-11 | The agent's pick is hidden until you ask (`r`). | [#0008](../decisions/0008-recommendation-placement.md) |
| 2026-11-11 | Cards that depend on an undecided card sink below the ready ones. | [#0009](../decisions/0009-dependent-cards-in-queue.md) |
| 2026-11-11 | The Neither panel can decide a card with your own answer. | [#0010](../decisions/0010-custom-answer-on-choice-cards.md) |
| 2026-11-11 | Notes are allowed on decided cards. | [#0011](../decisions/0011-notes-on-decided-cards.md) |
| 2026-11-11 | Undo restores the card byte for byte; an undone decision leaves an `undo` entry. | [#0012](../decisions/0012-undo-history.md) |
| 2026-11-11 | New card ids are the UTC date plus 4 random characters. | [#0013](../decisions/0013-card-ids.md) |
| 2026-11-11 | Agents retract a card with a `withdrawn` field; the hub lists it apart. | [#0014](../decisions/0014-withdrawn-status.md) |
| 2026-11-11 | The queue is ordered by priority, then oldest first. | [#0015](../decisions/0015-queue-order.md) |
| 2026-11-11 | Rename the command to a free npm name and reserve it with a placeholder. | [#0016](../decisions/0016-rename-the-cli.md) |
| 2026-11-11 | Deferring snoozes a card until a date (`d` = a week). | [#0017](../decisions/0017-deferred-resurfacing.md) |
| 2026-11-11 | The hub keeps its own copy of a conversation, outside git. | [#0018](../decisions/0018-show-earlier-conversation.md) |
| 2026-11-11 | Deciding with an open conversation first shows its summary to edit. | [#0019](../decisions/0019-decide-during-conversation.md) |
| 2026-11-11 | You can talk about a decided card; its summary is saved the same way. | [#0020](../decisions/0020-chat-on-decided-cards.md) |
| 2026-11-11 | The hub keeps a card's session id in its own store on each machine. | [#0021](../decisions/0021-session-id-per-machine.md) |
| 2026-11-11 | Your answers travel only with Sync, never in agents' pull requests. | [#0022](../decisions/0022-card-changes-in-apply-prs.md) |
| 2026-11-11 | A conversation summary is a `chat` feedback entry. | [#0023](../decisions/0023-chat-summary-feedback-type.md) |
| 2026-11-11 | Leaving an open conversation saves nothing; the hub reminds you. | [#0024](../decisions/0024-leaving-an-open-conversation.md) |
| 2026-11-12 | New cards are reviewed in the agent's worktree, then copied to the main folder; no PR carries cards. | [20261111st0c](../decisions/20261111st0c-agent-card-changes.md) |
| 2026-11-12 | The chat stays neutral about the pick until you reveal it. | [20261111mby8](../decisions/20261111mby8-chat-and-hidden-pick.md) |
| 2026-11-12 | A/B cards with the panel open use three columns. | [20261111sblu](../decisions/20261111sblu-side-panel-on-ab-cards.md) |
| 2026-11-12 | The hub keeps a conversation as long as its card exists (plus 30 days). | [202611114wet](../decisions/202611114wet-hub-copy-retention.md) |
| 2026-11-12 | Write summary works from the hub's copy after Claude Code deletes the session. | [20261111paot](../decisions/20261111paot-summary-after-claude-deletes.md) |
| 2026-11-12 | Leaving a conversation on a decided card reminds you too. | [202611111ky9](../decisions/202611111ky9-leaving-chat-on-decided-card.md) |
| 2026-11-12 | "Decide this as my answer" waits for the summary, like Decide. | [20261111is21](../decisions/20261111is21-own-answer-with-open-chat.md) |
| 2026-11-12 | The new-options run is a turn in the card's conversation, without the reminder. | [202611111gpm](../decisions/202611111gpm-new-options-run.md) |
| 2026-11-12 | Teach me with no options: one scenario and what any answer must handle. | [20261111fauj](../decisions/20261111fauj-teach-me-without-options.md) |
| 2026-11-12 | The command is `preside`, with a time-limited `president` alias. | [20261111dmvt](../decisions/20261111dmvt-command-name.md) |
| 2026-11-12 | Deferred cards with no date come back to the queue once. | [202611112hzh](../decisions/202611112hzh-deferred-without-date.md) |
| 2026-11-12 | Withdrawn cards are labelled in `pending` and `validate`; dependents stay sunk. | [202611116ff6](../decisions/202611116ff6-withdrawn-cards-elsewhere.md) |
| 2026-11-12 | A revealed pick stays shown until you leave the card. | [20261111nsaj](../decisions/20261111nsaj-revealed-pick-duration.md) |
| 2026-11-12 | Sync works only on projects that are their own repository. | [2026111209dq](../decisions/2026111209dq-sync-inside-bigger-repo.md) |
| 2026-11-12 | The change notice says when Sync brought the newer card. | [20261112xp4s](../decisions/20261112xp4s-notice-after-sync.md) |
| 2026-11-12 | Unsynced answers in a project Sync skips get their own line. | [20261112l9vh](../decisions/20261112l9vh-unsynced-count-skipped-projects.md) |
| 2026-11-12 | The new pick after "Neither" is hidden again, in the run's message and the chat. | [2026111272fu](../decisions/2026111272fu-new-pick-and-neutral-chat.md) |
| 2026-11-12 | The "Neither" message is sent only once Undo is gone. | [20261112160s](../decisions/20261112160s-undo-new-options-turn.md) |
| 2026-11-12 | A second tab can start the waiting run, and Undo is then refused. | [20261112dfik](../decisions/20261112dfik-second-tab-during-wait.md) |
| 2026-11-12 | No always-on server: a hub on each machine, moved by Sync. | [2026111276n0](../decisions/2026111276n0-hub-on-your-server.md) |
| 2026-11-12 | The Windows tray icon shows how many cards are waiting. | [20261112vzn8](../decisions/20261112vzn8-tray-icon-on-windows.md) |
| 2026-11-12 | A withdrawn card can't be deferred. | [20261112tiuq](../decisions/20261112tiuq-defer-withdrawn-card.md) |
| 2026-11-12 | A decided card an agent had withdrawn shows the reason in a quiet line. | [20261112jdyg](../decisions/20261112jdyg-decided-withdrawn-page.md) |
| 2026-11-12 | "Decide without summary" closes the conversation too. | [20261112hq3k](../decisions/20261112hq3k-decide-without-summary-reminder.md) |
| 2026-11-12 | More info gives the facts the card turns on, each backed by a quote. | [20261112e1ik](../decisions/20261112e1ik-more-info-answer.md) |
| 2026-11-12 | The project's agent fixes only what it knows is wrong in hub-written options. | [20261112nyu2](../decisions/20261112nyu2-agent-and-hub-written-options.md) |
| 2026-11-12 | After Ask for new options, the page moves to the next card. | [202611128a05](../decisions/202611128a05-stay-after-new-options.md) |
| 2026-11-12 | A "Neither" from another machine is left to that machine or the project's agent. | [20261112ah6a](../decisions/20261112ah6a-new-options-other-machine.md) |
| 2026-11-12 | On a card with no pick, `r` asks the chat for its view. | [20261112irpn](../decisions/20261112irpn-chat-on-card-without-pick.md) |
| 2026-11-12 | Your next message continues the session; New conversation starts fresh. | [20261112lvbu](../decisions/20261112lvbu-conversation-after-summary.md) |
| 2026-11-12 | Hiding the chat panel only hides it. | [20261112m6dx](../decisions/20261112m6dx-hiding-the-chat-panel.md) |
| 2026-11-13 | Cards with 10 or more options get a warning. | [20261113oew6](../decisions/20261113oew6-cap-options-at-9.md) |
| 2026-11-14 | Two-week feature freeze: bug fixes, the cleanup plan and these cards; new features only when CellSignalMapper or geode asks. | [202611147ch5](../decisions/202611147ch5-what-next-for-president.md) |
| 2026-11-14 | For president, cards only for direction, UX and scope; agents decide mechanics and list them in the PR. | [20261114509p](../decisions/20261114509p-which-president-questions-get-cards.md) |
| 2026-11-14 | Keep the chat; after "Neither" new options start at once and Undo cancels them (undoes 160s, dfik). | [2026111459oa](../decisions/2026111459oa-chat-on-cards-scope.md) |
| 2026-11-14 | Finish Windows: the hub finds npm's `claude.cmd`, and the chat tests run on Windows CI. | [202611143v3q](../decisions/202611143v3q-windows-support.md) |
| 2026-11-14 | A PR's review loop runs until every finding, nits included, is fixed and reviewed again. | [20261114zuct](../decisions/20261114zuct-review-loop-stopping-rule.md) |
| 2026-11-14 | One line per decision here, reasons in the card; the old roadmap is archived. | [20261114r0w8](../decisions/20261114r0w8-where-decisions-are-recorded.md) |
| 2026-11-14 | Only for the owner: public repo, no npm release, Windows only on the owner's workstation. | [2026111411fs](../decisions/2026111411fs-who-is-president-for.md) |

## Card interactions (must have)

On any card the human can:
- pick an option, or pick **A / B / neither** with a note (neither → the agent comes back with new options based on the note)
- **ask** a question / chat back and forth
- ask for **more info** / research (from primary sources, with quotes)
- ask to be **taught** the background before deciding
- **defer** it, or split it into sub-questions (splitting isn't built; the freeze, 202611147ch5, holds it until real use asks for it)

When a card is resolved, the project's working agent (not the card's chat session, see
[#0006](../decisions/0006-who-applies-decisions.md))
writes the decision into the project's docs and moves on.

## Engineering process

Every task is done by a fresh agent session on its own branch and ends in a PR. A separate fresh session
reviews the PR, and the loop repeats until **every** finding, nits included, is fixed and reviewed again
([20261114zuct](../decisions/20261114zuct-review-loop-stopping-rule.md)). Only then is it merged.
Nobody reads the plumbing by hand, so review is the quality gate.

Decision cards are the exception ([20261111st0c](../decisions/20261111st0c-agent-card-changes.md)): no PR
carries card files. A new card is reviewed before it reaches the main folder (in the agent's worktree, or a scratch folder for an agent in the main folder itself): a fresh session reviews the draft, and the
loop repeats until nothing should-fix is left; then the agent copies it into the main folder, where the human
sees it at once (`skills/decision-cards/SKILL.md`, *Writing a card*). A task that only writes cards ends there,
with no PR.

For president itself, cards are only for direction, UX and scope; the agent decides edge cases and
mechanics and lists them in the PR under "Decided without a card"
([20261114509p](../decisions/20261114509p-which-president-questions-get-cards.md)).
