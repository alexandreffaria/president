import { describe, expect, it } from "vitest";
import { replaceOptionSections, splitSections } from "../src/core/sections.ts";

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

describe("splitSections follows CommonMark", () => {
  it("does not close a fence on a line with an info string", () => {
    expect(splitSections("## Context\n```\n```js\n## Option a\n```\n").options).toEqual([]);
  });

  it("closes a fence only with the same character and at least the same length", () => {
    const body = "````md\n```\n## Option a\n~~~~\n````\n## Option b\n";
    expect(splitSections(body).options.map((o) => o.id)).toEqual(["b"]);
  });

  it("needs a space after ##", () => {
    expect(splitSections("##Option b\n\ny\n").options).toEqual([]);
  });

  it("accepts headings indented up to three spaces and closing hashes", () => {
    const body = "   ## Option c\nz\n    ## Option d\n## Option e ##\n";
    expect(splitSections(body).options.map((o) => [o.id, o.markdown])).toEqual([
      ["c", "z\n    ## Option d"],
      ["e", ""],
    ]);
  });

  it("ignores headings in a backtick fence whose info string has backticks", () => {
    // "```a`b" is not a fence opener, so the heading below it is real.
    expect(splitSections("```a`b\n## Option a\n").options.map((o) => o.id)).toEqual(["a"]);
  });
});

describe("replaceOptionSections (#0007's new options)", () => {
  const sections = [
    { id: "x", title: "Ex", markdown: "X is new." },
    { id: "y", title: "Why", markdown: "```\n## Option z\n```" },
  ];

  it("replaces the option sections and keeps the context and the appendix", () => {
    const body = [
      "",
      "## Context",
      "",
      "Background.",
      "",
      "## Option a: Red",
      "",
      "```md",
      "## Sources (in a fence)",
      "```",
      "",
      "## Option b",
      "Blue.",
      "",
      "## Sources",
      "",
      "- a link",
      "",
    ].join("\n");
    const next = replaceOptionSections(body, sections);
    const split = splitSections(next);
    expect(split.context).toBe("## Context\n\nBackground.");
    expect(split.options.map((o) => [o.id, o.heading, o.markdown])).toEqual([
      ["x", "Ex", "X is new."],
      ["y", "Why", "```\n## Option z\n```"],
    ]);
    expect(split.appendix).toBe("## Sources\n\n- a link");
    expect(next).not.toContain("Blue.");
  });

  it("adds the sections at the end of a body without any, and keeps CRLF", () => {
    const next = replaceOptionSections("## Context\r\n\r\nWhy.\r\n", sections);
    expect(next).toMatch(/^## Context\r\n\r\nWhy\.\r\n\r\n## Option x: Ex\r\n/);
    expect(splitSections(next).options.map((o) => o.id)).toEqual(["x", "y"]);
  });
});
