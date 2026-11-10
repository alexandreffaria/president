/**
 * Reading and writing card files: `---` YAML frontmatter `---` followed by a markdown body.
 *
 * Parsing is pure (text in, result out). Writing patches the original YAML document so
 * unknown fields, key order and comments survive; only top-level keys whose values
 * changed are rewritten. The body is never touched.
 */
import { Document, isMap, parseDocument } from "yaml";
import {
  CARD_FILENAME_PATTERN,
  type Frontmatter,
  FrontmatterSchema,
  formatIssues,
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
}

export interface CardProblem {
  fileName: string;
  /** The id from the file name, when the name is well formed. */
  id: string | undefined;
  /** One line per problem, phrased so an agent can fix the file. */
  errors: string[];
}

export type ParseResult = { ok: true; card: ParsedCard } | { ok: false; problem: CardProblem };

interface SplitFile {
  yaml: string;
  body: string;
  /** 1-based line numbers in the file where the YAML and the body start, for error messages. */
  yamlStartLine: number;
  bodyStartLine: number;
}

const DELIMITER = /^---[ \t]*$/;

/** Splits a card file into its YAML frontmatter and markdown body. */
export function splitFrontmatter(text: string): SplitFile | null {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const firstBreak = source.indexOf("\n");
  const firstLine = (firstBreak === -1 ? source : source.slice(0, firstBreak)).replace(/\r$/, "");
  if (!DELIMITER.test(firstLine) || firstBreak === -1) return null;

  let offset = firstBreak + 1;
  while (offset <= source.length) {
    const next = source.indexOf("\n", offset);
    const end = next === -1 ? source.length : next;
    const line = source.slice(offset, end).replace(/\r$/, "");
    if (DELIMITER.test(line)) {
      const yaml = source.slice(firstBreak + 1, offset);
      return {
        yaml,
        body: next === -1 ? "" : source.slice(next + 1),
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
  if (!name) {
    return fail([
      `file name "${fileName}" should look like "<id>-<slug>.md", e.g. "0007-error-handling.md" (lowercase letters, digits and dashes)`,
    ]);
  }

  const split = splitFrontmatter(text);
  if (!split) {
    return fail([
      "the file must start with a line containing only `---`, then YAML frontmatter, then another `---` line",
    ]);
  }

  const doc = parseDocument(split.yaml);
  if (doc.errors.length > 0) {
    return fail(
      doc.errors.map((error) => {
        const line = error.linePos?.[0]?.line;
        const where = line === undefined ? "" : ` on line ${line + split.yamlStartLine - 1}`;
        const message = (error.message.split("\n")[0] ?? error.message).replace(
          / at line \d+, column \d+:?$/,
          "",
        );
        return `YAML error${where}: ${message}`;
      }),
    );
  }
  const raw: unknown = doc.toJS();
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return fail(["the frontmatter must be a YAML mapping (key: value pairs)"]);
  }

  const result = FrontmatterSchema.safeParse(raw, {
    error: (issue) => (issue.input === undefined ? "is required" : undefined),
  });
  if (!result.success) return fail(formatIssues(result.error));
  const frontmatter = result.data;

  const errors: string[] = [];
  if (!sameCardId(frontmatter.id, name.id)) {
    errors.push(
      `id: "${frontmatter.id}" does not match the file name, which starts with "${name.id}"`,
    );
  }

  const sections = splitSections(split.body);
  const optionIds = new Set(frontmatter.options.map((o) => o.id));
  const seenSections = new Set<string>();
  for (const section of sections.options) {
    if (!optionIds.has(section.id)) {
      errors.push(
        `body: "## Option ${section.id}" (line ${section.line + split.bodyStartLine - 1}) does not match any option id in the frontmatter`,
      );
    } else if (seenSections.has(section.id)) {
      errors.push(`body: there are two "## Option ${section.id}" sections`);
    }
    seenSections.add(section.id);
  }
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
    },
  };
}

/**
 * Returns the file text with its frontmatter replaced by `next`, keeping comments,
 * key order and formatting of every top-level field whose value did not change.
 */
export function updateCardText(original: string, next: RawFrontmatter): string {
  const split = splitFrontmatter(original);
  if (!split) throw new Error("cannot update a card without frontmatter");
  const doc = parseDocument(split.yaml);
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    throw new Error("cannot update a card whose frontmatter is not a valid YAML mapping");
  }
  const previous = doc.toJS() as RawFrontmatter;
  if (deepEqual(previous, next)) return original;

  for (const key of Object.keys(previous)) {
    if (!(key in next)) doc.delete(key);
  }
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) {
      doc.delete(key);
    } else if (!deepEqual(previous[key], value)) {
      doc.set(key, doc.createNode(value));
    }
  }
  return `---\n${stringify(doc)}---\n${split.body}`;
}

/** Serializes a brand-new card (used by tests and tooling). */
export function renderCard(frontmatter: RawFrontmatter, body: string): string {
  return `---\n${stringify(new Document(frontmatter))}---\n${body}`;
}

function stringify(doc: Document): string {
  // lineWidth 0: never fold long lines, so hand-written values keep their shape.
  return doc.toString({ lineWidth: 0 });
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  const aRecord = a as Record<string, unknown>;
  return aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]));
}
