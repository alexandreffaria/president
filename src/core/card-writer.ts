/**
 * Writing card files.
 *
 * A write changes only the bytes of the frontmatter fields whose values changed. The rest
 * of the file (other fields with their comments, quoting, folded blocks and flow styles,
 * the `---` lines, the body, line endings and a byte order mark) is copied through as is,
 * so a click in the UI makes a small, readable git diff.
 *
 * It works by splicing text at the source ranges the YAML parser reports:
 * - a changed one-line scalar (`status: open   # comment`) has only its value replaced;
 * - items appended to a block sequence (`feedback`) are inserted after its last item;
 * - other changed fields are replaced as a whole `key: value` block;
 * - removed fields lose their lines; new fields are added at the end of the frontmatter.
 *
 * The result is parsed again and must equal the requested data. If it doesn't (an exotic
 * layout the splicer doesn't understand), the frontmatter is re-serialized instead, which is
 * always correct but loses some formatting.
 */
import {
  Document,
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Pair,
  parseDocument,
  type Range,
  Scalar,
  visit,
  type YAMLMap,
} from "yaml";
import { splitFrontmatter } from "./card-file.ts";
import type { RawFrontmatter } from "./schema.ts";

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Returns the file text with its frontmatter changed to `next`. */
export function updateCardText(original: string, next: RawFrontmatter): string {
  const split = splitFrontmatter(original);
  if (!split) throw new Error("cannot update a card without frontmatter");
  const doc = parseDocument(split.yaml, { keepSourceTokens: true });
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    throw new Error("cannot update a card whose frontmatter is not a valid YAML mapping");
  }
  const previous = doc.toJS() as RawFrontmatter;
  if (deepEqual(previous, next)) return original;

  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  let yaml = spliceFrontmatter(split.yaml, doc.contents, previous, next, newline);
  if (yaml === undefined || !sameData(yaml, next)) yaml = reserialize(split.yaml, next, newline);
  return original.slice(0, split.yamlStart) + yaml + original.slice(split.yamlEnd);
}

function spliceFrontmatter(
  source: string,
  map: YAMLMap,
  previous: RawFrontmatter,
  next: RawFrontmatter,
  newline: string,
): string | undefined {
  const edits: Edit[] = [];
  const seen = new Set<string>();
  for (const pair of map.items as Pair<unknown, unknown>[]) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !pair.key.range) {
      return undefined;
    }
    const key = pair.key.value;
    seen.add(key);
    const span = pairSpan(source, pair);
    if (next[key] === undefined) {
      edits.push({ ...span, text: "" });
    } else if (!deepEqual(previous[key], next[key])) {
      edits.push(changeValue(source, pair, key, previous[key], next[key], span));
    }
  }
  const added = Object.entries(next).filter(
    ([key, value]) => !seen.has(key) && value !== undefined,
  );
  if (added.length > 0) {
    const text = added.map(([key, value]) => renderPair(key, value)).join("");
    // A frontmatter whose last line has no line break can't be followed directly.
    const end = source.length;
    const glue = end > 0 && !source.endsWith("\n") ? "\n" : "";
    edits.push({ start: end, end, text: glue + text });
  }

  // Apply from the end so earlier offsets stay valid. Edits at the same offset (items
  // appended to the last field, then new fields) are applied last-first to keep their order.
  const ordered = edits.map((edit, index) => ({ ...edit, index }));
  ordered.sort((a, b) => b.start - a.start || b.index - a.index);
  let out = source;
  for (const edit of ordered) {
    out = out.slice(0, edit.start) + withNewline(edit.text, newline) + out.slice(edit.end);
  }
  return out;
}

/** The whole lines a top-level pair occupies: from its key to the end of its value. */
function pairSpan(source: string, pair: Pair<unknown, unknown>): { start: number; end: number } {
  const keyRange = (pair.key as { range: Range }).range;
  const valueRange = (pair.value as { range?: Range } | null)?.range;
  const start = lineStart(source, keyRange[0]);
  const end = lineEnd(source, Math.max(keyRange[2], valueRange?.[2] ?? 0));
  return { start, end };
}

function changeValue(
  source: string,
  pair: Pair<unknown, unknown>,
  key: string,
  before: unknown,
  after: unknown,
  span: { start: number; end: number },
): Edit {
  const value = pair.value;

  // `status: open   # note` -> `status: resolved   # note`: keep the comment, anchor and spacing.
  if (
    isScalar(value) &&
    value.range &&
    value.range[1] > value.range[0] &&
    isInline(value) &&
    isScalarValue(after)
  ) {
    const rendered = renderPair(key, after);
    const prefix = `${key}: `;
    if (rendered.startsWith(prefix) && rendered.indexOf("\n") === rendered.length - 1) {
      return {
        start: value.range[0],
        end: value.range[1],
        text: rendered.slice(prefix.length, -1),
      };
    }
  }

  // Appending to a block sequence (feedback rounds): insert the new items after the last one.
  if (
    isSeq(value) &&
    value.range &&
    value.flow !== true &&
    value.items.length > 0 &&
    Array.isArray(before) &&
    Array.isArray(after) &&
    after.length > before.length &&
    before.every((item, i) => deepEqual(item, after[i]))
  ) {
    const last = value.items.at(-1) as { range?: Range };
    if (last.range && source[value.range[0]] === "-") {
      // The column of the first `-`; new items line up with it.
      const column = value.range[0] - lineStart(source, value.range[0]);
      const at = lineEnd(source, Math.max(last.range[2], value.range[1]));
      // Anything between the last item and the end of the field must be blank lines or
      // comments (`# more rounds go here`): the new items go before them and they stay.
      if (at <= value.range[2] && onlyCommentsOrBlank(source.slice(at, value.range[2]))) {
        const items = new Document(after.slice(before.length)).toString({ lineWidth: 0 });
        return { start: at, end: at, text: indent(items, " ".repeat(column)) };
      }
    }
  }

  return { ...span, text: renderPair(key, after) };
}

function onlyCommentsOrBlank(text: string): boolean {
  return text.split("\n").every((line) => /^\s*(#.*)?$/.test(line));
}

/** A plain or quoted scalar written on one line (not a `|` or `>` block). */
function isInline(node: Scalar): boolean {
  return node.type !== Scalar.BLOCK_FOLDED && node.type !== Scalar.BLOCK_LITERAL;
}

function isScalarValue(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function renderPair(key: string, value: unknown): string {
  // lineWidth 0: never fold long lines, so new notes stay on one line each.
  return new Document({ [key]: value }).toString({ lineWidth: 0 });
}

function reserialize(source: string, next: RawFrontmatter, newline: string): string {
  const doc = parseDocument(source);
  const previous = doc.toJS() as RawFrontmatter;
  const changed = Object.keys(previous).filter(
    (key) => next[key] === undefined || !deepEqual(previous[key], next[key]),
  );
  inlineAliasesInto(doc, changed);
  for (const key of Object.keys(previous)) {
    if (next[key] === undefined) doc.delete(key);
  }
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined && !deepEqual(previous[key], value)) {
      doc.set(key, doc.createNode(value));
    }
  }
  return withNewline(doc.toString({ lineWidth: 0 }), newline);
}

/**
 * Replaces every alias (`*st`) whose anchor (`&st`) is inside one of `keys` with a copy of
 * the value it points to. Those fields are about to be replaced or deleted, and an alias
 * must not lose its anchor (the YAML would no longer be valid) or follow the new value.
 */
function inlineAliasesInto(doc: Document, keys: string[]): void {
  const anchors = new Set<string>();
  for (const key of keys) {
    const node = doc.get(key, true);
    if (!isNode(node)) continue;
    visit(node, {
      Node(_, child) {
        if (child.anchor) anchors.add(child.anchor);
      },
    });
  }
  if (anchors.size === 0) return;
  visit(doc, {
    Alias(_, alias) {
      if (!anchors.has(alias.source)) return undefined;
      return doc.createNode(alias.resolve(doc)?.toJS(doc));
    },
  });
}

function sameData(yaml: string, expected: RawFrontmatter): boolean {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) return false;
  const actual = doc.toJS() as RawFrontmatter;
  const defined = Object.fromEntries(Object.entries(expected).filter(([, v]) => v !== undefined));
  return deepEqual(actual, defined);
}

function lineStart(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

/** The offset just after the line break that ends the line containing `offset`. */
function lineEnd(source: string, offset: number): number {
  if (offset === 0 || source[offset - 1] === "\n") return offset;
  const next = source.indexOf("\n", offset);
  return next === -1 ? source.length : next + 1;
}

function indent(text: string, prefix: string): string {
  if (!prefix) return text;
  return text.replace(/^(?=.)/gm, prefix);
}

function withNewline(text: string, newline: string): string {
  return newline === "\n" ? text : text.replace(/\r?\n/g, newline);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
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
