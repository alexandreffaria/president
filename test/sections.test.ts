import { describe, expect, it } from "vitest";
import {
  demoteSectionHeadings,
  replaceOptionSections,
  splitSections,
} from "../src/core/sections.ts";

describe("splitSections", () => {
  // Short cards leave the option sections out; ## Sources must still show below the options.
  it("reads a later section as appendix in a body without option sections", () => {
    expect(splitSections("## Context\n\nWhy.  \n\n## Sources\n\n- a link\n")).toEqual({
      context: "## Context\n\nWhy.",
      options: [],
      appendix: "## Sources\n\n- a link",
    });
    // A first heading other than Context, and a Context heading, stay context; fences count.
    expect(splitSections("## Background\n\nText.\n")).toMatchObject({ appendix: "" });
    expect(splitSections("Intro.\n\n## Context\n\nWhy.\n```\n## Not one\n```\n")).toMatchObject({
      appendix: "",
    });
    expect(splitSections("## Context\n\nWhy.\n\n## Notes\nA.\n\n## Sources\nB.\n").appendix).toBe(
      "## Notes\nA.\n\n## Sources\nB.",
    );
  });

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

  it("treats a body without option headings as context, up to a later section", () => {
    expect(splitSections("Just some words.\n\nMore.")).toEqual({
      context: "Just some words.\n\nMore.",
      options: [],
      appendix: "",
    });
    expect(splitSections("Just some words.\n\n## Notes\n\nMore.")).toEqual({
      context: "Just some words.",
      options: [],
      appendix: "## Notes\n\nMore.",
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

  it("removes the option sections when there are no new ones, and keeps the rest", () => {
    const body = "## Context\n\nWhy.\n\n## Option a\n\nRed.\n\n## Sources\n\n- a link\n";
    expect(replaceOptionSections(body, [])).toBe("## Context\n\nWhy.\n\n## Sources\n\n- a link\n");
    expect(replaceOptionSections("## Context\r\n\r\nWhy.\r\n\r\n## Option a\r\nRed.\r\n", [])).toBe(
      "## Context\r\n\r\nWhy.\r\n",
    );
    expect(replaceOptionSections("## Context\n\nWhy.\n", [])).toBe("## Context\n\nWhy.\n");
  });

  it("adds the sections above the appendix of a body without any", () => {
    const next = replaceOptionSections("## Context\n\nWhy.\n\n## Sources\n\n- a link\n", sections);
    const split = splitSections(next);
    expect(split.context).toBe("## Context\n\nWhy.");
    expect(split.options.map((o) => o.id)).toEqual(["x", "y"]);
    expect(split.appendix).toBe("## Sources\n\n- a link");
  });

  it("adds the sections at the end of a body without any, and keeps CRLF", () => {
    const next = replaceOptionSections("## Context\r\n\r\nWhy.\r\n", sections);
    expect(next).toMatch(/^## Context\r\n\r\nWhy\.\r\n\r\n## Option x: Ex\r\n/);
    expect(splitSections(next).options.map((o) => o.id)).toEqual(["x", "y"]);
  });
});

describe("demoteSectionHeadings", () => {
  it("makes level-2 headings outside fences level 3, and leaves the rest", () => {
    const text =
      "## A\nText ## not a heading\n  ## B ##\n### C\n```\n## code\n```\n~~~\n## tilde\n~~~";
    expect(demoteSectionHeadings(text)).toBe(
      "### A\nText ## not a heading\n  ### B ##\n### C\n```\n## code\n```\n~~~\n## tilde\n~~~",
    );
  });
});
