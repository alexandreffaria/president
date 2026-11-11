# president — foundations

president is a local web app where coding agents put **decision cards** in front of a human.
The human handles direction (research, psychology, UX, ideation) and the agents handle implementation.
It's inspired by TJ's language-design workflow (see `ideas/tj-video-transcript.txt`): a `docs/` folder of
settled decisions, a `questions/` folder of open ones, a queue that opens a fresh agent chat for each
question, A/B "flashcards", and "resolve → agent updates the docs → next card".

## Settled decisions

The first five were settled on 2026-11-10, before president had cards. Later ones were decided
through cards in [`decisions/`](../decisions/) and link the card, which has the full context,
the options that were not chosen and the sources. The work each one implies is in
[roadmap.md](roadmap.md).

| Decision | Choice | Why | Card |
|---|---|---|---|
| Scope | **One hub for all projects.** Each project keeps its cards as files in its own repo; one president app shows the queue across every registered project. | The user works on many projects at once and wants one place to go through decisions. | |
| Card storage | Plain files in each project repo, git-tracked. | Decisions live next to the code they shape, and any agent can write them without president running. | |
| Chat engine | **Headless Claude Code sessions** (`claude -p`) started in the card's project directory, resumed per card. | Uses the user's existing Claude Code login; the session can read the code and do research. What it may do is [#0004](../decisions/0004-chat-session-permissions.md). | |
| Bootstrap | **Dogfood.** Ship a bare-bones version first; after that, decisions about president are cards in president. | The fastest way to find out what the tool needs is to use it. | |
| Repo | Private on GitHub. | | |
| Syncing answers across machines (2026-11-11) | **A Sync button in the hub.** The hub keeps writing card files as now; pressing Sync checks that it is safe to touch each project's checkout, commits the card changes in one commit, pulls and pushes. When the hub starts it only fetches and shows how many card changes are waiting. | One commit per sitting instead of one per click, and git changes a checkout only when the human presses Sync, so it can say "not now" rather than rewrite an agent's unpushed work or put conflict markers in its files (its other uncommitted files are only set aside while the pull runs), while the human is looking. | [#0001](../decisions/0001-sync-across-machines.md) |
| Where a card's conversation is stored (2026-11-11) | **A summary in the card, the full log local.** The full session stays in Claude Code's own store on the machine that ran it (resumed by the card's `session_id`); when a conversation ends, its conclusions are added to the card as a feedback entry the human can edit first. | What has to travel and reach the project's agent is what was learned and concluded, not every tool call; no transcripts (which can quote project files) go into git, and the card grows by a few lines per conversation. | [#0003](../decisions/0003-conversation-storage.md) |
| What the card's chat session may do (2026-11-11) | **Read the project and research the web, nothing else.** Only Read, Grep, Glob, WebSearch and WebFetch, file reads confined to the project (`--restricted`), every other call denied without asking (`dontAsk`); the hub writes any card change the session proposes. | Everything the chat needs (answer, teach, research, propose options) is reading; writes go through the hub's existing checks. A browser click must not be able to edit files or run commands in any registered project. | [#0004](../decisions/0004-chat-session-permissions.md) |
| Who applies a decision (2026-11-11) | **The project's working agent, later**, as today: the card waits as "Waiting for an agent to apply it" until an agent in that project runs `president pending`, records it in the docs, does the work and runs `president applied`. The chat session never applies decisions. | The working agent knows the branch, the plan and the code, and the path is built and tested (tokens refuse stale applies, undo entries tell agents to revert). Undo keeps its 10 seconds, and the chat needs no write permissions. | [#0006](../decisions/0006-who-applies-decisions.md) |

## Card interactions (must have)

On any card the human can:
- pick an option, or pick **A / B / neither** with a note (neither → the agent comes back with new options based on the note)
- **ask** a question / chat back and forth
- ask for **more info** / research (from primary sources, with quotes)
- ask to be **taught** the background before deciding
- **defer** it, or split it into sub-questions

When a card is resolved, the project's working agent (not the card's chat session, see
[#0006](../decisions/0006-who-applies-decisions.md))
writes the decision into the project's docs and moves on.

## Engineering process

Every task is done by a fresh agent session on its own branch and ends in a PR. A separate fresh session
reviews the PR, and the loop repeats until **every** finding, non-blocking ones included, is fixed. Only then is it merged.
Nobody reads the plumbing by hand, so review is the quality gate.
