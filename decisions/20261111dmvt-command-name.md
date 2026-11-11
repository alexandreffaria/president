---
id: "20261111dmvt"
title: What should the president command be renamed to?
status: open
kind: choice
priority: high
created: 2026-11-11T18:21:27Z
created_by: claude (batch-3 writer)
tags: [cli, naming, npm]
depends_on: ["0016"]
recommendation:
  option: preside
  why: >-
    It is a short, real word that says what the tool does around the product's own name
    (the president presides over decisions), so the docs still read naturally, and it and
    its punctuation variants are free on npm. Keep president as an alias until a month
    after the rename ships, or until your registered projects' own docs stop telling agents
    to type it, whichever is later (see "The alias" below), so an agent that types the old
    name from habit finds the installed command instead of reaching for npx. Pick
    decision-cards if you'd rather the command say plainly what it is, prescards for a
    shorter name that still says "cards", and presctl if you like the "...ctl" convention
    for tools that control a service.
options:
  - id: preside
    title: preside
    summary: A real English word close to the product's name; "preside pending", "preside seen <file>".
    pros:
      - Short (7 letters), easy to say and to remember, and clearly related to president
      - An ordinary word, so prose reads naturally ("run preside pending")
    cons:
      - It begins like president, so habit can turn one into the other in either direction
      - A common word; search results for it are mostly about chairing meetings
  - id: presctl
    title: presctl
    summary: The example from card 0016, in the style of systemctl and kubectl; "presctl pending".
    pros:
      - Short, and the "ctl" ending tells developers it controls a service (the hub)
      - Very unlikely to clash with anything, on npm or on your machine
    cons:
      - Not a word; hard to say out loud and to spell from memory
      - The convention means nothing to someone who doesn't code
  - id: decision-cards
    title: decision-cards
    summary: The plain name of the thing it handles, the same as the skill's name; "decision-cards pending".
    pros:
      - Says exactly what it is, to agents and people alike
      - Matches the skill (decision-cards), so the two are found together
    cons:
      - Long (14 characters with a dash) for a command typed in every session and printed in every done line
      - Loses the link to the product's name
  - id: prescards
    title: prescards
    summary: The start of the product's name plus the thing it handles; "prescards pending".
    pros:
      - Says what it handles (cards) and keeps a link to the product's name
      - Short (9 letters) and very unlikely to clash with anything, on npm or on your machine
    cons:
      - Not a word; it can be read as "pre-scards" and has to be spelled from memory
      - '"pres" is a short form you have to know stands for president'
---

## Context

**What 0016 decided.** On [0016](0016-rename-the-cli.md) you chose `rename`: the command
becomes a name nobody owns on npm, and that name is reserved on npm with a placeholder package,
so `npx <name>` can only ever find ours or nothing. The product can still be called president;
only what is typed changes. The card's `presctl` was an example ("tell me the name you want in
the note"), and the decision came without a note, so the name is open (`docs/roadmap.md`,
"F. Rename the command", and "Needs a card", item 13). The `president` package on npm belongs
to someone else (a library, "Execute commands with privileges!", with no command today).

This card only asks for the new name. Keeping `president` would mean reopening 0016, which
you decided as `rename` and an agent has already applied. If you've changed your mind about
renaming at all, reopen 0016.

**Who types it.** Mostly agents: the skill tells them to run `president add`, `president
pending`, and the `done:` lines `president pending` prints. You type it when installing and
when starting the hub. A good name is short, unambiguous in prose, and free on npm.

**Names checked, 2026-11-11** with `npm view <name>` (npm 12.2.2): "404 Not Found" means
nobody has published it. npm also refuses a new name that matches an existing one once
punctuation is removed, so I checked those spellings too.

| Name | `npm view` | Punctuation variants checked, all free |
|---|---|---|
| `preside` | 404, free | `pre-side`, `pre.side`, `pre_side` |
| `presctl` | 404, free | `pres-ctl`, `pres_ctl`, `pres.ctl` |
| `decision-cards` | 404, free | `decisioncards`, `decision_cards`, `decision.cards` |
| `prescards` | 404, free | `pres-cards`, `pres_cards`, `pres.cards` |
| `decicards`, `president-cli`, `ruling`, `cardhub` | 404, free | (not shortlisted) |
| `decide`, `decider`, `verdict`, `gavel`, `docket`, `quorum`, `ballot`, `prez`, `pres`, `presi` | taken | |

A name free today can still be taken before the placeholder is published, and npm's
similarity check runs only when publishing, so the check is repeated right before.

**The alias.** The roadmap also asks whether `president` stays as a second name for the same
command for a while. Each option above can have it:

- **With the alias** (recommended): `president` keeps working next to the new name. Old
  `done:` lines printed before the rename, and agents typing the old name from habit, still
  find the installed command, rather than failing and trying `npx president`, the exact
  mistake the rename guards against. The cost: agents keep seeing and typing `president`
  longer, and the old name has to be removed in a second step.
  **When it ends, by default:** a pull request removes the alias one month after the rename
  ships, or once every registered project's own docs and agent instructions (its
  `CLAUDE.md`, its `docs/`) use the new name, whichever is later. The skill itself changes
  with the rename, since projects link to the copy in this repo. To end it sooner, later or
  on another condition, say so in your note.
- **Without:** the old name stops working the day of the rename; you relink once, and every
  agent must use the new name from then on.

If you don't want the alias, say "no alias" in your note.

**After you choose.** Reserving the name means publishing a placeholder package from your npm
account; an agent will prepare it and ask you to publish it or approve publishing.

## Option preside: preside

```sh
preside pending
# done: preside seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
```

## Option presctl: presctl

```sh
presctl pending
# done: presctl seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
```

## Option decision-cards: decision-cards

```sh
decision-cards pending
# done: decision-cards seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
```

## Option prescards: prescards

```sh
prescards pending
# done: prescards seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
```

## Technical detail (for the implementer)

- The rename touches the `bin` entry in `package.json` (today `"president":
  "bin/president.js"`), the help text in `src/cli/main.ts`, the `done:` lines built in
  `pending` (`src/cli/commands.ts`), error messages, the README's install line
  (`ln -s "$PWD/bin/president.js" ~/.local/bin/president`) and its npx warning, the skill and
  `docs/card-format.md`. `grep` finds 181 mentions of `president` followed by a subcommand in
  `src`, `bin`, `skills`, `docs`, `README.md` and `test`.
- The alias is a second `bin` entry (`"president": "bin/president.js"` next to the new one)
  and a second link in the README's install step. The roadmap's F section records its end
  (the default above, or what your note says), so whoever removes it can check: the month
  has passed, and a `grep` for `president <command>` in each registered project's
  `CLAUDE.md` and `docs/` finds nothing.
- The placeholder package: a `package.json` with the chosen name, a version such as `0.0.0`, a
  README saying what it is, and no `bin`, published with `npm publish` from the human's
  account.

## Sources

- Card [0016](0016-rename-the-cli.md), option `rename`, and its npm and npx research;
  `docs/roadmap.md`, "F. Rename the command (#0016)" and "Needs a card", item 13.
- `npm view <name> name version` for each name in the table, run on 2026-11-11 with npm
  12.2.2: free names print `npm error code E404`; taken names print their name and version
  (for example `decide` 1.0.0, `verdict` 1.0.7, `gavel` 10.0.4, `prez` 4.7.0).
- npm blog, "new package moniker rules" (2017-12-26): for a new package "we remove punctuation
  from its name and compare it to existing package names. If the names are identical without
  punctuation, we do not allow the package to be created."
  https://blog.npmjs.org/post/168978377570/new-package-moniker-rules
- npm docs, package name guidelines: an unscoped name "Is not spelled in a similar way to
  another package name". https://docs.npmjs.com/package-name-guidelines
- Code: `package.json` (`bin`), `README.md` (install and the npx warning),
  `src/cli/main.ts`, `src/cli/commands.ts`.
