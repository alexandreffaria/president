# Decision card format

A decision card is one question the human should answer, written by an agent as a markdown
file in the project it belongs to. president reads every card from every registered project
and shows them in one queue.

This document is the spec. The zod schema in `src/core/schema.ts` enforces it; when the two
disagree, fix one of them.

## Where cards live

```
<project>/decisions/<id>-<slug>.md
```

- `<id>` is lowercase letters and digits only, no dashes. Use zero-padded numbers: `0001`, `0002`, ...
  To pick the next id, list `decisions/` and add one to the highest number.
- `<slug>` is a few lowercase words joined by dashes: `0007-error-handling.md`. It is only for humans
  browsing the folder; the slug can change without breaking anything.
- Status lives in the frontmatter. Files are never moved between folders.
- Files whose names start with `.` or `_`, `README.md`, and non-`.md` files are ignored, so you can
  keep a `decisions/README.md` or `_template.md` next to the cards.
- Two files with the same id are both shown as broken until one is renamed.
- Card files must be regular files: a symlinked card is shown as broken, and a `decisions/` folder
  that is a link to somewhere outside the project is refused.
- A card file must be under 1 MiB.

## File layout

A card is YAML frontmatter between two `---` lines, followed by a markdown body:

```markdown
---
id: "0007"
title: How should the API client report errors?
...
---

## Context

...

## Option throw: Throw typed errors

...
```

## Frontmatter fields

| Field | Required | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Same as the file name prefix. Quote it (`"0007"`): unquoted `0007` is read as the number 7 (still accepted, and matched by value). A quoted id must match exactly: `"07"` is not `0007`. |
| `title` | yes | string | The question, phrased as a question. Quote it if it contains `: ` or starts with a special character. |
| `status` | yes | `open` \| `deferred` \| `resolved` | Agents create cards as `open`. |
| `kind` | yes | `choice` \| `ab` \| `open` | See [kinds](#kinds). |
| `priority` | no (default `normal`) | `high` \| `normal` \| `low` | High priority cards come first in the queue. |
| `created` | yes | date | `2026-11-10` or `2026-11-10T14:03:00Z`, a real date (not `2026-02-30`). Use the current UTC time: `date -u +%Y-%m-%dT%H:%M:%SZ`. |
| `created_by` | yes | string | Who wrote it, e.g. `claude-code`. |
| `tags` | no | list of strings | Free-form labels for filtering. |
| `depends_on` | no | list of card ids | Cards in the same project that should be decided first. An id that isn't a card of the project is reported as a warning. |
| `recommendation` | no | `{option, why}` | The agent's pick and the reason, in one or two sentences. `option` must be an option id. |
| `options` | per kind | list | See [options](#options). |
| `feedback` | no | list of `{at, note, type?}` | Rounds of human feedback, oldest first. president appends to it. |
| `needs_new_options` | no | boolean | Set by president when the human rejects every option ("neither"). An agent should write new options from the latest feedback, then remove the flag. Not allowed on a resolved card. |
| `resolution` | when resolved | `{choice, note?, resolved_at}` | The human's answer. `choice` is an option id, or `custom` with the answer in `note`. |
| `applied_at` | no | timestamp | Set by an agent after it has acted on the resolution (updated the docs): `president applied <file>`. Only on resolved cards. |
| `seen_at` | no | timestamp | When an agent last read the human's feedback: `president seen <file>` (and `president applied`) set it. Feedback newer than this is listed by `president pending`. |
| `session_id` | no | string | Reserved for the per-card chat (a later version). |

Any other field is allowed and is kept untouched when president updates the card, so agents can
add their own bookkeeping. When president writes a card it changes only the fields whose values
changed; everything else (comments, quoting, folded text, line endings, the body) stays exactly as
it was.

`validate` rejects the template's placeholders: a value or an option section that is just `...`
(or `[...]`) means the card isn't finished.

### Kinds

- **`choice`**: pick one of 2 or more options (2 to 4 is best; the keyboard covers up to 9). Options are shown stacked.
- **`ab`**: exactly 2 options shown side by side, for comparing two concrete examples.
- **`open`**: a free-form answer. `options` may be left out; if present they are suggestions the
  human can pick, but they can always answer in their own words (`choice: custom`).

### Options

```yaml
options:
  - id: result          # short lowercase slug: a, b, c or a word; unique; not "custom"
    title: Return a result object
    summary: One sentence that says what this option is.
    pros:
      - The compiler makes every caller handle the failure
    cons:
      - More code at each call site
```

`id` and `title` are required. `summary`, `pros` and `cons` are optional but expected.

### Feedback entries

```yaml
feedback:
  - at: 2026-11-05T18:40:00Z
    type: neither        # neither | note | defer | reopen
    note: Both options assume a server. Only compare on-device storage.
```

`type` tells agents what the human did: `neither` rejected all options, `note` added a comment,
`defer` postponed it, `reopen` reopened a resolved card. A `reopen` entry keeps the old
resolution in `previous_resolution`, and `previous_applied_at` when an agent had applied it:

```yaml
  - at: 2026-11-12T09:00:00Z
    type: reopen
    note: Reopened; it was resolved as "protomaps" (Cost matters most.). Costs changed.
    previous_resolution:
      choice: protomaps
      note: Cost matters most.
      resolved_at: 2026-11-03T16:20:00Z
    previous_applied_at: 2026-11-03T16:45:00Z
```

Feedback written after `seen_at` (or all of it, when there is no `seen_at`) has not been read by
an agent yet.

## Body

The body is markdown. It is shown in full, so write it for a human who has not seen the code:

- Start with `## Context`: what the question is about, why it matters now, constraints.
- Then one section per option, introduced by a level-2 heading **`## Option <id>`**, optionally
  followed by `:` and a title. Everything up to the next level-2 heading belongs to that option and
  is shown inside that option's card. Put the concrete example (code, copy, a sketch) here.
- Any level-2 section after the options (for example `## Sources`) is shown below the options.
- A `## Option <id>` heading whose id is not in `options` is an error. An option without a body
  section is fine; its summary, pros and cons are still shown.
- Headings inside fenced code blocks are ignored, so examples can contain markdown.

## Lifecycle

```
open ──resolve──▶ resolved ──(agent applies it)──▶ resolved + applied_at
 │ ▲                  │
 │ └──────reopen──────┘
 ├──neither──▶ open + needs_new_options (feedback appended)
 ├──note─────▶ open (feedback appended)
 └──defer────▶ deferred ──reopen──▶ open
```

Deferred cards can also be resolved, rejected ("neither") or noted directly.

What agents do (`president pending` lists all of these):

- **Write** cards with `status: open`.
- **Resolved, no `applied_at`**: act on the decision (update the project's docs), then set
  `applied_at` (`president applied <file>` does it).
- **Resolved again after a reopen** (a `reopen` feedback entry with `previous_resolution`): the
  earlier decision may already be in the docs and the code. If `previous_applied_at` is set,
  replace the earlier record instead of adding a second one, and undo work that no longer
  applies. Then `president applied <file>`.
- **`needs_new_options: true`**: read the latest `neither` feedback, replace `options` (and the
  option sections in the body) with new ones, update `recommendation`, then remove
  `needs_new_options`. Keep `feedback` as it is. Then `president seen <file>`.
- **Feedback newer than `seen_at`** (notes, a deferral's reason, a reopen): read it and act on it
  (answer in the card, research, adjust the options), then `president seen <file>`.

Check a card with `president validate <project>` or `president validate <card-file>`; it prints
each problem with the field and the file line.

## Full example

~~~~markdown
---
id: "0002"
title: How should the API client report errors?
status: open
kind: ab
priority: normal
created: 2026-11-06T11:30:00Z
created_by: claude-code
tags: [api, typescript]
depends_on: []
recommendation:
  option: result
  why: >-
    Most of our calls fail in expected ways (offline, timed out, not found), and the
    UI has to handle each of them. Returning a result makes the compiler remind us.
options:
  - id: throw
    title: Throw typed errors
    summary: Functions return data on success and throw an ApiError subclass on failure.
    pros:
      - Familiar to every TypeScript developer
      - Call sites stay short when the caller doesn't care about failures
    cons:
      - Nothing forces a caller to handle "offline", so it's easy to forget
  - id: result
    title: Return a result object
    summary: "Functions return { ok: true, data } or { ok: false, error } and never throw for expected failures."
    pros:
      - The compiler makes every caller look at the failure case
    cons:
      - More code at each call site
      - Unexpected bugs still throw, so there are two error paths
---

## Context

The app talks to a small HTTP API. On the trail most requests fail because there is no
signal, so failure is normal, not exceptional. We need one convention before more
endpoints are written.

## Option throw: Throw typed errors

```ts
export async function getTrip(id: string): Promise<Trip> {
  const res = await fetch(`/api/trips/${id}`).catch(() => {
    throw new OfflineError();
  });
  if (res.status === 404) throw new NotFoundError(id);
  return res.json();
}
```

## Option result: Return a result object

```ts
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: "offline" | "not_found" | "server" };

export async function getTrip(id: string): Promise<ApiResult<Trip>> {
  const res = await fetch(`/api/trips/${id}`).catch(() => null);
  if (!res) return { ok: false, error: "offline" };
  if (res.status === 404) return { ok: false, error: "not_found" };
  return { ok: true, data: await res.json() };
}
```

## Sources

- TypeScript handbook, discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html
~~~~

After the human picks `result` with a note, president rewrites only the frontmatter:

```yaml
status: resolved
resolution:
  choice: result
  note: Agreed; keep the error codes few.
  resolved_at: 2026-11-10T14:03:00Z
```

## YAML pitfalls

- Quote strings that contain `: ` (colon and space) or start with `[`, `{`, `*`, `&`, `!`, `|`, `>`,
  `'`, `"`, `%` or `@`.
- Quote ids: `id: "0007"`, `depends_on: ["0003"]`.
- For long text use a folded block: `why: >-` followed by indented lines.
- Dates need a timezone when they include a time: `2026-11-10T14:03:00Z`. Don't invent them:
  `date -u +%Y-%m-%dT%H:%M:%SZ` prints the current time in this format.
