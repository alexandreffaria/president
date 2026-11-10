/**
 * Writing card files.
 *
 * A write changes only the bytes of the frontmatter fields whose values changed. The rest
 * of the file (other fields with their comments, quoting, folded blocks and flow styles,
 * comments between and after fields, the `---` lines, the body, every line ending and a
 * byte order mark) is copied through as is, so a click in the UI makes a small, readable
 * git diff.
 *
 * Line endings are handled in one place: the YAML is read with every CRLF turned into LF,
 * edits are worked out on that text, and then applied to the original bytes through an
 * offset map. New lines get the file's usual line ending. No other code here has to think
 * about `\r`.
 *
 * Edits splice text at the source ranges the YAML parser reports. A field's span runs from
 * the line of its key to the last line of its value's *content*. Comment and blank lines
 * after that belong to whatever follows, so they stay when the field is changed or removed.
 * - a changed one-line scalar (`status: open   # comment`) has only its value replaced;
 * - items appended to a block sequence (`feedback`) are inserted after its last item;
 * - other changed fields are replaced as a whole `key: value` block;
 * - removed fields lose their lines; new fields are added at the end of the frontmatter.
 *
 * One exception: indented comment lines after a removed field go with it when the field
 * above it ends in a `|` or `>` block, because they would otherwise become that block's
 * text.
 *
 * The result is parsed again and must equal the requested data. If it doesn't, new values
 * are written without `|` blocks (multi-line text in quotes), so a comment below them can't
 * become part of them. If that still doesn't work (an exotic layout the splicer doesn't
 * understand), the frontmatter is re-serialized, which is always correct but loses some
 * formatting.
 */
import {
  Document,
  isAlias,
  isCollection,
  isMap,
  isNode,
  isPair,
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
import { deepEqual } from "./equal.ts";
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
  const lines = normalizeLineEndings(split.yaml);
  const doc = parseDocument(lines.text, { keepSourceTokens: true, logLevel: "error" });
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    throw new Error("cannot update a card whose frontmatter is not a valid YAML mapping");
  }
  const previous = doc.toJS() as RawFrontmatter;
  if (deepEqual(previous, next)) return original;

  const newline = usualLineEnding(original);
  let yaml: string | undefined;
  for (const blocks of [true, false]) {
    const edits = spliceFrontmatter(lines.text, doc.contents, previous, next, blocks);
    if (!edits) break;
    const candidate = applyEdits(split.yaml, edits, lines.toOriginal, newline);
    if (sameData(candidate, next)) {
      yaml = candidate;
      break;
    }
  }
  yaml ??= reserialize(lines.text, next, newline);
  return original.slice(0, split.yamlStart) + yaml + original.slice(split.yamlEnd);
}

/**
 * The text with every CRLF turned into LF, and a map from offsets in that text back to
 * offsets in the original (an offset right before a line break maps to right before its CR).
 */
export function normalizeLineEndings(original: string): {
  text: string;
  toOriginal: (offset: number) => number;
} {
  // crAtBreak[i]: how many CRs were removed up to and including the i-th line break.
  const crAtBreak: number[] = [];
  let removed = 0;
  let text = "";
  let from = 0;
  for (let i = original.indexOf("\n"); i !== -1; i = original.indexOf("\n", i + 1)) {
    const cr = i > 0 && original[i - 1] === "\r";
    text += `${original.slice(from, cr ? i - 1 : i)}\n`;
    if (cr) removed += 1;
    crAtBreak.push(removed);
    from = i + 1;
  }
  text += original.slice(from);
  const breaks: number[] = [];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) breaks.push(i);
  return {
    text,
    toOriginal(offset) {
      // Number of LFs strictly before `offset`, then the CRs removed up to and including them.
      let low = 0;
      let high = breaks.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if ((breaks[mid] as number) < offset) low = mid + 1;
        else high = mid;
      }
      return offset + (low === 0 ? 0 : (crAtBreak[low - 1] as number));
    },
  };
}

/** The line ending most lines of the file use (CRLF only when it's the majority). */
function usualLineEnding(text: string): "\n" | "\r\n" {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (i > 0 && text[i - 1] === "\r") crlf += 1;
    else lf += 1;
  }
  return crlf > lf ? "\r\n" : "\n";
}

function applyEdits(
  original: string,
  edits: Edit[],
  toOriginal: (offset: number) => number,
  newline: string,
): string {
  // Apply from the end so earlier offsets stay valid. Edits at the same offset (items
  // appended to the last field, then new fields) are applied last-first to keep their order.
  const ordered = edits.map((edit, index) => ({ ...edit, index }));
  ordered.sort((a, b) => b.start - a.start || b.index - a.index);
  let out = original;
  for (const edit of ordered) {
    const text = newline === "\n" ? edit.text : edit.text.replace(/\n/g, newline);
    out = out.slice(0, toOriginal(edit.start)) + text + out.slice(toOriginal(edit.end));
  }
  return out;
}

/**
 * The edits that turn `previous` into `next`, as offsets in the LF-only `source`. `blocks`:
 * whether new values may use `|` and `>` blocks for multi-line text.
 */
function spliceFrontmatter(
  source: string,
  map: YAMLMap,
  previous: RawFrontmatter,
  next: RawFrontmatter,
  blocks: boolean,
): Edit[] | undefined {
  const edits: Edit[] = [];
  const seen = new Set<string>();
  // Whether the last line kept so far is inside a `|` or `>` block, so that an indented
  // line written right after it would be read as more of that block's text.
  let inBlock = false;
  let previousEnd = 0;
  for (const pair of map.items as Pair<unknown, unknown>[]) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !pair.key.range) {
      return undefined;
    }
    const key = pair.key.value;
    seen.add(key);
    const start = lineStart(source, pair.key.range[0]);
    const end = lineEnd(source, Math.max(pair.key.range[1], contentEnd(pair.value)));
    if (startsAtColumnZero(source.slice(previousEnd, start))) inBlock = false;
    previousEnd = end;

    if (next[key] === undefined) {
      // Removed: the comments below it stay, unless they would end up inside a block above.
      const trailing = inBlock ? indentedRun(source, end) : end;
      edits.push({ start, end: trailing, text: "" });
      previousEnd = trailing;
      continue;
    }
    const unchanged = deepEqual(previous[key], next[key]);
    inBlock = unchanged && endsInBlockScalar(pair.value);
    if (!unchanged) {
      edits.push(changeValue(source, pair, key, previous[key], next[key], { start, end }, blocks));
    }
  }
  const added = Object.entries(next).filter(
    ([key, value]) => !seen.has(key) && value !== undefined,
  );
  if (added.length > 0) {
    const text = added.map(([key, value]) => renderPair(key, value, blocks)).join("");
    // A frontmatter whose last line has no line break can't be followed directly.
    const end = source.length;
    const glue = end > 0 && !source.endsWith("\n") ? "\n" : "";
    edits.push({ start: end, end, text: glue + text });
  }
  return edits;
}

/** Whether any non-blank line of `text` starts in the first column. */
function startsAtColumnZero(text: string): boolean {
  return /^[^\s]/m.test(text);
}

/** The end of the run of blank and indented lines starting at `offset`. */
function indentedRun(source: string, offset: number): number {
  let at = offset;
  while (at < source.length && /[ \t\n]/.test(source[at] as string)) {
    const next = source.indexOf("\n", at);
    at = next === -1 ? source.length : next + 1;
  }
  return at;
}

/**
 * Where a node's content ends: after its last character that isn't a comment or a blank
 * line. The parser's ranges for block collections run on through the comments that follow
 * them, so for those this is the content end of their last item.
 */
function contentEnd(node: unknown): number {
  const last = lastContent(node);
  return last?.range?.[1] ?? 0;
}

/** The node whose text is the last of `node`'s content: itself, or its last item's. */
function lastContent(node: unknown): { range?: Range | null | undefined } | undefined {
  if (isScalar(node) || isAlias(node)) return node;
  if (!isCollection(node)) return undefined;
  const last = node.items.at(-1);
  if (node.flow || last === undefined) return node;
  if (!isPair(last)) return lastContent(last);
  const value = lastContent(last.value);
  return value?.range ? value : lastContent(last.key);
}

/** Whether a value's last line is part of a `|` or `>` block. */
function endsInBlockScalar(node: unknown): boolean {
  const last = lastContent(node);
  return isScalar(last) && !isInline(last);
}

function changeValue(
  source: string,
  pair: Pair<unknown, unknown>,
  key: string,
  before: unknown,
  after: unknown,
  span: { start: number; end: number },
  blocks: boolean,
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
    const rendered = renderPair(key, after, blocks);
    const prefix = `${key}: `;
    if (rendered.startsWith(prefix) && rendered.indexOf("\n") === rendered.length - 1) {
      return {
        start: value.range[0],
        end: value.range[1],
        text: rendered.slice(prefix.length, -1),
      };
    }
  }

  // Appending to a block sequence (feedback rounds): insert the new items after the last
  // one's content. Comments after it (`# more rounds go here`) stay below the new items.
  if (
    isSeq(value) &&
    value.range &&
    value.flow !== true &&
    value.items.length > 0 &&
    Array.isArray(before) &&
    Array.isArray(after) &&
    after.length > before.length &&
    before.every((item, i) => deepEqual(item, after[i])) &&
    source[value.range[0]] === "-"
  ) {
    // The column of the first `-`; new items line up with it.
    const column = value.range[0] - lineStart(source, value.range[0]);
    const at = lineEnd(source, contentEnd(value));
    const items = render(after.slice(before.length), blocks);
    const glue = at > 0 && source[at - 1] !== "\n" ? "\n" : "";
    return { start: at, end: at, text: glue + indent(items, " ".repeat(column)) };
  }

  return { ...span, text: renderPair(key, after, blocks) };
}

/** A plain or quoted scalar written on one line (not a `|` or `>` block). */
function isInline(node: Scalar): boolean {
  return node.type !== Scalar.BLOCK_FOLDED && node.type !== Scalar.BLOCK_LITERAL;
}

function isScalarValue(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function renderPair(key: string, value: unknown, blocks: boolean): string {
  return render({ [key]: value }, blocks);
}

function render(value: unknown, blocks: boolean): string {
  // lineWidth 0: never fold long lines, so new notes stay on one line each.
  return new Document(value).toString({ lineWidth: 0, blockQuote: blocks });
}

function reserialize(source: string, next: RawFrontmatter, newline: string): string {
  const doc = parseDocument(source, { logLevel: "error" });
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
  const text = doc.toString({ lineWidth: 0 });
  return newline === "\n" ? text : text.replace(/\n/g, newline);
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
  const doc = parseDocument(yaml, { logLevel: "error" });
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
