# president — foundations

president is a local web app where coding agents put **decision cards** in front of a human.
The human handles direction (research, psychology, UX, ideation) and the agents handle implementation.
It's inspired by TJ's language-design workflow (see `ideas/tj-video-transcript.txt`): a `docs/` folder of
settled decisions, a `questions/` folder of open ones, a queue that opens a fresh agent chat for each
question, A/B "flashcards", and "resolve → agent updates the docs → next card".

## Settled decisions (2026-11-10)

| Decision | Choice | Why |
|---|---|---|
| Scope | **One hub for all projects.** Each project keeps its cards as files in its own repo; one president app shows the queue across every registered project. | The user works on many projects at once and wants one place to go through decisions. |
| Card storage | Plain files in each project repo, git-tracked. | Decisions live next to the code they shape, and any agent can write them without president running. |
| Chat engine | **Headless Claude Code sessions** (`claude -p`) started in the card's project directory, resumed per card. | Uses the user's existing Claude Code login; the agent can read the code, do research, and update docs. |
| Bootstrap | **Dogfood.** Ship a bare-bones version first; after that, decisions about president are cards in president. | The fastest way to find out what the tool needs is to use it. |
| Repo | Private on GitHub. | |

## Card interactions (must have)

On any card the human can:
- pick an option, or pick **A / B / neither** with a note (neither → the agent comes back with new options based on the note)
- **ask** a question / chat back and forth
- ask for **more info** / research (from primary sources, with quotes)
- ask to be **taught** the background before deciding
- **defer** it, or split it into sub-questions

When a card is resolved, the agent writes the decision into the project's docs and moves on.

## Engineering process

Every task is done by a fresh agent session on its own branch and ends in a PR. A separate fresh session
reviews the PR, and the loop repeats until **every** finding, non-blocking ones included, is fixed. Only then is it merged.
Nobody reads the plumbing by hand, so review is the quality gate.
