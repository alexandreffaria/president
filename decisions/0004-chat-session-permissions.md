---
id: "0004"
title: What should the card's agent session be allowed to do?
status: resolved
kind: choice
priority: high
created: 2026-11-11T13:22:04Z
created_by: claude (batch-1 writer)
tags: [pr-2, chat, security, permissions]
depends_on: []
recommendation:
  option: readonly
  why: >-
    Everything PR 2 needs (answer questions, teach, research, propose new options) can be done
    by reading the project and the web; writes can go through the hub, which already
    validates and guards card files. A browser click should not be able to run shell commands
    in any registered project. Revisit "ask" if you later want the chat to apply decisions
    (#0006).
options:
  - id: readonly
    title: Read the project and research the web, nothing else
    summary: Only Read, Grep, Glob, WebSearch and WebFetch are available, file reads are confined to the project (--restricted), and dontAsk mode denies anything else without asking; the hub writes any card change the session proposes.
    pros:
      - A click can't edit files, run commands or commit, whatever the session reads on the web
      - Nothing to approve mid-conversation, so the chat never stalls
      - Covers Teach me, More info, research and new options (the session returns them, the hub writes them)
    cons:
      - It can't update docs or apply a decision itself (#0006 then stays with the working agent)
      - Read access to the project plus WebFetch is still a path for a prompt-injected page to leak project text in a URL; a WebFetch domain allowlist narrows it but limits research
      - It can't run the project's code to check a claim (for example "does this test pass")
  - id: docs
    title: Read-only, plus editing docs/ and running president
    summary: The read-only set plus Edit(docs/**) and Bash(president *), so the session can record decisions in docs and act on cards itself.
    pros:
      - The session can apply a decision right after you make it (option "chat" on card 0006)
      - Writes stay inside docs/, which is reviewed in git like everything else
    cons:
      - Edits land in the working tree of whatever branch is checked out, possibly under an agent working there
      - A prompt-injected page can now change your docs, not only read them
      - Bash(president *) allows every president subcommand, not only applied; a prompt-injected page could also rewrite open cards with update, register other folders with add or unregister projects with remove
  - id: ask
    title: Anything, but you approve each risky step in the chat
    summary: Reads and research run freely; any other tool call is shown in the conversation as an Allow / Deny prompt, relayed through a --permission-prompt-tool the hub provides.
    pros:
      - The session can do real work (edit, run tests) when you want it to, and only then
      - You see exactly what it is about to run before it runs
    cons:
      - The most code to build (an MCP permission tool in the hub, prompts in the UI, timeouts)
      - Approval fatigue; a stream of prompts invites clicking Allow without reading
  - id: full
    title: Full permissions, like a normal Claude Code session
    summary: The session runs with the same freedom as your interactive sessions in that project; since nobody can answer prompts in -p mode, that means --permission-mode auto or bypassPermissions.
    pros:
      - The chat can do anything you would ask an agent in a terminal, including apply decisions and fix code
      - No allowlists to maintain
    cons:
      - A browser click starts an agent that can run any command as you, with web content in its context
      - The project's .claude/settings.json allow rules are not even used in -p mode for an untrusted folder, so "like a normal session" really means bypassing prompts
      - Mistakes land in the project's working tree with nobody watching
resolution:
  choice: readonly
  resolved_at: 2026-11-11T15:29:18Z
applied_at: 2026-11-11T15:41:21Z
---

## Context

When you press *Teach me*, *More info*, *Neither, try again* or type a question, the hub will
spawn `claude -p` in the card's project folder. This card decides what that session may do.
It matters because the trigger is a click in a browser, the session reads untrusted text
(web pages, the card itself), and it runs in projects that may hold secrets.

**What already protects the hub.** It listens only on 127.0.0.1, refuses requests whose Host
isn't localhost, and refuses writes and WebSockets whose Origin isn't the hub itself
(`src/server/security.ts`, README "How it fits together"). So another website can't make your
browser start a session; only the hub's own page can. What remains is what the session does
once started, including after reading a malicious page.

**How Claude Code permissions work in headless mode** (official docs, linked below):

- **Modes** (`--permission-mode`): `manual`/default asks before edits, commands and network;
  `acceptEdits` edits files without asking; `plan` only researches and proposes; `auto` has a
  classifier review most actions instead of you; `dontAsk` denies every call that would
  otherwise prompt, "though a mod you installed can still approve some of those calls";
  `bypassPermissions` runs everything without checks. Separately, `--permission-prompts none`
  says nobody answers prompts, so anything that would prompt is denied; it matters most when
  something else (a `--permission-prompt-tool`) would otherwise be asked.
- **In `-p` mode nobody can answer a prompt.** "In a Manual mode `claude -p` run, a call that
  needs approval is denied unless something approves it, such as a `PermissionRequest` hook or a
  `--permission-prompt-tool`."
- **Tool lists.** `--tools` limits which built-in tools exist at all; `--allowedTools` lists rules
  that run without asking; `--disallowedTools` lists deny rules. Rules look like `Read`,
  `Edit(docs/**)`, `Bash(npm run test *)`, `WebFetch(domain:example.com)`. Deny is checked first
  and "An allow rule can't carve an exception out of a deny rule." A bare `Read` rule "Matches
  all file reads", anywhere on the machine (`~/.ssh`, other projects); `Read(./**)` matches
  only files under the folder the session runs in.
- **Untrusted folders.** `-p` never shows the workspace trust dialog. In an untrusted folder,
  the project's `.claude/settings.json` allow rules are not used, but its hooks run and its
  `.mcp.json` servers are connected. `--setting-sources user` and `--strict-mcp-config` stop that.
  (`--bare` would too, but it ignores your Claude Code login and needs an API key, which goes
  against "uses the user's existing Claude Code login" in `docs/foundations.md`.)
- **Restricted mode.** `--restricted` removes the tools that run commands or code, and
  WebFetch, unless `--tools` names them; ignores user, project and local settings files (so
  no hook or allow rule from those files applies); confines the file tools to the working
  directories; and refuses `bypassPermissions`. It keeps your Claude Code login: a
  `--restricted` run here answered without an API key.
- **Rules are enforced by Claude Code, not the model**: instructions in a prompt don't widen or
  narrow them.

Installed here: Claude Code 2.1.302 (`claude --version`), whose `--help` lists the
`--permission-mode` choices `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`.

## Option readonly: Read the project and research the web, nothing else

```sh
claude -p --output-format stream-json --verbose --resume "$SESSION_ID" \
  --restricted --strict-mcp-config \
  --tools "Read,Grep,Glob,WebSearch,WebFetch" \
  --allowedTools "WebSearch,WebFetch" \
  --permission-mode dontAsk --permission-prompts none \
  --max-budget-usd 1 \
  "$MESSAGE"
```

In `dontAsk` mode, "file reads in your working directories" run without approval, and anything
that would prompt is denied, so `Read`, `Grep` and `Glob` need no allow rule inside the
project; only the two web tools do. `--restricted` keeps the file tools inside the project and
skips every settings file, yours included, so a hook or allow rule in your own settings doesn't
widen the session; it also makes `--setting-sources user` unnecessary.

Tested here with Claude Code 2.1.302, from a scratch folder: with these flags, Glob, Grep and
Read of a file in the folder ran. Asked to read `/etc/hostname`, a session with a bare `Read`
allow rule and no `--restricted` read it; with `Read(./**)` in its place, or with
`--restricted`, the read was refused.

Whether a mod you installed still loads under `--restricted` isn't documented; `--safe-mode`
turns installed mods off, along with CLAUDE.md and skills, and can be weighed when this is
built. New options for *Neither* come back as structured output (`--json-schema`), and the hub
writes them through the same checks as `president update`.

## Option docs: Read-only, plus editing docs/ and running president

Same as above, with:

```sh
  --tools "Read,Grep,Glob,WebSearch,WebFetch,Edit,Write,Bash" \
  --allowedTools "WebSearch,WebFetch,Edit(docs/**),Bash(president *)" \
  --permission-mode dontAsk --permission-prompts none
```

Edits outside `docs/` and any other command are denied. `--restricted` stays: it removes Bash
only when `--tools` doesn't name it.

## Option ask: Anything, but you approve each risky step in the chat

The read-only flags with four changes: `--tools` names every tool the session may ask for
(`--restricted` drops Bash and the other code-running tools unless they are named), the mode is
`manual` instead of `dontAsk`, `--permission-prompt-tool mcp__president__approve` points at
an MCP tool served by the hub (passed with `--mcp-config`, since `--strict-mcp-config` ignores
every other MCP configuration), and `--permission-prompts host` (the default) instead of
`none`, so prompts reach the hub's tool. A call that needs approval appears in the
conversation:

```
The agent wants to run:  npm test -- api-errors
[Allow once]  [Deny]
```

Unanswered prompts are denied after a timeout.

## Option full: Full permissions, like a normal Claude Code session

```sh
claude -p --output-format stream-json --verbose --resume "$SESSION_ID" --permission-mode auto "$MESSAGE"
# or --permission-mode bypassPermissions
```

## Sources

- Claude Code docs, headless mode: "In a Manual mode `claude -p` run, a call that needs approval
  is denied unless something approves it, such as a `PermissionRequest` hook or a
  `--permission-prompt-tool`." and "`dontAsk`: Claude Code denies every call that would otherwise
  prompt, which is useful for locked-down CI runs, though a mod you installed can still approve
  some of those calls", and "Actions that need no approval in Manual mode still run, such as file
  reads in your working directories and the read-only command set." On auto: "have a classifier
  review most actions instead of you". On `--permission-prompts none`: "Pass `--permission-prompts
  none` when nobody is available to answer permission prompts", and "With the flag, your run
  doesn't consult the host or wait on it. Anything that would prompt is denied unless a
  `PermissionRequest` hook allows it". https://code.claude.com/docs/en/headless
- Claude Code docs, permission modes: `bypassPermissions` "disables permission prompts and safety
  checks so tool calls execute immediately, including writes to protected paths." On auto:
  "Reads and working-directory edits outside protected paths skip the classifier".
  https://code.claude.com/docs/en/permission-modes
- Claude Code docs, permissions: "Rules are evaluated in order: deny, then ask, then allow." "An
  allow rule can't carve an exception out of a deny rule." "Permission rules are enforced by
  Claude Code, not by the model." "Claude Code shows the trust dialog in interactive sessions
  only. A `claude -p` run or an SDK session never shows it." In the table of rules: "`Read` |
  Matches all file reads".
  https://code.claude.com/docs/en/permissions
- Claude Code docs, headless mode, on `--bare`: "Without `--bare`, a `-p` session runs the hooks
  in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a
  folder you've never trusted." https://code.claude.com/docs/en/headless
- Claude Code docs, CLI reference: `--max-budget-usd` "Stop the run once estimated spend on API
  calls reaches this amount (print mode only)"; `--tools` "Restrict which built-in tools Claude
  can use."; `--restricted` "removes the built-in tools that run commands or code, and WebFetch,
  unless you name them individually in `--tools`, not through the `default` preset. It also
  confines the built-in file tools to the working directories, loads only managed settings and
  `--settings`, refuses `bypassPermissions`"; `--permission-prompts` "With the default `host`,
  Claude Code sends them to the Agent SDK host or the `--permission-prompt-tool` tool."
  https://code.claude.com/docs/en/cli-reference
- `claude --help` (2.1.302): `--restricted` "removes the built-in tools that run commands or code
  (Bash, PowerShell and the other code-running tools) and WebFetch unless --tools names them, and
  ignores user, project and local settings files (managed settings and --settings still apply;
  add --strict-mcp-config to skip MCP servers too)"; `--permission-prompts`: `"host" (the SDK
  host or --permission-prompt-tool) or "none" (nobody: anything that would prompt is denied
  automatically; the permission mode still decides everything else)`, `default: "host"`.
- Claude Code docs, security: "Avoid piping untrusted content directly to Claude."
  https://code.claude.com/docs/en/security
- Simon Willison, "The lethal trifecta for AI agents" (private data, untrusted content, and a way
  to communicate externally, together): https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
- `claude --help` (2.1.302): `--bare` "Anthropic auth is strictly ANTHROPIC_API_KEY or
  apiKeyHelper via --settings (OAuth and keychain are never read)."
