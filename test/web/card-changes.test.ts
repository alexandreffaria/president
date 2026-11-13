/**
 * describeChanges (R3-8): anything an agent changes, except marking feedback read or a
 * decision applied, has to be read again, and is said in words where possible.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CardDetailDto } from "../../src/core/api.ts";
import { parseCard } from "../../src/core/card-file.ts";
import { replaceOptionSections } from "../../src/core/sections.ts";
import { describeChanges } from "../../src/web/card-changes.ts";
import { DEMO_PROJECT } from "../helpers.ts";

const FILE = "0002-api-errors.md";
const original = await readFile(join(DEMO_PROJECT, "decisions", FILE), "utf8");

function card(text: string): CardDetailDto {
  const parsed = parseCard(text, FILE);
  if (!parsed.ok) throw new Error(parsed.problem.errors.join("; "));
  return {
    project: "demo",
    id: parsed.card.id,
    fileName: FILE,
    revision: "r",
    frontmatter: parsed.card.frontmatter,
    body: parsed.card.body,
    sections: parsed.card.sections,
    path: FILE,
    writtenByPresident: false,
    changedBySync: false,
  };
}

const changed = (from: string, to: string) => {
  expect(original).toContain(from);
  return describeChanges(card(original), card(original.replace(from, to)));
};

describe("describeChanges on a withdrawal (#0014)", () => {
  const field = (reason: string) =>
    `status: open\nwithdrawn:\n  at: 2026-11-11T10:00:00Z\n  reason: "${reason}"\n`;
  it("says an agent withdrew the card and why, changed its reason, or took it back", () => {
    expect(changed("status: open\n", field("Moot now."))).toEqual([
      "An agent withdrew it: Moot now.",
    ]);
    const withdrawn = original.replace("status: open\n", field("Moot now."));
    expect(describeChanges(card(withdrawn), card(original))).toEqual([
      "It is no longer withdrawn.",
    ]);
    expect(
      describeChanges(card(withdrawn), card(original.replace("status: open\n", field("Other.")))),
    ).toEqual(["The agent's withdrawal changed: Other."]);
  });
});

describe("describeChanges", () => {
  it("names priority, tags and dependencies", () => {
    expect(changed("priority: normal", "priority: low")).toEqual([
      "It is now low priority (was normal priority).",
    ]);
    expect(changed("tags: [", "tags: [extra, ")).toEqual(["The tags changed."]);
    expect(changed("depends_on: []", 'depends_on: ["0001"]')).toEqual(["It now depends on #0001."]);
  });

  it("reports fields it has no words for, and body text outside the sections", () => {
    expect(changed("created_by:", "estimate: 3\ncreated_by:")).toEqual(["Other details changed."]);
    expect(changed("created_by: claude-code", "created_by: someone-else")).toEqual([
      "Other details changed.",
    ]);
  });

  it("ignores an agent marking feedback read or a decision applied", () => {
    expect(changed("depends_on: []", "depends_on: []\nseen_at: 2026-11-10T00:00:00Z")).toEqual([]);
  });

  it("says which option was decided by its title", () => {
    const decided = original
      .replace("status: open", "status: resolved")
      .replace(
        "depends_on: []",
        "depends_on: []\nresolution:\n  choice: throw\n  resolved_at: 2026-11-10T00:00:00Z",
      );
    expect(describeChanges(card(original), card(decided))).toContain(
      'It was decided: "Throw typed errors".',
    );
  });
});

// Short cards: a new-options run whose options have no details removes the option sections.
// The context and ## Sources stay where they were, so only the options' details changed.
describe("describeChanges when the option sections are removed", () => {
  it("doesn't say the context or the notes below the options changed", () => {
    const before = card(original);
    expect(before.sections.appendix).toMatch(/^## Sources/);
    const after = card(original.replace(before.body, replaceOptionSections(before.body, [])));
    expect(after.sections.options).toEqual([]);
    const changes = describeChanges(before, after);
    expect(changes).not.toContain("The context changed.");
    expect(changes).not.toContain("The notes below the options changed.");
    expect(changes.length).toBe(2);
    expect(changes.every((c) => /changed: details\.$/.test(c))).toBe(true);
  });
});
