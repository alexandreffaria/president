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
    The npm package called president is someone else's library; today npx president only
    fails, but its owner could add a president command in any release, and the people most
    likely to type npx president are agents that found the command missing (and npx doesn't
    ask them before installing). A warning in the docs relies on every agent reading it; a
    name nobody else owns doesn't. Renaming now, with few users, is the cheapest it will ever
    be. It is a guard against something that may never happen: if a release adding a command
    to a package untouched since 2017 seems too unlikely to plan around, keep.
options:
  - id: keep
    title: Keep president, with the warning in the docs
    summary: Today's state; README and the skill both say to use the installed president command and never npx president outside the repo.
    pros:
      - No rename; the product and the command share one name
      - Nothing breaks for registered projects, installed links or the skill
    cons:
      - If the president package on npm ever gains a "president" executable (a new release by its owner, or a hijacked account), a mistaken npx president would run it; today it fails with "could not determine executable to run"
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
      - A plain npx president still goes to the other package (an error today, its code if it ever gains a president command); only the documented line is safe
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

It is a library (`"main": "build/president.js"`) with **no `bin` field**, so it has no
command to run, in any of its six versions (`npm view president@<version> bin` is empty). Its last
release, 2.0.4, is from 2017-08-07.

**What `npx president` does.** `npx <name>` runs the local `node_modules/.bin/<name>` if there
is one. Otherwise it looks up the npm package with that name and runs the command that package
declares. The `president` package declares none, so today `npx president` stops with
`npm error could not determine executable to run` before installing anything (tried today in an
empty folder with npm 12.2.2; in npm's code the bin lookup, `getBinFromManifest`, comes before
the install step). Two things make the name a risk anyway:

- The name belongs to someone else. Its owner, or whoever takes over the account, can publish a
  release with a `president` command at any time, and from then on `npx president` would
  download and run it.
- npx asks before installing only in a terminal: "When standard input is not a TTY or a CI
  environment is detected, `--yes` is assumed." Agents usually run commands without a terminal,
  so nobody would be asked.

Today the practical cost is smaller: an agent that tries `npx president` gets a confusing error
and may try something else.

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
  provided as the first positional argument", and "If this does not result in exactly one option
  (either because there are no bin entries, or none of them match the `name` of the package),
  then `npm exec` exits with an error." https://docs.npmjs.com/cli/v12/commands/npx
- npm docs, npm exec: "When standard input is not a TTY or a CI environment is detected, `--yes`
  is assumed." https://docs.npmjs.com/cli/v12/commands/npm-exec
- npm's code (12.2.2): `libnpmexec/lib/index.js` calls `getBinFromManifest` (which throws
  "could not determine executable to run") before it installs anything, and when `!yes` and
  `noTTY() || ciInfo.isCI` it only logs a warning and installs.
  https://github.com/npm/cli/tree/v12.2.2/workspaces/libnpmexec/lib
- The package: https://www.npmjs.com/package/president
