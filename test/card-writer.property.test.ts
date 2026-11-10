/**
 * Property test for the card writer: on generated cards with comments everywhere (indented,
 * in the first column, at the end of a line, between fields), every YAML style the writer
 * handles, and LF, CRLF or mixed line endings with or without a byte order mark, every
 * action must keep each byte outside the fields it changes, and the result must parse to
 * exactly the data the action asked for.
 *
 * Cards come in two shapes: a small one, and the one skills/decision-cards/SKILL.md tells
 * agents to write (priority, depends_on, a recommendation with a folded `why`, options with
 * a summary, pros and cons, the last summary a `|` block). Both get their fields in random
 * order. Notes come in every block style, `|+` (trailing blank lines kept) and `|2` (an
 * indentation indicator) included; some keys are quoted, and some list items have extra
 * spaces after the dash.
 *
 * The generator builds each card from segments it knows (field blocks and the comment or
 * blank lines between them), so the check doesn't depend on the writer's own idea of where
 * a field ends.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction, type CardAction } from "../src/core/actions.ts";
import { parseCard } from "../src/core/card-file.ts";
import { updateCardText } from "../src/core/card-writer.ts";
import { deepEqual } from "../src/core/equal.ts";
import { agentToken } from "../src/core/pending.ts";

const NOW = new Date("2026-11-10T12:00:00Z");
const FILE = "0001-x.md";
/** More runs for a deeper search: `FC_RUNS=20000 npx vitest run test/card-writer.property.test.ts`. */
const RUNS = Number(process.env.FC_RUNS ?? 300);

type NoteStyle = "plain" | "quoted" | "literal" | "folded" | "keep" | "indicator";
type Eol = "lf" | "crlf" | "mixed";

interface Field {
  key: string;
  /** The field's lines, LF only, ending with a line break. */
  text: string;
  value: unknown;
  /** Its last line is inside a `|` or `>` block. */
  endsInBlock: boolean;
  /** That block keeps trailing blank lines (`|+`): a blank line after it would be its text. */
  keepsBlankLines?: boolean;
}

interface Segment {
  kind: "field" | "gap";
  key?: string;
  endsInBlock?: boolean;
  keepsBlankLines?: boolean;
  /** With the generated line endings. */
  text: string;
}

const noteStyle = fc.constantFrom<NoteStyle>(
  "plain",
  "quoted",
  "literal",
  "folded",
  "keep",
  "indicator",
);
const gapLine = fc.oneof(
  fc.constant(""),
  fc.record({ indent: fc.constantFrom(0, 2, 4), trailing: fc.boolean() }),
);

/** Fields the card can have, so the generated order and gaps cover them all. */
const MAX_FIELDS = 20;

const cardShape = fc.record({
  /** The SKILL.md template's shape, or the small one. */
  template: fc.boolean(),
  quotedKeys: fc.boolean(),
  wideDash: fc.boolean(),
  state: fc.constantFrom("open", "deferred", "resolved", "applied"),
  statusStyle: fc.constantFrom("plain", "double", "single", "comment"),
  titleFolded: fc.boolean(),
  optionsFlow: fc.boolean(),
  feedback: fc.array(fc.record({ style: noteStyle, typed: fc.boolean() }), { maxLength: 3 }),
  feedbackLayout: fc.constantFrom("block2", "block0", "flow", "absent-or-empty"),
  feedbackKeyComment: fc.boolean(),
  betweenRounds: fc.boolean(),
  resolutionFlow: fc.boolean(),
  resolutionNote: fc.constantFrom("none", "plain", "literal"),
  resolutionNoteLast: fc.boolean(),
  needsNew: fc.constantFrom("absent", "true", "false"),
  seenAt: fc.boolean(),
  scalarComments: fc.boolean(),
  innerComments: fc.boolean(),
  notes: fc.boolean(),
  tags: fc.boolean(),
  order: fc.array(fc.integer(), { minLength: MAX_FIELDS, maxLength: MAX_FIELDS }),
  gaps: fc.array(fc.array(gapLine, { maxLength: 3 }), {
    minLength: MAX_FIELDS + 1,
    maxLength: MAX_FIELDS + 1,
  }),
  eol: fc.constantFrom<Eol>("lf", "crlf", "mixed"),
  mixed: fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
  bom: fc.boolean(),
});
type Shape = typeof cardShape extends fc.Arbitrary<infer T> ? T : never;

function noteText(style: NoteStyle, i: number, indent: string): [string, string] {
  switch (style) {
    case "plain":
      return [`round ${i}`, `round ${i}`];
    case "quoted":
      return [`"round: ${i}"`, `round: ${i}`];
    case "literal":
      return [`|\n${indent}line ${i}a\n${indent}  line ${i}b\n`, `line ${i}a\n  line ${i}b\n`];
    case "folded":
      return [`>-\n${indent}fold ${i}a\n${indent}fold ${i}b\n`, `fold ${i}a fold ${i}b`];
    case "keep":
      return [`|+\n${indent}kept ${i}\n\n`, `kept ${i}\n\n`];
    case "indicator":
      // The first line is indented more than the rest: the text starts with spaces.
      return [`|2\n${indent}  lead ${i}\n${indent}rest ${i}\n`, `  lead ${i}\nrest ${i}\n`];
  }
}

/** A block-style note ends the field in a block. */
const isBlock = (style: NoteStyle | undefined) =>
  style === "literal" || style === "folded" || style === "keep" || style === "indicator";

function fields(shape: Shape): Field[] {
  const comment = (text: string) =>
    shape.scalarComments ? `${text}   # ${text.length}\n` : `${text}\n`;
  const status = shape.state === "applied" ? "resolved" : shape.state;
  /** A key written as a quoted string, which is still the same name. */
  const quoted = (key: string, style: "double" | "single") =>
    shape.quotedKeys ? (style === "double" ? `"${key}"` : `'${key}'`) : key;
  const out: Field[] = [
    { key: "id", text: 'id: "0001"\n', value: "0001", endsInBlock: false },
    shape.titleFolded
      ? {
          key: "title",
          text: "title: >-\n  Pick a\n  colour\n",
          value: "Pick a colour",
          endsInBlock: true,
        }
      : {
          key: "title",
          text: "title: Pick a colour\n",
          value: "Pick a colour",
          endsInBlock: false,
        },
    {
      key: "status",
      text: {
        plain: `status: ${status}\n`,
        double: `status: "${status}"\n`,
        single: `status: '${status}'\n`,
        comment: `status: ${status}   # agents: keep this comment\n`,
      }[shape.statusStyle],
      value: status,
      endsInBlock: false,
    },
    {
      key: "kind",
      text: `${quoted("kind", "double")}: choice\n`,
      value: "choice",
      endsInBlock: false,
    },
    { key: "created", text: "created: 2026-11-10\n", value: "2026-11-10", endsInBlock: false },
    {
      key: "created_by",
      text: `${quoted("created_by", "single")}: test\n`,
      value: "test",
      endsInBlock: false,
    },
    shape.template ? templateOptions(shape) : smallOptions(shape),
  ];
  if (shape.template) {
    out.push(
      { key: "priority", text: comment("priority: normal"), value: "normal", endsInBlock: false },
      {
        key: "depends_on",
        text: shape.optionsFlow ? "depends_on: []\n" : 'depends_on:\n  - "0003"\n',
        value: shape.optionsFlow ? [] : ["0003"],
        endsInBlock: false,
      },
      {
        key: "recommendation",
        text: `recommendation:\n${shape.innerComments ? "  # the agent's pick\n" : ""}  option: b\n  why: >-\n    One sentence or two. Why you would\n    pick it.\n`,
        value: { option: "b", why: "One sentence or two. Why you would pick it." },
        endsInBlock: true,
      },
    );
  }

  const rounds = shape.feedback.map((round, i) => ({
    ...round,
    at: `2026-11-0${i + 1}T00:00:00Z`,
    i,
  }));
  const feedbackValue = rounds.map((r) => ({
    at: r.at,
    ...(r.typed ? { type: "note" } : {}),
    note: noteText(shape.feedbackLayout === "flow" ? "quoted" : r.style, r.i, "").at(1),
  }));
  const keyComment = shape.feedbackKeyComment ? "   # the human's rounds" : "";
  if (shape.feedbackLayout === "absent-or-empty" || rounds.length === 0) {
    if (shape.feedbackKeyComment) {
      out.push({ key: "feedback", text: "feedback: []\n", value: [], endsInBlock: false });
    }
  } else if (shape.feedbackLayout === "flow") {
    const items = rounds.map(
      (r) => `{at: ${r.at}${r.typed ? ", type: note" : ""}, note: "round: ${r.i}"}`,
    );
    out.push({
      key: "feedback",
      text: `feedback: [${items.join(", ")}]${keyComment}\n`,
      value: feedbackValue,
      endsInBlock: false,
    });
  } else {
    const dash = shape.feedbackLayout === "block2" ? "  " : "";
    // `-   at:` puts the item's keys 4 columns in.
    const afterDash = shape.wideDash ? "   " : " ";
    const inner = `${dash} ${afterDash}`;
    const items = rounds.map((r) => {
      const [note] = noteText(r.style, r.i, `${inner}  `);
      const typed = r.typed ? `${inner}type: note\n` : "";
      const between = shape.betweenRounds && r.i > 0 ? `${dash}# between rounds\n` : "";
      const atComment = shape.innerComments ? `   # round ${r.i}` : "";
      return `${between}${dash}-${afterDash}at: ${r.at}${atComment}\n${typed}${inner}note: ${note.endsWith("\n") ? note : `${note}\n`}`;
    });
    const lastStyle = rounds.at(-1)?.style;
    out.push({
      key: "feedback",
      text: `feedback:${keyComment}\n${shape.innerComments ? `${dash}  # oldest first\n` : ""}${items.join("")}`,
      value: feedbackValue,
      endsInBlock: isBlock(lastStyle),
      keepsBlankLines: lastStyle === "keep",
    });
  }

  if (status === "resolved") {
    const note = shape.resolutionNote;
    const value = {
      choice: "a",
      ...(note === "plain"
        ? { note: "Calmer." }
        : note === "literal"
          ? { note: "First line.\nSecond line.\n" }
          : {}),
      resolved_at: "2026-11-05T00:00:00Z",
    };
    if (shape.resolutionFlow) {
      const parts = [
        "choice: a",
        ...(note === "none" ? [] : [`note: ${JSON.stringify(value.note)}`]),
        "resolved_at: 2026-11-05T00:00:00Z",
      ];
      out.push({
        key: "resolution",
        text: `resolution: {${parts.join(", ")}}\n`,
        value,
        endsInBlock: false,
      });
    } else {
      const noteLine =
        note === "plain"
          ? "  note: Calmer.\n"
          : note === "literal"
            ? "  note: |\n    First line.\n    Second line.\n"
            : "";
      const lines = [
        `  choice: a${shape.innerComments ? "   # option a" : ""}\n`,
        `${shape.innerComments ? "  # when\n" : ""}  resolved_at: 2026-11-05T00:00:00Z\n`,
      ];
      if (shape.resolutionNoteLast) lines.push(noteLine);
      else lines.splice(1, 0, noteLine);
      out.push({
        key: "resolution",
        text: `resolution:\n${lines.join("")}`,
        value,
        endsInBlock: note === "literal" && shape.resolutionNoteLast,
      });
    }
    if (shape.state === "applied") {
      out.push({
        key: "applied_at",
        text: comment("applied_at: 2026-11-06T00:00:00Z"),
        value: "2026-11-06T00:00:00Z",
        endsInBlock: false,
      });
    }
  } else if (shape.needsNew !== "absent") {
    out.push({
      key: "needs_new_options",
      text: comment(`needs_new_options: ${shape.needsNew}`),
      value: shape.needsNew === "true",
      endsInBlock: false,
    });
  }
  if (shape.seenAt) {
    out.push({
      key: "seen_at",
      text: comment("seen_at: 2026-11-02T00:00:00Z"),
      value: "2026-11-02T00:00:00Z",
      endsInBlock: false,
    });
  }
  if (shape.notes) {
    out.push({
      key: "notes",
      text: "notes: |\n  literal\n    indented\n",
      value: "literal\n  indented\n",
      endsInBlock: true,
    });
  }
  if (shape.tags) {
    out.push({
      key: "tags",
      text: "tags: [storage, offline]\n",
      value: ["storage", "offline"],
      endsInBlock: false,
    });
  }
  // A random order: sort by the generated numbers (ties keep the original order).
  return out
    .map((field, i) => ({ field, rank: shape.order[i] ?? 0 }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ field }) => field);
}

function smallOptions(shape: Shape): Field {
  return {
    key: "options",
    text: shape.optionsFlow
      ? "options: [{id: a, title: A}, {id: b, title: B}]\n"
      : `options:\n${shape.innerComments ? "  # the agent's options\n" : ""}  - id: a\n    title: A\n  - id: b\n    title: B\n`,
    value: [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ],
    endsInBlock: false,
  };
}

/** Options as in the SKILL.md template: summary, pros and cons, the last summary a block. */
function templateOptions(shape: Shape): Field {
  const pad = shape.wideDash ? "   " : " ";
  const key = `  ${" ".repeat(pad.length + 1)}`;
  const comment = shape.innerComments ? `${key}# what it costs\n` : "";
  const lists = shape.optionsFlow
    ? `${key}pros: [fast, small]\n${key}cons: [new]\n`
    : `${key}pros:\n${key}  - fast\n${key}  - small\n${comment}${key}cons:\n${key}  - new\n`;
  return {
    key: "options",
    text:
      "options:\n" +
      `  -${pad}id: a\n${key}title: Lead with the offline promise\n${key}summary: One sentence.\n${lists}` +
      `  -${pad}id: b\n${key}title: Lead with the next action\n${key}pros: [clear]\n${key}cons: []\n${key}summary: |\n${key}  Two lines\n${key}  of summary.\n`,
    value: [
      {
        id: "a",
        title: "Lead with the offline promise",
        summary: "One sentence.",
        pros: ["fast", "small"],
        cons: ["new"],
      },
      {
        id: "b",
        title: "Lead with the next action",
        pros: ["clear"],
        cons: [],
        summary: "Two lines\nof summary.\n",
      },
    ],
    endsInBlock: true,
  };
}

/** The card as segments, with the expected parsed frontmatter. */
function build(shape: Shape): {
  prefix: string;
  segments: Segment[];
  suffix: string;
  data: Record<string, unknown>;
} {
  let line = 0;
  const eol = (text: string) =>
    text.replace(/\n/g, () => {
      const crlf =
        shape.eol === "crlf" || (shape.eol === "mixed" && shape.mixed[line++ % shape.mixed.length]);
      return crlf ? "\r\n" : "\n";
    });
  const list = fields(shape);
  const segments: Segment[] = [];
  let comments = 0;
  const gap = (index: number, afterBlock: boolean, afterKeep: boolean) => {
    let text = "";
    let first = true;
    for (const entry of shape.gaps[index] ?? []) {
      if (entry === "") {
        // Blank lines right after a `|+` block are part of its text.
        if (!(first && afterKeep)) text += "\n";
        continue;
      }
      // Right after a `|` or `>` block an indented line would be part of its text, not a
      // comment, so the first comment there starts in the first column.
      const indent = first && afterBlock ? 0 : entry.indent;
      first = false;
      comments += 1;
      text += `${" ".repeat(indent)}# comment ${comments}${entry.trailing ? "   " : ""}\n`;
    }
    if (text) segments.push({ kind: "gap", text: eol(text) });
  };
  gap(0, false, false);
  list.forEach((field, i) => {
    segments.push({
      kind: "field",
      key: field.key,
      endsInBlock: field.endsInBlock,
      keepsBlankLines: field.keepsBlankLines === true,
      text: eol(field.text),
    });
    gap(i + 1, field.endsInBlock, field.keepsBlankLines === true);
  });
  return {
    prefix: (shape.bom ? "﻿" : "") + eol("---\n"),
    segments,
    suffix: eol("---\n\n## Context\n\nWhy.\n"),
    data: Object.fromEntries(list.map((field) => [field.key, field.value])),
  };
}

/** Lines up to the first one that starts in the first column (blank lines included). */
function leadingIndentedRun(text: string): string {
  const match = /^(?:(?:[ \t][^\n]*)?\r?\n)*/.exec(text);
  return match?.[0] ?? "";
}

type Part = { literal: string; optional?: boolean } | { slot: true };

/**
 * The output's expected shape: unchanged segments verbatim, changed fields anything (a
 * slot). Indented comment lines right after a removed field may go with it only when the
 * kept text above it ends in a `|` or `>` block, where they would otherwise become its text.
 */
function expectedParts(
  card: ReturnType<typeof build>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Part[] {
  const parts: Part[] = [{ literal: card.prefix }];
  const removed = (s: Segment) => s.kind === "field" && after[s.key as string] === undefined;
  card.segments.forEach((segment, index) => {
    if (segment.kind === "gap") {
      const previous = card.segments[index - 1];
      if (previous && removed(previous) && keptTextEndsInBlock(card.segments, index - 1, after)) {
        const run = leadingIndentedRun(segment.text);
        parts.push({ literal: run, optional: true }, { literal: segment.text.slice(run.length) });
      } else {
        parts.push({ literal: segment.text });
      }
      return;
    }
    const key = segment.key as string;
    if (deepEqual(before[key], after[key])) {
      parts.push({ literal: segment.text });
    } else if (
      Array.isArray(before[key]) &&
      Array.isArray(after[key]) &&
      (before[key] as unknown[]).length > 0 &&
      /^feedback:[^\n]*\r?\n(?:[ ]*#[^\n]*\r?\n)*[ ]*- /.test(segment.text) &&
      (before[key] as unknown[]).every((item, i) => deepEqual(item, (after[key] as unknown[])[i]))
    ) {
      // Rounds appended to a block list: the earlier rounds are kept as they were.
      parts.push({ literal: segment.text }, { slot: true });
    } else {
      parts.push({ slot: true });
    }
  });
  // New fields go at the end of the frontmatter.
  parts.push({ slot: true }, { literal: card.suffix });
  return parts;
}

/** Whether `text` is exactly the parts in order, each slot standing for any text. */
function matches(text: string, parts: Part[]): boolean {
  const memo = new Map<number, boolean>();
  const from = (index: number, at: number): boolean => {
    if (index === parts.length) return at === text.length;
    const id = index * (text.length + 1) + at;
    const known = memo.get(id);
    if (known !== undefined) return known;
    const part = parts[index] as Part;
    let ok = false;
    if ("slot" in part) {
      // Only the places where the next literal starts can end the slot.
      const next = parts[index + 1];
      const anchor =
        next && "literal" in next && !next.optional && next.literal ? next.literal : "";
      for (let end = at; end <= text.length && !ok; end++) {
        if (anchor) {
          end = text.indexOf(anchor, end);
          if (end === -1) break;
        }
        ok = from(index + 1, end);
      }
    } else {
      ok =
        (text.startsWith(part.literal, at) && from(index + 1, at + part.literal.length)) ||
        (part.optional === true && from(index + 1, at));
    }
    memo.set(id, ok);
    return ok;
  };
  return from(0, 0);
}

/** Whether the kept text before the removed field at `index` ends inside a block. */
function keptTextEndsInBlock(
  segments: Segment[],
  index: number,
  after: Record<string, unknown>,
): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const segment = segments[i] as Segment;
    if (segment.kind === "gap") {
      if (/^[^\s]/m.test(segment.text)) return false;
      continue;
    }
    if (after[segment.key as string] === undefined) continue;
    return segment.endsInBlock === true;
  }
  return false;
}

const ACTIONS: CardAction[] = [
  { type: "note", note: "A note from the human." },
  { type: "note", note: "Two paragraphs.\n\nThe second one." },
  { type: "neither", note: "None of these work offline." },
  { type: "defer", note: "After the launch." },
  { type: "defer" },
  { type: "resolve", choice: "b", note: "Go with it." },
  { type: "resolve", choice: "custom", note: "My own answer,\nover two lines." },
  { type: "reopen", note: "Costs changed." },
  { type: "reopen" },
  { type: "applied", token: "TOKEN" },
  { type: "seen", token: "TOKEN" },
];

describe("updateCardText (property)", () => {
  it("generates every shape it claims to (R4-7)", () => {
    const texts = fc.sample(cardShape, { numRuns: 300, seed: 1 }).map((shape) => {
      const card = build(shape);
      return card.prefix + card.segments.map((s) => s.text).join("") + card.suffix;
    });
    const needles = [
      "priority: normal",
      'depends_on:\n  - "0003"',
      "  why: >-",
      "summary: |",
      "    pros:\n      - fast",
      "note: |+",
      "note: |2",
      '"kind": choice',
      "'created_by': test",
      "-   at: ",
      "-   id: a",
    ];
    for (const needle of needles) {
      expect(
        texts.some((t) => t.replace(/\r/g, "").includes(needle)),
        needle,
      ).toBe(true);
    }
  });

  it(
    "keeps every byte outside the changed fields, for every action",
    () => {
      fc.assert(
        fc.property(cardShape, (shape) => {
          const card = build(shape);
          const text = card.prefix + card.segments.map((s) => s.text).join("") + card.suffix;
          const parsed = parseCard(text, FILE);
          if (!parsed.ok)
            throw new Error(
              `generated card is invalid: ${parsed.problem.errors.join("; ")}\n${text}`,
            );
          // The generator's comments really are comments (not text inside a block).
          expect(parsed.card.raw).toEqual(card.data);

          for (const template of ACTIONS) {
            const action: CardAction =
              "token" in template ? { ...template, token: agentToken(parsed.card) } : template;
            const result = applyAction(parsed.card, action, NOW);
            if (!result.ok || deepEqual(result.raw, parsed.card.raw)) continue;
            const expected = Object.fromEntries(
              Object.entries(result.raw).filter(([, v]) => v !== undefined),
            );

            const out = updateCardText(text, result.raw);
            const reparsed = parseCard(out, FILE);
            if (!reparsed.ok)
              throw new Error(`${action.type}: ${reparsed.problem.errors.join("; ")}\n${out}`);
            expect(reparsed.card.raw, action.type).toEqual(expected);
            if (!matches(out, expectedParts(card, parsed.card.raw, result.raw))) {
              expect.fail(
                `${action.type} changed bytes outside the changed fields:\n${text}\n=>\n${out}`,
              );
            }
            // New lines use the file's line ending.
            if (shape.eol === "crlf") expect(out.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
            if (shape.eol === "lf") expect(out).not.toContain("\r");
          }
        }),
        { numRuns: RUNS },
      );
    },
    Math.max(60_000, RUNS * 100),
  );
});
