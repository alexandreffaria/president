import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  MAX_CARD_BYTES,
  parseCard,
  splitFrontmatter,
  truncatedTexts,
} from "../src/core/card-file.ts";
import { updateCardText } from "../src/core/card-writer.ts";
import { CARD_ID_PATTERN, datedCardId, withdrawalOf } from "../src/core/model.ts";
import { cardText, DEMO_PROJECT, sizedCard } from "./helpers.ts";

function expectErrors(text: string, fileName = "0001-colour.md"): string[] {
  const result = parseCard(text, fileName);
  if (result.ok) throw new Error("expected the card to be invalid");
  return result.problem.errors;
}

function expectCard(text: string, fileName = "0001-colour.md") {
  const result = parseCard(text, fileName);
  if (!result.ok) throw new Error(`expected a valid card: ${result.problem.errors.join("; ")}`);
  return result.card;
}

describe("the demo project", () => {
  it("has only valid cards, covering every kind and status", async () => {
    const dir = join(DEMO_PROJECT, "decisions");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
    const cards = await Promise.all(
      files.map(async (f) => expectCard(await readFile(join(dir, f), "utf8"), f)),
    );
    expect(new Set(cards.map((c) => c.frontmatter.kind))).toEqual(
      new Set(["choice", "ab", "open"]),
    );
    expect(new Set(cards.map((c) => c.frontmatter.status))).toEqual(
      new Set(["open", "deferred", "resolved"]),
    );
  });
});

describe("parseCard", () => {
  it("parses a minimal card and fills defaults", () => {
    const card = expectCard(cardText());
    expect(card.id).toBe("0001");
    expect(card.frontmatter).toMatchObject({
      title: "Pick a colour",
      status: "open",
      kind: "choice",
      priority: "normal",
      tags: [],
      depends_on: [],
      feedback: [],
    });
    expect(card.frontmatter.options[0]).toMatchObject({ id: "a", pros: [], cons: [] });
    // Defaults are not written back into the raw frontmatter.
    expect(card.raw).not.toHaveProperty("tags");
  });

  it("accepts an unquoted numeric id that YAML reads as a number", () => {
    const card = expectCard(cardText({ id: "0001" }));
    expect(card.id).toBe("0001");
    expect(card.frontmatter.id).toBe(1);
  });

  it("keeps unknown fields", () => {
    const card = expectCard(cardText({ estimate: "3 days", extra: "{ nested: [1, 2] }" }));
    expect(card.frontmatter).toMatchObject({ estimate: "3 days", extra: { nested: [1, 2] } });
  });

  it("accepts CRLF line endings and a byte order mark", () => {
    const card = expectCard(`﻿${cardText().replaceAll("\n", "\r\n")}`);
    expect(card.frontmatter.title).toBe("Pick a colour");
  });

  it("rejects a bad file name", () => {
    expect(expectErrors(cardText(), "Colour Card.md")[0]).toMatch(/file name/);
  });

  it("rejects a file without frontmatter", () => {
    expect(expectErrors("# Just markdown\n")[0]).toMatch(
      /must start with a line containing only `---`/,
    );
    expect(expectErrors("---\ntitle: never closed\n")[0]).toMatch(/must start/);
  });

  it("reports YAML syntax errors with the file line number", () => {
    const errors = expectErrors(cardText({ title: "Pick: a colour: now" }));
    expect(errors[0]).toMatch(/^YAML error on line 3:/);
  });

  it("rejects frontmatter that is not a mapping", () => {
    expect(expectErrors("---\n- a\n- b\n---\n")[0]).toMatch(/must be a YAML mapping/);
    expect(expectErrors("---\n---\nbody\n")[0]).toMatch(/must be a YAML mapping/);
  });

  it("names missing required fields", () => {
    const errors = expectErrors(cardText({ title: "", created_by: "" }));
    expect(errors).toContain("title: is required");
    expect(errors).toContain("created_by: is required");
  });

  it("validates enums and dates", () => {
    const errors = expectErrors(
      cardText({ status: "done", kind: "poll", priority: "urgent", created: "yesterday" }),
    );
    expect(errors.some((e) => e.startsWith("status:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("kind:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("priority:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("created:"))).toBe(true);
  });

  it("checks that the id matches the file name", () => {
    expect(expectErrors(cardText({ id: '"0002"' }))[0]).toMatch(/does not match the file name/);
  });

  it("enforces option counts per kind", () => {
    const three = `
  - id: a
    title: A
  - id: b
    title: B
  - id: c
    title: C`;
    expect(expectErrors(cardText({ kind: "ab", options: three }))[0]).toMatch(
      /kind "ab" needs exactly 2 options, found 3/,
    );
    expect(expectErrors(cardText({ options: "[{ id: a, title: A }]" }))[0]).toMatch(
      /kind "choice" needs at least 2 options/,
    );
    expectCard(cardText({ kind: "open", options: "" }));
  });

  it("rejects duplicate, malformed and reserved option ids", () => {
    const errors = expectErrors(
      cardText({
        options: `
  - id: a
    title: A
  - id: a
    title: Again
  - id: Bad Id
    title: B
  - id: custom
    title: C`,
      }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/options\[1\]\.id: duplicate option id "a"/),
        expect.stringMatching(/options\[2\]\.id: option ids are short lowercase slugs/),
      ]),
    );
    expect(errors.join("\n")).toMatch(/"custom" is reserved/);
  });

  it("checks that the recommendation names an option", () => {
    const errors = expectErrors(cardText({ recommendation: "{ option: c, why: Because }" }));
    expect(errors[0]).toMatch(
      /recommendation\.option: recommends "c", which is not an option id \("a", "b"\)/,
    );
  });

  it("keeps status and resolution consistent", () => {
    expect(expectErrors(cardText({ status: "resolved" }))[0]).toMatch(/no resolution/);
    const resolution = "{ choice: a, resolved_at: 2026-11-10T10:00:00Z }";
    expect(expectErrors(cardText({ resolution }))[0]).toMatch(
      /has a resolution but status is "open"/,
    );
    expectCard(cardText({ status: "resolved", resolution }));
    expect(
      expectErrors(
        cardText({ status: "resolved", resolution: "{ choice: z, resolved_at: 2026-11-10 }" }),
      )[0],
    ).toMatch(/"z" is not an option id/);
    expect(
      expectErrors(
        cardText({ status: "resolved", resolution: "{ choice: custom, resolved_at: 2026-11-10 }" }),
      )[0],
    ).toMatch(/needs a note/);
  });

  it("flags body option sections that don't match an option", () => {
    const body = "\n## Context\n\nx\n\n## Option a\n\nRed.\n\n## Option z: Zebra\n\nNope.\n";
    expect(expectErrors(cardText({}, body))[0]).toMatch(
      /"## Option z" \(line 24\) does not match any option id/,
    );
  });
});

describe("splitFrontmatter", () => {
  it("returns the body verbatim", () => {
    const split = splitFrontmatter("---\na: 1\n---\n\n# Body\n---\nmore\n");
    expect(split).toEqual({
      yaml: "a: 1\n",
      body: "\n# Body\n---\nmore\n",
      yamlStart: 4,
      yamlEnd: 9,
      yamlStartLine: 2,
      bodyStartLine: 4,
    });
  });
});

describe("updateCardText (round trips)", () => {
  const original = `---
# Written by an agent; keep this comment.
id: "0001"
title: Pick a colour
status: open
kind: choice
created: 2026-11-10
created_by: test
estimate: { days: 3 }   # unknown field
options:
  - id: a
    title: Red
    vendor_note: unknown nested field
  - id: b
    title: Blue
---

## Context

Body stays exactly the same.
`;

  it("writes back an unchanged card byte for byte", () => {
    const card = expectCard(original);
    expect(updateCardText(original, card.raw)).toBe(original);
  });

  it("keeps comments, unknown fields and the body when a field changes", () => {
    const card = expectCard(original);
    const updated = updateCardText(original, { ...card.raw, status: "deferred" });
    expect(updated).toContain("# Written by an agent; keep this comment.");
    expect(updated).toContain("estimate: { days: 3 }   # unknown field");
    expect(updated).toContain("vendor_note: unknown nested field");
    expect(updated).toContain("status: deferred");
    expect(updated.endsWith("## Context\n\nBody stays exactly the same.\n")).toBe(true);
    const reparsed = expectCard(updated);
    expect(reparsed.frontmatter.status).toBe("deferred");
    expect(reparsed.raw.estimate).toEqual({ days: 3 });
  });

  it("adds and removes fields", () => {
    const card = expectCard(original);
    const { estimate: _removed, ...rest } = card.raw;
    const updated = updateCardText(original, { ...rest, needs_new_options: true });
    expect(updated).not.toContain("estimate");
    expect(expectCard(updated).frontmatter.needs_new_options).toBe(true);
  });
});

describe("docs/card-format.md", () => {
  it("contains a full example that is a valid card", async () => {
    const spec = await readFile(join(import.meta.dirname, "..", "docs", "card-format.md"), "utf8");
    const example = /## Full example\n\n~~~~markdown\n([\s\S]*?)\n~~~~\n/.exec(spec)?.[1];
    expect(example).toBeDefined();
    const card = expectCard(`${example}\n`, "0002-api-errors.md");
    expect(card.frontmatter.kind).toBe("ab");
    expect(card.sections.options.map((o) => o.id)).toEqual(["throw", "result"]);
  });

  // An agent copies these snippets; none may show a comment that would cut its text (A).
  it("shows no comment that cuts text in its YAML snippets, nor does SKILL.md", async () => {
    const snippets: string[] = [];
    for (const file of [
      join(import.meta.dirname, "..", "docs", "card-format.md"),
      join(import.meta.dirname, "..", "skills", "decision-cards", "SKILL.md"),
    ]) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/^( *)```yaml\n([\s\S]*?)\n\1```$/gm)) {
        snippets.push((match[2] ?? "").replace(new RegExp(`^${match[1]}`, "gm"), ""));
      }
    }
    expect(snippets.length).toBeGreaterThanOrEqual(5);
    // Comments after an id, a type and a choice stay in them, and are allowed (F-1).
    expect(snippets.join("\n")).toMatch(
      /- id: result +# .*\n[\s\S]*type: neither +# [\s\S]*choice: action +# /,
    );
    for (const yaml of snippets) {
      const doc = parseDocument(yaml);
      expect(doc.errors).toEqual([]);
      expect(truncatedTexts(doc, yaml, (offset) => offset)).toEqual([]);
    }
    // The rule in one line of the skill, and the check is real on a snippet that breaks it.
    const skill = await readFile(
      join(import.meta.dirname, "..", "skills", "decision-cards", "SKILL.md"),
      "utf8",
    );
    expect(skill.replace(/\s+/g, " ")).toContain("quote any text containing ` #` or `: `");
    const bad = "resolution:\n  choice: action  # an option id\n  note: Keep it short  # 8 words\n";
    expect(truncatedTexts(parseDocument(bad), bad, (offset) => offset)).toEqual([
      expect.stringMatching(/^resolution\.note: the text stops at "Keep it short"/),
    ]);
  });
});

describe("dated ids (#0013)", () => {
  it("accepts a dated id, which sorts after numbered ones", () => {
    const card = expectCard(cardText({ id: '"20261111k7q2"' }), "20261111k7q2-sync-shortcut.md");
    expect(card.id).toBe("20261111k7q2");
    expect(["20261111k7q2-a.md", "0013-b.md"].sort()).toEqual(["0013-b.md", "20261111k7q2-a.md"]);
  });

  it("makes a valid dated id with the command the docs and the skill give", async () => {
    for (const file of [
      join(import.meta.dirname, "..", "docs", "card-format.md"),
      join(import.meta.dirname, "..", "skills", "decision-cards", "SKILL.md"),
    ]) {
      const text = await readFile(file, "utf8");
      const command = /^ *(echo "\$\(date -u \+%Y%m%d\).*urandom.*)$/m.exec(text)?.[1];
      expect(command, file).toBeDefined();
      const today = () => new Date().toISOString().slice(0, 10);
      const before = today();
      const { stdout } = await promisify(execFile)("sh", ["-c", command ?? ""]);
      const id = stdout.trim();
      expect(id).toMatch(CARD_ID_PATTERN);
      // Either side of a UTC midnight.
      expect([before, today()]).toContain(datedCardId(id)?.date);
    }
  });

  it("asks for quotes when YAML reads an unquoted dated id as another number", () => {
    expect(expectErrors(cardText({ id: "20261111e123" }), "20261111e123-a.md")).toEqual([
      expect.stringMatching(
        /^id: YAML reads 20261111e123 as the number .*; write ids in quotes: id: "20261111e123"$/,
      ),
    ]);
    expect(expectErrors(cardText({ id: "20261111e001" }), "20261111e001-a.md")).toEqual([
      expect.stringMatching(
        /^id: YAML reads 20261111e001 as the number 202611110 .*id: "20261111e001"$/,
      ),
    ]);
    expect(
      expectErrors(
        cardText({ id: '"20261111k7q2"', depends_on: "[0001, 20261111e002]" }),
        "20261111k7q2-a.md",
      ),
    ).toEqual([
      expect.stringMatching(
        /^depends_on\[1\]: YAML reads 20261111e002 .*depends_on: \["20261111e002"\]$/,
      ),
    ]);
    // Digits only read back as the same id.
    expect(expectCard(cardText({ id: "202611111234" }), "202611111234-a.md").id).toBe(
      "202611111234",
    );
    // Text that wouldn't be a valid id even in quotes is left as before.
    expect(expectCard(cardText({ id: "+9" }), "9-a.md").id).toBe("9");
  });

  it("gives the short form of a dated id and its date, and nothing for other ids", () => {
    expect(datedCardId("20261111k7q2")).toEqual({ short: "k7q2", date: "2026-11-11" });
    expect(datedCardId("202611116ff6")).toEqual({ short: "6ff6", date: "2026-11-11" });
    for (const id of [
      "0013",
      "0001",
      "20261111k7q",
      "20261111k7q2x",
      "20261341k7q2",
      "abcd1111k7q2",
    ]) {
      expect(datedCardId(id), id).toBeUndefined();
    }
  });
});

describe("the withdrawn field (#0014)", () => {
  const withdrawn = `
  at: 2026-11-14T10:00:00Z
  reason: "The queue was rewritten in #0015; dependencies no longer affect ordering."`;

  it("accepts a withdrawal on an open, a deferred or a decided card, and keeps the status", () => {
    for (const status of ["open", "deferred"]) {
      const card = expectCard(cardText({ status, withdrawn }));
      expect(card.frontmatter.status).toBe(status);
      expect(withdrawalOf(card.frontmatter)).toEqual({
        at: "2026-11-14T10:00:00Z",
        reason: "The queue was rewritten in #0015; dependencies no longer affect ordering.",
      });
    }
    // The human can still decide a withdrawn card; the decision keeps the field.
    const decided = expectCard(
      cardText({
        status: "resolved",
        withdrawn,
        resolution: "\n  choice: a\n  resolved_at: 2026-11-15T10:00:00Z",
      }),
    );
    expect(withdrawalOf(decided.frontmatter)?.reason).toMatch(/^The queue/);
    expect(withdrawalOf(expectCard(cardText()).frontmatter)).toBeUndefined();
  });

  it("needs a timestamp and a reason", () => {
    expect(expectErrors(cardText({ withdrawn: "\n  at: 2026-11-14T10:00:00Z" }))).toEqual([
      "withdrawn.reason: is required (line 15)",
    ]);
    expect(expectErrors(cardText({ withdrawn: '\n  at: yesterday\n  reason: "  "' }))).toEqual([
      expect.stringMatching(/^withdrawn\.at: expected a date/),
      expect.stringMatching(/^withdrawn\.reason: must not be empty/),
    ]);
    expect(expectErrors(cardText({ withdrawn: "true" }))[0]).toMatch(/^withdrawn: /);
  });

  it("reports a reason cut by an unquoted comment, as for other free text", () => {
    expect(
      expectErrors(cardText({ withdrawn: "\n  at: 2026-11-14\n  reason: Dropped # see #0015" })),
    ).toEqual([
      'withdrawn.reason: the text stops at "Dropped" because " #" starts a YAML comment (line 16); put the whole text in quotes: reason: "Dropped # see #0015"',
    ]);
  });
});

describe("the chat feedback type (#0023)", () => {
  it("accepts a conversation summary entry", () => {
    const card = expectCard(
      cardText({
        feedback:
          "\n  - at: 2026-11-12T09:14:00Z\n    type: chat\n    note: I now see that B's extra code is one line per call with a helper.",
      }),
    );
    expect(card.frontmatter.feedback[0]?.type).toBe("chat");
    expect(
      expectErrors(cardText({ feedback: "\n  - at: 2026-11-12\n    type: talk\n    note: x" }))[0],
    ).toMatch(/^feedback\[0\]\.type: /);
  });
});

describe("error messages", () => {
  it("says a missing date is required rather than malformed", () => {
    const errors = expectErrors(cardText({ created: "" }));
    expect(errors).toEqual(["created: is required"]);
  });
});

describe("parseCard never throws", () => {
  it("reports YAML with too many aliases as a broken card", () => {
    const lines = ['a: &a ["x","x","x","x","x","x","x","x","x","x"]'];
    const names = "abcdefgh";
    for (let i = 1; i < names.length; i++) {
      lines.push(
        `${names[i]}: &${names[i]} [${Array(10)
          .fill(`*${names[i - 1]}`)
          .join(",")}]`,
      );
    }
    const errors = expectErrors(`---\n${lines.join("\n")}\n---\n`);
    expect(errors[0]).toMatch(/^YAML error: Excessive alias count/);
  });

  it("refuses a file that is too large to be a card", () => {
    const huge = cardText({}, `\n${"x".repeat(MAX_CARD_BYTES)}\n`);
    expect(expectErrors(huge)[0]).toMatch(/cards must be at most 1024 kB/);
  });

  // Rounded up, so a file just over the limit doesn't read as being at it (R7-10).
  it("takes a card of exactly the limit and refuses one byte more", () => {
    const at = sizedCard(MAX_CARD_BYTES);
    expect(new TextEncoder().encode(at).length).toBe(MAX_CARD_BYTES);
    expect(parseCard(at, "0001-colour.md").ok).toBe(true);
    expect(expectErrors(sizedCard(MAX_CARD_BYTES + 1))[0]).toBe(
      "the file is 1025 kB; cards must be at most 1024 kB",
    );
  });

  it("measures the size in bytes, as the hub does, not in characters (R6-8)", () => {
    // 400,000 characters of 3 bytes each: 1,200,000 bytes and more on disk.
    const wide = cardText({}, `\n${"界".repeat(400_000)}\n`);
    expect(wide.length).toBeLessThan(MAX_CARD_BYTES);
    expect(expectErrors(wide)[0]).toBe("the file is 1173 kB; cards must be at most 1024 kB");
  });

  it("says a list or mapping can't be a key, without printing a warning (R3-12)", () => {
    const errors = expectErrors(cardText().replace("\n---\n", "\n? [a, b]\n: c\n---\n"));
    expect(errors).toEqual([
      expect.stringMatching(
        /^frontmatter keys must be plain names, not lists or mappings \(line \d+\)$/,
      ),
    ]);
  });

  it("says a number, true/false or null can't be a key (R4-8)", () => {
    const keyError = (key: string) =>
      expectErrors(cardText().replace("\n---\n", `\n${key}: x\n---\n`));
    for (const key of ["2026", "true", "False", "~", "null", "1.5"]) {
      expect(keyError(key)).toEqual([
        expect.stringMatching(
          new RegExp(
            `^frontmatter keys must be plain names, not numbers, true/false or null like ${key.replace(".", "\\.")} \\(line 14\\)$`,
          ),
        ),
      ]);
    }
    // No key at all (": x") is a null key.
    expect(keyError("")[0]).toMatch(/^frontmatter keys must be plain names, not numbers/);
    // A quoted key is a name.
    expectCard(cardText({ '"2026"': "planning" }));
  });

  it("survives hostile and odd YAML", () => {
    const inputs = [
      "---\n!!binary x: 1\n---\n",
      "---\n? [a, b]\n: c\n---\n",
      "---\n<<: *missing\n---\n",
      "---\nid: !!int nope\n---\n",
      "---\na: &x [*x]\n---\n",
      `---\n${"[".repeat(5000)}\n---\n`,
      "---\n\u0000\n---\n",
    ];
    for (const input of inputs) {
      const result = parseCard(input, "0001-x.md");
      expect(result.ok, input.slice(0, 40)).toBe(false);
    }
  });
});

describe("validation details", () => {
  it("gives the file line of a schema error", () => {
    const errors = expectErrors(
      cardText({
        options: `
  - id: a
    title: Red
    pros: just a string
  - id: b
    title: Blue`,
      }),
    );
    expect(errors).toEqual([
      "options[0].pros: Invalid input: expected array, received string (line 12)",
    ]);
  });

  it("rejects impossible dates", () => {
    for (const date of [
      "2026-02-30",
      "2026-13-01",
      "2026-04-31T10:00:00Z",
      "2026-11-10T25:00:00Z",
    ]) {
      expect(expectErrors(cardText({ created: date }))[0], date).toMatch(
        /^created: expected a date/,
      );
    }
    expectCard(cardText({ created: "2028-02-29" }));
    expectCard(cardText({ created: "2026-11-10T14:03:00+05:30" }));
  });

  it("rejects applied_at before a card is resolved", () => {
    expect(expectErrors(cardText({ applied_at: "2026-11-10" }))[0]).toMatch(
      /^applied_at: only resolved cards can be applied, but status is "open"/,
    );
    expect(expectErrors(cardText({ status: "deferred", applied_at: "2026-11-10" }))[0]).toMatch(
      /status is "deferred"/,
    );
  });

  it("rejects needs_new_options on a resolved card", () => {
    const resolved = {
      status: "resolved",
      resolution: "{ choice: a, resolved_at: 2026-11-10 }",
      needs_new_options: "true",
    };
    expect(expectErrors(cardText(resolved))[0]).toMatch(/^needs_new_options: a resolved card/);
    expectCard(cardText({ needs_new_options: "true" }));
  });

  it("matches ids numerically only for unquoted numbers", () => {
    expectCard(cardText({ id: "1" }));
    expect(expectErrors(cardText({ id: '"1"' }))[0]).toMatch(/does not match the file name/);
    expect(expectErrors(cardText({ id: '"01"' }))[0]).toMatch(/does not match the file name/);
  });

  it("rejects placeholders copied from the template", () => {
    const errors = expectErrors(
      cardText(
        {
          options: `
  - id: a
    title: Red
    summary: ...
    pros: [...]
  - id: b
    title: Blue`,
        },
        "\n## Context\n\n...\n\n## Option b: Blue\n\n...\n",
      ),
    );
    expect(errors).toEqual([
      'options[0].summary: "..." is a placeholder from the template; write the real text (line 12)',
      'options[0].pros[0]: "..." is a placeholder from the template; write the real text (line 13)',
      'body: the "## Option b" section (line 22) is only "..."; write the real content',
      'body: the context (line 18) is only "..."; write the real content',
    ]);
    // An ellipsis inside real text is fine.
    expectCard(cardText({ title: '"Wait... which colour?"' }));
  });
});

describe("messages for common YAML slips (R5-14)", () => {
  const options = `
  - id: a
    title: Red
  - id: b
    title: Blue`;

  it("says to quote a value with a colon in it, and names the field", () => {
    expect(expectErrors(cardText({ title: "Copy: what should it say?" }))).toEqual([
      'YAML error on line 3: title: the value contains ": ", so YAML can\'t read it; put it in quotes: title: "Copy: what should it say?"',
    ]);
    const inList = (pros: string) =>
      expectErrors(
        cardText({ options: options.replace("title: Red", `title: Red\n    pros: ${pros}`) }),
      );
    for (const pros of ["[Shorter: fits on one line]", "\n      - Shorter: fits on one line"]) {
      expect(inList(pros)).toEqual([
        expect.stringMatching(
          /^options\[0\]\.pros\[0\]: expected text, but YAML read a "key: value" pair because the text contains ": "; put the whole text in quotes \(line 1[23]\)$/,
        ),
      ]);
    }
  });

  // An unquoted " #" makes the rest of the line a comment, and the text is silently cut (A).
  it("says to quote text that a ` #` cut off, with the line", () => {
    expect(expectErrors(cardText({ title: "Should we write it in C # or Rust?" }))).toEqual([
      'title: the text stops at "Should we write it in C" because " #" starts a YAML comment (line 3); put the whole text in quotes: title: "Should we write it in C # or Rust?"',
    ]);
    const errors = expectErrors(
      cardText({
        options: options
          .replace(
            "title: Red",
            "title: Red\n    summary: Uses #ff0000 # the brand red\n    pros:\n      - Loud # really",
          )
          .replace("id: b", "id: b # the blue one"),
        recommendation: "\n  option: a\n  why: It is the brand colour # see the guide",
        feedback:
          "\n  - at: 2026-11-10T00:00:00Z\n    note: Use plain\n      text # cut on the second line",
      }),
    );
    expect(errors).toEqual([
      'options[0].summary: the text stops at "Uses" because " #" starts a YAML comment (line 12); put the whole text in quotes: summary: "Uses #ff0000 # the brand red"',
      'options[0].pros[0]: the text stops at "Loud" because " #" starts a YAML comment (line 14); put the whole text in quotes',
      'recommendation.why: the text stops at "It is the brand colour" because " #" starts a YAML comment (line 19); put the whole text in quotes: why: "It is the brand colour # see the guide"',
      'feedback[0].note: the text stops at "Use plain text" because " #" starts a YAML comment (line 23); put the whole text in quotes',
    ]);
    // Inside a resolution too, and alongside the schema's own errors.
    const resolved = expectErrors(
      cardText({
        status: "resolved",
        resolution:
          "\n  choice: a # red\n  note: Kept it # for now\n  resolved_at: 2026-11-10T00:00:00Z",
      }),
    );
    expect(resolved).toEqual([
      'resolution.note: the text stops at "Kept it" because " #" starts a YAML comment (line 16); put the whole text in quotes: note: "Kept it # for now"',
    ]);
    expect(
      expectErrors(cardText({ title: "Pick # one", kind: "nope" })).map((e) => e.split(":")[0]),
    ).toEqual(["title", "kind"]);
  });

  // The other free text, and text an alias brings into a free-text field (F-3).
  it("says to quote a cut created_by, tag, earlier resolution's note or aliased text", () => {
    const errors = expectErrors(
      cardText({
        created_by: "claude # opus",
        tags: "\n  - C # language\n  - ok",
        x: "&question Write it in C # or Rust?",
        feedback: `
  - at: 2026-11-10T00:00:00Z
    type: reopen
    note: Reopened.
    previous_resolution:
      choice: a # red
      note: Cost matters # most
      resolved_at: 2026-11-03T16:20:00Z`,
        recommendation: "\n  option: a\n  why: *question",
      }),
    );
    expect(errors).toEqual([
      'created_by: the text stops at "claude" because " #" starts a YAML comment (line 8); put the whole text in quotes: created_by: "claude # opus"',
      'tags[0]: the text stops at "C" because " #" starts a YAML comment (line 15); put the whole text in quotes',
      'feedback[0].previous_resolution.note: the text stops at "Cost matters" because " #" starts a YAML comment (line 24); put the whole text in quotes: note: "Cost matters # most"',
      'recommendation.why: the text stops at "Write it in C" because " #" starts a YAML comment (line 17); put the whole text in quotes',
    ]);
  });

  it("keeps comments that cut nothing", () => {
    const card = expectCard(
      cardText({
        title: '"Should we write it in C # or Rust?"   # quoted, so the comment cuts nothing',
        options: `   # the options
  # on their own line
  - id: 'a'   # quoted
    title: Red#ff0000
    summary: >-   # a block header
      Folded # not a comment
    pros:   # the list starts on the next line
      - Loud
  # between items
  - id: b
    title: Blue`,
        recommendation: "# whole line\n  option: a\n  why: |\n    Literal # text",
        status: "open   # outside the text fields",
        tags: "[a, b] # a flow list",
      }),
    );
    expect(card.frontmatter.title).toBe("Should we write it in C # or Rust?");
    expect(card.frontmatter.options[0]).toMatchObject({
      id: "a",
      title: "Red#ff0000",
      summary: "Folded # not a comment",
      pros: ["Loud"],
    });
    expect(card.frontmatter.recommendation?.why).toBe("Literal # text");
  });

  // Ids, choices, types and timestamps can't contain " #", so a comment after them cuts
  // nothing; the docs' own snippets show one (F-1).
  it("keeps a comment after an id, a choice, a type or a timestamp", () => {
    const open = expectCard(
      cardText({
        options: `
  - id: result          # short lowercase slug: a, b, c or a word; unique; not "custom"
    title: Return a result object
  - id: b # the blue one
    title: Blue`,
        recommendation: "\n  option: result  # the pick\n  why: It is simpler.",
        feedback: `
  - at: 2026-11-05T18:40:00Z  # round 1
    type: neither        # neither | note | defer | reopen | undo
    note: Both options assume a server.`,
        created: "2026-11-01T09:00:00Z   # when",
        extra: "~ # a field president doesn't know",
      }),
    );
    expect(open.frontmatter.options.map((o) => o.id)).toEqual(["result", "b"]);
    expect(open.frontmatter.recommendation?.option).toBe("result");
    expect(open.frontmatter.feedback[0]).toMatchObject({
      at: "2026-11-05T18:40:00Z",
      type: "neither",
    });
    const resolved = expectCard(
      cardText({
        status: "resolved",
        resolution: `
  choice: a          # an option id, or "custom" with the answer in the note
  note: Keep it under 8 words.
  resolved_at: 2026-11-10T15:20:00Z  # just now`,
      }),
    );
    expect(resolved.frontmatter.resolution).toMatchObject({
      choice: "a",
      resolved_at: "2026-11-10T15:20:00Z",
    });
  });

  it("reports one error for a tab in the indentation", () => {
    expect(
      expectErrors(cardText({ options: options.replace("    title: Red", "\t  title: Red") })),
    ).toEqual(["YAML error on line 11: Tabs are not allowed as indentation; indent with spaces"]);
  });

  it("says a timestamp needs a timezone", () => {
    expect(expectErrors(cardText({ created: "2026-11-10T23:54:53" }))).toEqual([
      "created: a timestamp needs a timezone, e.g. 2026-11-10T23:54:53Z (line 7)",
    ]);
    expect(expectErrors(cardText({ created: "next week" }))[0]).toMatch(/expected a date like/);
  });

  it("gives the line of a second option section, an empty context and a leftover section", () => {
    const body =
      "\n## Context\n\n...\n\n## Option a\n\nx\n\n## Option a\n\ny\n\n## Sources\n\n- ...\n";
    expect(expectErrors(cardText({}, body))).toEqual([
      'body: there are two "## Option a" sections (the second on line 24)',
      'body: the context (line 16) is only "..."; write the real content',
      'body: the "## Sources" section (line 28) is only "..."; write the real content or remove the section',
    ]);
  });
});

describe("skills/decision-cards/SKILL.md", async () => {
  const skill = await readFile(
    join(import.meta.dirname, "..", "skills", "decision-cards", "SKILL.md"),
    "utf8",
  );

  const template = /^````markdown\n([\s\S]*?)\n````$/m.exec(skill)?.[1] ?? "";

  it("has a template that validate refuses until the placeholders are replaced", () => {
    expect(template).not.toBe("");
    const errors = expectErrors(`${template}\n`, "20261110q4m8-empty-state-copy.md");
    expect(errors.every((e) => /placeholder|only "\.\.\."/.test(e))).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  // An agent that replaces only the `...` must not leave the template's instructions in the
  // card (R5-13): every value and section meant for the agent's own text is a placeholder.
  it("has no instructions written as values in its template", () => {
    const filled = template.replaceAll("...", "Real text");
    const card = expectCard(`${filled}\n`, "20261110q4m8-empty-state-copy.md");
    const { recommendation, options } = card.frontmatter;
    expect(recommendation?.why).toBe("Real text");
    for (const option of options) {
      expect([option.summary, ...option.pros, ...option.cons]).toEqual(Array(3).fill("Real text"));
    }
    const sectionTexts = template
      .split(/^## .*$/m)
      .slice(1)
      .map((text) => text.trim());
    // Only Context: option sections are optional and there is no Sources list (short cards).
    expect(sectionTexts).toEqual(["..."]);
  });

  // The filled-in example models a short card: valid, every option with a con, at most 2 pros
  // and 2 cons, and well under the skill's 250-word budget.
  it("has a filled-in example that is a valid, short card", () => {
    const example = /^~~~~markdown\n([\s\S]*?)\n~~~~$/m.exec(skill)?.[1];
    expect(example).toBeDefined();
    const card = expectCard(`${example}\n`, "20261110q4m8-empty-state-copy.md");
    for (const option of card.frontmatter.options) {
      expect(option.pros.length).toBeLessThanOrEqual(2);
      expect(option.cons.length).toBeGreaterThanOrEqual(1);
      expect(option.cons.length).toBeLessThanOrEqual(2);
    }
    expect(example?.split(/\s+/).length).toBeLessThan(250);
  });

  // A rewrite made again from a card deferred meanwhile keeps "deferred" (R8-5).
  it("says to keep a rewritten card's status as it is, not to set one", () => {
    expect(skill).toContain(
      "Keep `feedback`, `id`, `created`, `status` and `defer_until` as they are.",
    );
    expect(skill).not.toMatch(/Keep [^.]*`status: \w+`/);
  });

  it("has an open card example that is valid", () => {
    const example = /^ {3}```markdown\n([\s\S]*?)\n {3}```$/m.exec(skill)?.[1];
    expect(example).toBeDefined();
    const card = expectCard(`${example?.replace(/^ {3}/gm, "")}\n`, "20261110w2zd-first-run.md");
    expect(card.frontmatter.kind).toBe("open");
  });
});
