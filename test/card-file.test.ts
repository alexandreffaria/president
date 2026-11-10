import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCard, renderCard, splitFrontmatter, updateCardText } from "../src/core/card-file.ts";
import { cardText, DEMO_PROJECT } from "./helpers.ts";

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
    expect(updated).toContain("estimate: { days: 3 } # unknown field");
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

  it("renders a new card that parses back to the same data", () => {
    const raw = expectCard(original).raw;
    const text = renderCard(raw, "\nBody\n");
    expect(expectCard(text).raw).toEqual(raw);
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
});
