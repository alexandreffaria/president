import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAction, type CardAction } from "../src/core/actions.ts";
import { parseCard } from "../src/core/card-file.ts";
import { updateCardText } from "../src/core/card-writer.ts";
import { deepEqual } from "../src/core/equal.ts";
import { agentToken } from "../src/core/pending.ts";
import { cardText, DEMO_PROJECT, diffLines } from "./helpers.ts";

const NOW = new Date("2026-11-10T12:00:00Z");

function parsed(text: string, fileName = "0001-x.md") {
  const result = parseCard(text, fileName);
  if (!result.ok) throw new Error(result.problem.errors.join("; "));
  return result.card;
}

/** Applies an action and writes it, checking that the new text parses to the new data. */
function write(text: string, action: CardAction, fileName = "0001-x.md") {
  const card = parsed(text, fileName);
  const result = applyAction(card, action, NOW);
  if (!result.ok) throw new Error(result.error);
  const out = updateCardText(text, result.raw);
  expect(parsed(out, fileName).raw).toEqual(
    Object.fromEntries(Object.entries(result.raw).filter(([, v]) => v !== undefined)),
  );
  return { before: card.raw, after: result.raw, out };
}

/**
 * The 1-based file lines of each top-level frontmatter key: from its line to the line
 * before the next key (or the closing `---`). Found by text, independently of the writer.
 */
function keyLines(text: string): Map<string, number[]> {
  const lines = text.split("\n");
  const close = lines.indexOf("---", 1);
  const spans = new Map<string, number[]>();
  let current: string | undefined;
  for (let i = 1; i < close; i++) {
    const key = /^([A-Za-z_][\w-]*):/.exec(lines[i] ?? "")?.[1];
    if (key) current = key;
    if (current) spans.set(current, [...(spans.get(current) ?? []), i + 1]);
  }
  return spans;
}

const ACTIONS: CardAction[] = [
  { type: "note", note: "A note from the human." },
  { type: "neither", note: "None of these work offline." },
  { type: "defer", note: "After the launch." },
  { type: "defer" },
  { type: "resolve", choice: "FIRST", note: "Go with it." },
  { type: "resolve", choice: "custom", note: "My own answer." },
  { type: "reopen", note: "Costs changed." },
  { type: "reopen" },
  { type: "applied", token: "TOKEN" },
  { type: "seen", token: "TOKEN" },
];

describe("updateCardText on the demo cards", async () => {
  const dir = join(DEMO_PROJECT, "decisions");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();

  for (const fileName of files) {
    const text = await readFile(join(dir, fileName), "utf8");
    const card = parsed(text, fileName);
    for (const template of ACTIONS) {
      const action =
        template.type === "resolve" && template.choice === "FIRST"
          ? { ...template, choice: card.frontmatter.options[0]?.id ?? "custom" }
          : "token" in template
            ? { ...template, token: agentToken(card) }
            : template;
      const result = applyAction(card, action, NOW);
      // Not possible in this state, or nothing to change (seen with no new feedback).
      if (!result.ok || deepEqual(result.raw, card.raw)) continue;

      it(`${fileName}: ${action.type}${"note" in action && action.note ? " with a note" : ""} changes only the changed fields`, () => {
        const { before, after, out } = write(text, action, fileName);
        const changed = new Set(
          [...Object.keys(before), ...Object.keys(after)].filter(
            (key) => !deepEqual(before[key], after[key]),
          ),
        );
        const spans = keyLines(text);
        const allowed = new Set([...changed].flatMap((key) => spans.get(key) ?? []));
        const { removed, added } = diffLines(text, out);
        // Every line that went away belongs to a field whose value changed...
        expect(removed.filter((r) => !allowed.has(r.line))).toEqual([]);
        // ...and nothing was added that isn't one of those fields.
        expect(added.length).toBeGreaterThan(0);
        // The body is untouched.
        expect(out.slice(out.indexOf("\n---\n", 4))).toBe(text.slice(text.indexOf("\n---\n", 4)));
        // Appending feedback rounds never rewrites the earlier ones.
        if (action.type === "note" || action.type === "neither") {
          expect(removed.filter((r) => !/^(status|needs_new_options):/.test(r.text))).toEqual([]);
        }
      });
    }
  }
});

describe("updateCardText keeps formatting", () => {
  const card = `---
# Written by an agent; keep this comment.
id: "0001"
title: Pick a colour
status: open   # agents: keep open
kind: choice
created: 2026-11-10
created_by: test
tags: [storage, offline]
depends_on: ["0004"]
recommendation:
  option: a
  why: >-
    line one of a folded block
    line two of a folded block
notes: |
  literal
    indented
options:
  - {id: a, title: A}
  - {id: b, title: B}
anchor: &x foo
alias: *x
single: 'single quoted'
feedback:
  # first round
  - at: 2026-11-01
    note: "earlier"   # important
# trailing comment

extra: kept
---

## Context

Body.
`;

  it("adds a feedback round without touching any other line", () => {
    const { out } = write(card, { type: "neither", note: "Neither, sorry." });
    expect(diffLines(card, out)).toEqual({
      removed: [],
      added: [
        "  - at: 2026-11-10T12:00:00Z",
        "    type: neither",
        "    note: Neither, sorry.",
        "needs_new_options: true",
      ],
    });
  });

  it("changes a scalar in place, keeping its comment", () => {
    const { out } = write(card, { type: "defer" });
    expect(diffLines(card, out)).toEqual({
      removed: [{ line: 5, text: "status: open   # agents: keep open" }],
      added: ["status: deferred   # agents: keep open", "defer_until: 2026-11-17T12:00:00Z"],
    });
  });

  it("adds and later removes a resolution as whole lines", () => {
    const resolved = write(card, { type: "resolve", choice: "b", note: "Calmer." }).out;
    expect(diffLines(card, resolved).added).toEqual([
      "status: resolved   # agents: keep open",
      "resolution:",
      "  choice: b",
      "  note: Calmer.",
      "  resolved_at: 2026-11-10T12:00:00Z",
    ]);
    const applied = write(resolved, {
      type: "applied",
      token: agentToken(parsed(resolved)),
    }).out;
    // seen_at is the newest feedback the agent was shown, not the time it ran.
    expect(diffLines(resolved, applied)).toEqual({
      removed: [],
      added: ["applied_at: 2026-11-10T12:00:00Z", "seen_at: 2026-11-01"],
    });
    const reopened = write(applied, { type: "reopen" }).out;
    const diff = diffLines(applied, reopened);
    expect(diff.removed.map((r) => r.text)).toEqual([
      "status: resolved   # agents: keep open",
      "resolution:",
      "  choice: b",
      "  note: Calmer.",
      "  resolved_at: 2026-11-10T12:00:00Z",
      "applied_at: 2026-11-10T12:00:00Z",
    ]);
    expect(diff.added[0]).toBe("status: open   # agents: keep open");
  });

  it("keeps CRLF line endings and the byte order mark", () => {
    const crlf = `﻿${card.replaceAll("\n", "\r\n")}`;
    const { out } = write(crlf, { type: "note", note: "Keep my line endings." });
    expect(out.startsWith("﻿---\r\n")).toBe(true);
    expect(out.replaceAll("\r\n", "")).not.toContain("\n");
    expect(out).toContain("    note: Keep my line endings.\r\n");
    const { out: deferred } = write(crlf, { type: "defer" });
    expect(deferred.replaceAll("\r\n", "")).not.toContain("\n");
    expect(deferred).toContain("status: deferred   # agents: keep open\r\n");
  });

  it("keeps a frontmatter without a trailing body", () => {
    const bare =
      '---\nid: "0001"\ntitle: Pick\nstatus: open\nkind: open\ncreated: 2026-11-10\ncreated_by: t\n---';
    const { out } = write(bare, { type: "resolve", choice: "custom", note: "Green." });
    expect(out.endsWith("  resolved_at: 2026-11-10T12:00:00Z\n---")).toBe(true);
  });

  it("appends to a flow or empty feedback list by rewriting just that field", () => {
    const flow = card.replace(
      /feedback:\n {2}# first round\n {2}- at: 2026-11-01\n {4}note: "earlier" {3}# important\n/,
      "feedback: [{at: 2026-11-01, note: earlier}]\n",
    );
    const { out } = write(flow, { type: "note", note: "Second." });
    expect(diffLines(flow, out).removed.map((r) => r.text)).toEqual([
      "feedback: [{at: 2026-11-01, note: earlier}]",
    ]);
  });

  it("keeps a comment after the last feedback item, adding the new round above it", () => {
    const head = card.split("feedback:")[0] ?? "";
    const commented = `${head}feedback:
  - at: 2026-11-01T00:00:00Z
    note: one
  # more rounds go here
seen_at: 2026-11-02T00:00:00Z
---

## Context
`;
    const { out } = write(commented, { type: "note", note: "Two." });
    const diff = diffLines(commented, out);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([
      "  - at: 2026-11-10T12:00:00Z",
      "    type: note",
      "    note: Two.",
    ]);
    expect(out).toContain("    note: Two.\n  # more rounds go here\nseen_at:");

    // R3-3: the same with CRLF line endings.
    const crlf = commented.replaceAll("\n", "\r\n");
    const { out: crlfOut } = write(crlf, { type: "note", note: "Two." });
    expect(crlfOut).toBe(out.replaceAll("\n", "\r\n"));
  });

  it("keeps the comments after a removed field (R3-7)", () => {
    const head = card.split("feedback:")[0] ?? "";
    const resolved = `${head.replace("status: open", "status: resolved")}resolution:
  choice: a
  resolved_at: 2026-11-03T00:00:00Z
  # agent: applied in docs/decisions.md
# ---- agent bookkeeping ----
mine: 1
---

## Context
`;
    for (const text of [resolved, resolved.replaceAll("\n", "\r\n")]) {
      const { out } = write(text, { type: "reopen" });
      const newline = text.includes("\r\n") ? "\r\n" : "\n";
      expect(out).toContain(
        [
          "single: 'single quoted'",
          "  # agent: applied in docs/decisions.md",
          "# ---- agent bookkeeping ----",
          "mine: 1",
          "feedback:",
        ].join(newline),
      );
      expect(diffLines(text, out).removed.map((r) => r.text.replace(/\r$/, ""))).toEqual([
        "status: resolved   # agents: keep open",
        "resolution:",
        "  choice: a",
        "  resolved_at: 2026-11-03T00:00:00Z",
      ]);
    }
  });

  it("takes indented comments with a removed field only when they'd fall into a block above", () => {
    const text = cardText({
      status: "resolved",
      notes: "|\n  literal text",
      resolution:
        "\n  choice: a\n  resolved_at: 2026-11-03T00:00:00Z\n  # about the resolution\n# kept",
    });
    const { out } = write(text, { type: "reopen" });
    // Kept, "  # about the resolution" would have become a line of `notes`.
    expect(out).toContain("notes: |\n  literal text\n# kept\n");
    expect(parsed(out).raw.notes).toBe("literal text\n");
  });

  it("keeps mixed line endings byte for byte, writing new lines with the usual one", () => {
    const lines = card.split("\n");
    const mixed = lines.map((line, i) => (i % 3 === 0 ? `${line}\r` : line)).join("\n");
    const { out } = write(mixed, { type: "note", note: "Mixed." });
    const kept = mixed.split("\n");
    const outLines = out.split("\n");
    // Every original line is still there, with its own ending.
    expect(outLines.filter((line) => kept.includes(line)).length).toBe(kept.length);
    expect(out).toContain("    note: Mixed.\n");
  });

  it("changes a field whose anchor another field aliases, keeping the alias's value", () => {
    const anchored = card
      .replace("status: open   # agents: keep open", "status: &st open")
      .replace("---\n\n", "mirror: *st\n---\n\n");
    expect(anchored).toContain("mirror: *st");
    const { out, after } = write(anchored, { type: "defer" });
    expect(after.mirror).toBe("open");
    expect(parsed(out).raw).toMatchObject({ status: "deferred", mirror: "open" });

    const aliasedFeedback = card
      .replace("feedback:\n", "feedback: &fb\n")
      .replace("---\n\n", "history: *fb\n---\n\n");
    const noted = write(aliasedFeedback, { type: "note", note: "Two." });
    const raw = parsed(noted.out).raw;
    expect((raw.feedback as unknown[]).length).toBe((raw.history as unknown[]).length + 1);
  });

  // The parser refuses plain text cut by " #" (A); what the hub writes must never be that.
  it("writes a note containing ` #` so that it reads back whole", () => {
    for (const action of [
      { type: "note", note: "Like C # and F #" },
      { type: "resolve", choice: "a", note: "Red # the brand one" },
    ] as const) {
      // write() parses the result (which must be valid) and checks it is exactly the data.
      const { out } = write(card, action);
      expect(out).toContain(JSON.stringify(action.note));
    }
  });

  it("returns the text unchanged when nothing changed", () => {
    expect(updateCardText(card, parsed(card).raw)).toBe(card);
  });
});
