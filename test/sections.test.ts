import { describe, expect, it } from "vitest";
import { splitSections } from "../src/core/sections.ts";

describe("splitSections", () => {
  it("splits context, option sections and appendix", () => {
    const body = [
      "",
      "## Context",
      "",
      "Background.",
      "",
      "## Option a: Red",
      "",
      "Red is warm.",
      "",
      "### Example",
      "",
      "## Option `b` — Blue",
      "Blue is calm.",
      "",
      "## Sources",
      "",
      "- https://example.com",
      "",
    ].join("\n");
    const sections = splitSections(body);
    expect(sections.context).toBe("## Context\n\nBackground.");
    expect(sections.options).toEqual([
      { id: "a", heading: "Red", markdown: "Red is warm.\n\n### Example", line: 6 },
      { id: "b", heading: "Blue", markdown: "Blue is calm.", line: 12 },
    ]);
    expect(sections.appendix).toBe("## Sources\n\n- https://example.com");
  });

  it("ignores headings inside fenced code blocks", () => {
    const body = "## Option a\n\n```md\n## Option b\n```\n\n~~~\n## Not a heading\n~~~\nend\n";
    const sections = splitSections(body);
    expect(sections.options).toHaveLength(1);
    expect(sections.options[0]?.markdown).toContain("## Option b");
    expect(sections.options[0]?.markdown).toContain("end");
  });

  it("treats a body without option headings as context", () => {
    const sections = splitSections("Just some words.\n\n## Notes\n\nMore.");
    expect(sections).toEqual({
      context: "Just some words.\n\n## Notes\n\nMore.",
      options: [],
      appendix: "",
    });
  });

  it("does not treat level-3 headings as option sections", () => {
    expect(splitSections("### Option a\ntext").options).toEqual([]);
  });
});
