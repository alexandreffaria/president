/**
 * Reading card files: `---` YAML frontmatter `---` followed by a markdown body.
 *
 * Parsing is pure (text in, result out) and never throws: whatever an agent writes, the
 * result is either a card or a list of problems phrased so the agent can fix the file.
 * Writing lives in card-writer.ts.
 */
import { type Document, isCollection, isMap, isScalar, LineCounter, parseDocument } from "yaml";
import {
  CARD_FILENAME_PATTERN,
  type Frontmatter,
  FrontmatterSchema,
  formatIssues,
  formatPath,
  lineSuffix,
  type RawFrontmatter,
  sameCardId,
} from "./schema.ts";
import { type BodySections, splitSections } from "./sections.ts";

export interface ParsedCard {
  /** Canonical card id, taken from the file name. */
  id: string;
  fileName: string;
  frontmatter: Frontmatter;
  /** The frontmatter exactly as written (no defaults applied). */
  raw: RawFrontmatter;
  body: string;
  sections: BodySections;
  /** The file line of each top-level frontmatter field, for messages about it. */
  fieldLines: Record<string, number>;
}

export interface CardProblem {
  fileName: string;
  /** The id from the file name, when the name is well formed. */
  id: string | undefined;
  /** One line per problem, phrased so an agent can fix the file. */
  errors: string[];
}

export type ParseResult = { ok: true; card: ParsedCard } | { ok: false; problem: CardProblem };

export interface SplitFile {
  yaml: string;
  body: string;
  /** Offsets in the original text where the YAML starts and ends (the closing `---` line). */
  yamlStart: number;
  yamlEnd: number;
  /** 1-based line numbers in the file where the YAML and the body start, for error messages. */
  yamlStartLine: number;
  bodyStartLine: number;
}

/** Cards are short documents; anything bigger is a mistake (or an attack). */
export const MAX_CARD_BYTES = 1024 * 1024;
/** YAML aliases expand on read; a few nested ones can blow up to millions of nodes. */
const MAX_ALIAS_COUNT = 100;

const BOM = "﻿";
const DELIMITER = /^---[ \t]*$/;

/** Splits a card file into its YAML frontmatter and markdown body. */
export function splitFrontmatter(text: string): SplitFile | null {
  const start = text.startsWith(BOM) ? BOM.length : 0;
  const firstBreak = text.indexOf("\n", start);
  if (firstBreak === -1) return null;
  if (!DELIMITER.test(text.slice(start, firstBreak).replace(/\r$/, ""))) return null;

  const yamlStart = firstBreak + 1;
  let offset = yamlStart;
  while (offset <= text.length) {
    const next = text.indexOf("\n", offset);
    const end = next === -1 ? text.length : next;
    if (DELIMITER.test(text.slice(offset, end).replace(/\r$/, ""))) {
      const yaml = text.slice(yamlStart, offset);
      return {
        yaml,
        body: next === -1 ? "" : text.slice(next + 1),
        yamlStart,
        yamlEnd: offset,
        yamlStartLine: 2,
        bodyStartLine: 3 + countLines(yaml),
      };
    }
    if (next === -1) break;
    offset = next + 1;
  }
  return null;
}

function countLines(text: string): number {
  let count = 0;
  for (const char of text) if (char === "\n") count += 1;
  return count;
}

export function parseCardFileName(
  fileName: string,
): { id: string; slug: string | undefined } | null {
  const match = CARD_FILENAME_PATTERN.exec(fileName);
  if (!match?.[1]) return null;
  return { id: match[1], slug: match[2] };
}

/** Parses and validates one card file. Never throws. */
export function parseCard(text: string, fileName: string): ParseResult {
  const name = parseCardFileName(fileName);
  const fail = (errors: string[]): ParseResult => ({
    ok: false,
    problem: { fileName, id: name?.id, errors },
  });
  try {
    return parseNamedCard(text, fileName, name, fail);
  } catch (error) {
    // The YAML library or the schema should not throw, but one bad file must never take
    // down a whole project, so anything unexpected becomes a problem with this card.
    return fail([`could not read the card: ${(error as Error).message}`]);
  }
}

function parseNamedCard(
  text: string,
  fileName: string,
  name: ReturnType<typeof parseCardFileName>,
  fail: (errors: string[]) => ParseResult,
): ParseResult {
  if (!name) {
    return fail([
      `file name "${fileName}" should look like "<id>-<slug>.md", e.g. "0007-error-handling.md" (lowercase letters, digits and dashes)`,
    ]);
  }
  // In bytes, as loadFile measures the file: a character can take up to 4 of them.
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_CARD_BYTES) {
    return fail([
      `the file is ${Math.floor(bytes / 1024)} kB; cards must be under ${MAX_CARD_BYTES / 1024} kB`,
    ]);
  }

  const split = splitFrontmatter(text);
  if (!split) {
    return fail([
      "the file must start with a line containing only `---`, then YAML frontmatter, then another `---` line",
    ]);
  }

  const lineCounter = new LineCounter();
  // logLevel "error": the library's warnings (a list or mapping used as a key) would go to
  // stderr on every read; such keys are reported as a card error below instead.
  const doc = parseDocument(split.yaml, { lineCounter, logLevel: "error" });
  const fileLine = (offset: number) => lineCounter.linePos(offset).line + split.yamlStartLine - 1;
  if (doc.errors.length > 0) return fail(yamlErrors(doc.errors, split));
  if (isMap(doc.contents)) {
    // Only names: a list, mapping, number, true/false or null as a key isn't a field of
    // the card, and the writer can't place an edit next to one.
    const odd = doc.contents.items.find(
      (pair) => !isScalar(pair.key) || typeof pair.key.value !== "string",
    );
    if (odd) {
      const key = odd.key as { range?: [number, number, number] } | null;
      const offset = key?.range?.[0];
      const where = offset === undefined ? "" : ` (line ${fileLine(offset)})`;
      const text = key?.range ? split.yaml.slice(key.range[0], key.range[1]).trim() : "";
      const what = isCollection(odd.key)
        ? "not lists or mappings"
        : `not numbers, true/false or null${text ? ` like ${text}` : ""}`;
      return fail([`frontmatter keys must be plain names, ${what}${where}`]);
    }
  }
  let raw: unknown;
  try {
    raw = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (error) {
    return fail([`YAML error: ${(error as Error).message}`]);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail(["the frontmatter must be a YAML mapping (key: value pairs)"]);
  }

  const result = FrontmatterSchema.safeParse(raw, {
    error: (issue) => (issue.input === undefined ? "is required" : undefined),
  });
  if (!result.success) {
    return fail(formatIssues(result.error, (path) => lineOf(doc, path, fileLine)));
  }
  const frontmatter = result.data;

  const errors: string[] = [];
  if (!sameCardId(frontmatter.id, name.id)) {
    errors.push(
      `id: "${frontmatter.id}" does not match the file name, which starts with "${name.id}"`,
    );
  }
  for (const path of placeholderPaths(raw)) {
    errors.push(
      `${formatPath(path)}: "..." is a placeholder from the template; write the real text${lineSuffix(lineOf(doc, path, fileLine))}`,
    );
  }

  const sections = splitSections(split.body);
  const optionIds = new Set(frontmatter.options.map((o) => o.id));
  const seenSections = new Set<string>();
  const bodyLine = (line: number) => line + split.bodyStartLine - 1;
  for (const section of sections.options) {
    if (!optionIds.has(section.id)) {
      errors.push(
        `body: "## Option ${section.id}" (line ${bodyLine(section.line)}) does not match any option id in the frontmatter`,
      );
    } else if (seenSections.has(section.id)) {
      errors.push(
        `body: there are two "## Option ${section.id}" sections (the second on line ${bodyLine(section.line)})`,
      );
    }
    seenSections.add(section.id);
    if (isPlaceholder(section.markdown)) {
      errors.push(
        `body: the "## Option ${section.id}" section (line ${bodyLine(section.line)}) is only "..."; write the real content`,
      );
    }
  }
  if (isPlaceholder(sections.context.replace(/^##[ \t]+Context[ \t]*\n/i, ""))) {
    const heading = split.body.split("\n").findIndex((line) => /^##[ \t]+Context\b/i.test(line));
    const where = heading === -1 ? "" : ` (line ${bodyLine(heading + 1)})`;
    errors.push(`body: the context${where} is only "..."; write the real content`);
  }
  // Other sections from the template (## Sources) left as "...".
  const bodyLines = split.body.split("\n");
  bodyLines.forEach((line, i) => {
    const heading = /^##[ \t]+(.+?)[ \t]*$/.exec(line)?.[1];
    if (!heading || /^(context|option)\b/i.test(heading)) return;
    const next = bodyLines.findIndex((l, j) => j > i && /^##[ \t]/.test(l));
    const content = bodyLines.slice(i + 1, next === -1 ? undefined : next).join("\n");
    if (isPlaceholder(content.replace(/^\s*[-*][ \t]+/, ""))) {
      errors.push(
        `body: the "## ${heading}" section (line ${bodyLine(i + 1)}) is only "..."; write the real content or remove the section`,
      );
    }
  });
  if (errors.length > 0) return fail(errors);

  return {
    ok: true,
    card: {
      id: name.id,
      fileName,
      frontmatter,
      raw: raw as RawFrontmatter,
      body: split.body,
      sections,
      fieldLines: fieldLinesOf(doc, fileLine),
    },
  };
}

/** YAML's own messages for what an unquoted `: ` inside a value does. */
const COLON_IN_VALUE =
  /Nested mappings are not allowed in compact mappings|Implicit map keys need to be followed by map values|Implicit keys need to be on a single line/;

/**
 * YAML syntax errors as lines an agent can act on: the first error of each line only (one
 * slip often gives several), only the tab errors when a tab is the cause, and for a value
 * with `: ` in it, the field and the value in quotes.
 */
function yamlErrors(
  errors: { message: string; linePos?: [{ line: number; col: number }, ...unknown[]] }[],
  split: SplitFile,
): string[] {
  const yamlLines = split.yaml.split("\n");
  const tabs = errors.filter((error) => error.message.startsWith("Tabs are not allowed"));
  const seen = new Set<number | undefined>();
  const out: string[] = [];
  for (const error of tabs.length > 0 ? tabs : errors) {
    const line = error.linePos?.[0]?.line;
    if (seen.has(line)) continue;
    seen.add(line);
    const where = line === undefined ? "" : ` on line ${line + split.yamlStartLine - 1}`;
    let message = (error.message.split("\n")[0] ?? error.message).replace(
      / at line \d+, column \d+:?$/,
      "",
    );
    if (tabs.length > 0) message += "; indent with spaces";
    const field = /^\s*(?:-\s+)?([A-Za-z_][\w.-]*):[ \t]+(.*?)\s*$/.exec(
      line === undefined ? "" : (yamlLines[line - 1] ?? ""),
    );
    if (COLON_IN_VALUE.test(message) && field?.[2]?.includes(": ")) {
      const [, key, value] = field;
      message = `${key}: the value contains ": ", so YAML can't read it; put it in quotes: ${key}: ${JSON.stringify(value)}`;
    }
    out.push(`YAML error${where}: ${message}`);
  }
  return out;
}

function fieldLinesOf(doc: Document, fileLine: (offset: number) => number): Record<string, number> {
  const lines: Record<string, number> = {};
  if (!isMap(doc.contents)) return lines;
  for (const pair of doc.contents.items) {
    const key = pair.key as { value?: unknown; range?: [number, number, number] } | null;
    if (typeof key?.value === "string" && key.range) lines[key.value] = fileLine(key.range[0]);
  }
  return lines;
}

/** The file line of the YAML node at `path`, or of its closest existing parent. */
function lineOf(
  doc: Document,
  path: readonly PropertyKey[],
  fileLine: (offset: number) => number,
): number | undefined {
  for (let length = path.length; length > 0; length--) {
    const node = doc.getIn(path.slice(0, length), true) as { range?: [number, number, number] };
    if (node?.range) return fileLine(node.range[0]);
  }
  return undefined;
}

/** `...` (or `…`) left over from the skill's template. */
function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "..." || trimmed === "…";
}

function placeholderPaths(value: unknown, path: PropertyKey[] = []): PropertyKey[][] {
  if (typeof value === "string") return isPlaceholder(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item, i) => placeholderPaths(item, [...path, i]));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => placeholderPaths(item, [...path, key]));
  }
  return [];
}
