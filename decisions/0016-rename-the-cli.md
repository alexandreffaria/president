---
id: "0016"
title: Should the president command be renamed, given an unrelated npm package with that name?
status: open
kind: choice
priority: normal
created: 2026-11-11T13:22:16Z
created_by: claude (batch-1 writer)
tags: [cli, naming, security]
depends_on: []
recommendation:
  option: rename
  why: >-
    The npm package called president is a tool for running commands with elevated
    privileges, and the people most likely to type npx president are agents that found the
    command missing. A warning in the docs relies on every agent reading it; a name nobody
    else owns doesn't. Renaming now, with few users, is the cheapest it will ever be. If you
    never expect president to be installed on a machine without the command on PATH, keep.
options:
  - id: keep
    title: Keep president, with the warning in the docs
    summary: Today's state; README and the skill both say to use the installed president command and never npx president outside the repo.
    pros:
      - No rename; the product and the command share one name
      - Nothing breaks for registered projects, installed links or the skill
    cons:
      - An agent that finds president missing and tries npx president downloads and runs a privilege-elevation tool from 2015
      - The protection is a sentence agents have to read and follow
  - id: rename
    title: Rename the command to a name nobody owns on npm
    summary: The command becomes something unclaimed, for example presctl, and the package name is reserved on npm with a placeholder, so npx can only ever find ours or nothing.
    pros:
      - A mistaken npx can't run someone else's code
      - The product can still be called president; only what you type changes
    cons:
      - About 200 mentions of "president <command>" in code, tests, docs, the skill and printed done lines to change, and existing installs need relinking
      - A placeholder package is one more thing to own; unpublished, the name could still be taken later
  - id: scoped
    title: Keep the command, publish under a scope
    summary: The command stays president, the package is published as @alexandreffaria/president, and docs say npx @alexandreffaria/president when the command isn't installed.
    pros:
      - The command people and agents type every day doesn't change
      - Gives a correct npx line to use when the command is missing
    cons:
      - A plain npx president still runs the other package; only the documented line is safe
      - Publishing to npm means versioning and releasing, for a tool that so far runs from a git checkout
---

## Context

**The facts.** On npm, `president` is an unrelated package, checked today with `npm view president`:

```
name = 'president'
version = '2.0.4'
description = 'Execute commands with privileges!'
repository.url = 'git://github.com/jviotti/president.git'
maintainers = 'jviotti <juanchiviotti@gmail.com>'
time.created = '2015-04-01T16:39:51.459Z'
```

`npx <name>` runs the local `node_modules/.bin/<name>` if there is one, and otherwise
downloads the npm package with that name and runs it. It prints a prompt before installing,
which `--yes` suppresses; an agent that adds `--yes`, or answers yes, runs it.

**Today** our package is `"private": true` with `"bin": { "president": "bin/president.js" }`
(`package.json`). It's installed by linking `bin/president.js` onto your PATH (README, "Install
the `president` command"). The README says "**Use `president`, not `npx president`, outside this
repo.**", and the skill says the same: "Use the `president` command, not `npx president` outside
the president repo: an unrelated package with the same name exists on npm."

The command's name is everywhere: the skill, `docs/card-format.md`, the help text
(`src/cli/main.ts`), the `done:` lines `president pending` prints, error messages, and tests
(about 200 occurrences of `president <word>` in `src`, `bin`, `skills`, `docs`, `README.md` and
`test`).

Names checked as free on npm today (`npm view` returns 404): `presctl`, `prescards`,
`pres-cards`, `decicards`, `president-cli`. Taken: `prez` (Reveal.js slideshows), `pres`,
`potus`, `cabinet`, `veto`.

## Option keep: Keep president, with the warning in the docs

```sh
president pending
# done: president seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
```

## Option rename: Rename the command to a name nobody owns on npm

```sh
presctl pending
# done: presctl seen /home/me/app/decisions/0007-api-errors.md --token 2-0k3j5h2g9fd
```

`presctl` is an example; tell me the name you want in the note.

## Option scoped: Keep the command, publish under a scope

```sh
president pending                                 # installed
npx @alexandreffaria/president pending            # not installed
```

## Sources

- npm docs, npx: packages not present locally are "installed to a folder in the npm cache", and
  "A prompt is printed (which can be suppressed by providing either `--yes` or `--no`)." Without
  `--package`, "npm will attempt to determine the executable name from the package specifier
  provided as the first positional argument".
  https://docs.npmjs.com/cli/v11/commands/npx
- The package: https://www.npmjs.com/package/president
