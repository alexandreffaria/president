/**
 * WCAG AA contrast for the UI's color tokens, in the light and the dark theme:
 * 4.5:1 for text, 3:1 for the boundaries of controls, focus rings and status dots.
 * The pairs below are the ones styles.css actually puts on top of each other.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = await readFile(join(import.meta.dirname, "..", "src", "web", "styles.css"), "utf8");

function tokens(block: string | undefined): Record<string, string> {
  return Object.fromEntries(
    [...(block ?? "").matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [
      m[1] as string,
      m[2] as string,
    ]),
  );
}

const light = tokens(/^:root \{([\s\S]*?)^\}/m.exec(css)?.[1]);
const dark = {
  ...light,
  ...tokens(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)^ {2}\}/m.exec(css)?.[1]),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const TEXT = 4.5;
const UI = 3;
const backgrounds = ["bg", "surface", "surface-2"];
const PAIRS: [string, string, number][] = [
  ...[...backgrounds, "accent-soft", "warn-soft", "good-soft", "bad-soft", "code-bg"].flatMap(
    (bg): [string, string, number][] => [
      ["text", bg, TEXT],
      ["text-muted", bg, TEXT],
    ],
  ),
  ...[...backgrounds, "accent-soft", "good-soft"].map((bg): [string, string, number] => [
    "accent",
    bg,
    TEXT,
  ]),
  ["accent-strong", "accent-soft", TEXT],
  ["accent-strong", "bg", TEXT],
  ["on-accent", "accent", TEXT],
  ["on-accent", "accent-strong", TEXT],
  ["good", "good-soft", TEXT],
  ["good", "surface", TEXT],
  ["bad", "surface", TEXT],
  ["bad", "bg", TEXT],
  ["bad", "bad-soft", TEXT],
  ["warn", "bg", TEXT],
  ["warn", "surface", TEXT],
  ["warn", "surface-2", TEXT],
  ["bg", "text", TEXT], // toasts
  ["on-bad", "bad", TEXT], // error toasts
  ...["keyword", "string", "number", "comment", "title", "type", "attr"].map(
    (name): [string, string, number] => [`hl-${name}`, "code-bg", TEXT],
  ),
  ...backgrounds.flatMap((bg): [string, string, number][] => [
    ["control-border", bg, UI],
    ["focus", bg, UI],
  ]),
  ["accent", "surface", UI], // selected option border
  ["good", "surface", UI], // chosen option border, live dot
  ["bad", "surface", UI], // high priority dot
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (_name, theme) => {
  it.each(PAIRS)("%s on %s is at least %d:1", (fg, bg, min) => {
    const [a, b] = [theme[fg], theme[bg]];
    expect(a, `--${fg}`).toBeDefined();
    expect(b, `--${bg}`).toBeDefined();
    expect(contrast(a as string, b as string)).toBeGreaterThanOrEqual(min);
  });
});

describe("the contrast check itself", () => {
  it("matches known ratios", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#e39a8f")).toBeCloseTo(2.26, 2); // the old error toast
  });

  it("reads both themes", () => {
    expect(light.surface).toBe("#ffffff");
    expect(dark.surface).not.toBe(light.surface);
  });
});
