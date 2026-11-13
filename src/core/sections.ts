/**
 * Splits a card body into general context and per-option sections.
 *
 * A level-2 heading of the form `## Option <id>` (optionally followed by `:` or a dash
 * and a title) starts the section for that option. The section runs until the next
 * level-2 heading. Everything else is context: what comes before the first option
 * section is `context`, what comes after the last one (sources, notes) is `appendix`.
 * Headings inside fenced code blocks are ignored.
 *
 * Headings and fences follow CommonMark, so the sections match what the markdown renderer
 * shows: a heading may be indented up to 3 spaces and needs a space after `##`; a fence
 * closes only on a line with the same character, at least as many of them, and nothing else.
 */

export interface OptionSection {
  id: string;
  /** Heading text after the id, if any (e.g. "Result types" in `## Option a: Result types`). */
  heading: string | undefined;
  markdown: string;
  /** 1-based line number of the heading in the body, for error messages. */
  line: number;
}

export interface BodySections {
  context: string;
  options: OptionSection[];
  appendix: string;
}

/** An ATX level-2 heading; group 1 is its text without the optional closing `#`s. */
const H2 = /^ {0,3}##(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const OPTION_HEADING = /^option\s+`?([^\s`:]+)`?\s*(?:[:—–-]\s*(.*))?$/i;
/** An opening fence; a backtick fence's info string can't contain backticks. */
export const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
/** A closing fence: only the fence characters, then optional spaces. */
export const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

export function splitSections(body: string): BodySections {
  const lines = body.split(/\r?\n/);
  const context: string[] = [];
  const appendix: string[] = [];
  const options: OptionSection[] = [];
  let current: { section: OptionSection; lines: string[] } | null = null;
  let target: string[] = context;
  let fence: string | null = null;

  const flush = () => {
    if (current) {
      current.section.markdown = trimBlankLines(current.lines.join("\n"));
      options.push(current.section);
      current = null;
    }
  };

  lines.forEach((line, index) => {
    if (fence === null) {
      const open = FENCE_OPEN.exec(line)?.[1];
      if (open) {
        fence = open;
        target.push(line);
        return;
      }
    } else {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      target.push(line);
      return;
    }
    const heading = H2.exec(line);
    if (heading) {
      const option = OPTION_HEADING.exec(heading[1] ?? "");
      if (option?.[1]) {
        flush();
        const section: OptionSection = {
          id: option[1],
          heading: option[2]?.trim() || undefined,
          markdown: "",
          line: index + 1,
        };
        current = { section, lines: [] };
        target = current.lines;
        return;
      }
      if (current || options.length > 0) {
        flush();
        target = appendix;
      }
    }
    target.push(line);
  });
  flush();

  return {
    context: trimBlankLines(context.join("\n")),
    options,
    appendix: trimBlankLines(appendix.join("\n")),
  };
}

function trimBlankLines(text: string): string {
  return text.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");
}

/** An option's section to write: `## Option <id>: <title>`, then its markdown. */
export interface NewOptionSection {
  id: string;
  title: string;
  markdown: string;
}

/**
 * The body with its `## Option` sections replaced by `sections` (new options after
 * "neither", #0007): the context before them and the appendix after them (sources, notes)
 * stay as they are. A body without option sections gets the new ones at its end.
 */
export function replaceOptionSections(body: string, sections: NewOptionSection[]): string {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const { options } = splitSections(body);
  const written = sections
    .map((s) => [`## Option ${s.id}: ${s.title}`, "", s.markdown.trim()].join("\n").trim())
    .join("\n\n")
    .split("\n");
  const first = options[0];
  const last = options.at(-1);
  if (!first || !last) {
    const kept = [...lines];
    while (kept.length > 0 && kept.at(-1)?.trim() === "") kept.pop();
    return [...kept, ...(kept.length > 0 ? [""] : []), ...written, ""].join(newline);
  }
  // The appendix starts at the first level-2 heading after the last option section that
  // isn't one (splitSections ends a section there); fences are skipped the same way.
  const appendixAt = sectionEnd(lines, last.line - 1);
  const before = lines.slice(0, first.line - 1);
  const after = lines.slice(appendixAt);
  while (before.length > 0 && before.at(-1)?.trim() === "") before.pop();
  return [
    ...before,
    ...(before.length > 0 ? [""] : []),
    ...written,
    ...(after.length > 0 ? ["", ...after] : [""]),
  ].join(newline);
}

/** The index of the line after the section whose heading is at `headingIndex`. */
function sectionEnd(lines: string[], headingIndex: number): number {
  let fence: string | null = null;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (fence === null) {
      const open = FENCE_OPEN.exec(line)?.[1];
      if (open) {
        fence = open;
        continue;
      }
      if (H2.test(line)) return i;
    } else {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
    }
  }
  return lines.length;
}

/**
 * `markdown` with its level-2 headings outside code fences made level 3, so that, written as
 * an option's section, it can't end that section (a new-options run's `details`, #0007).
 */
export function demoteSectionHeadings(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (fence === null) {
        const open = FENCE_OPEN.exec(line)?.[1];
        if (open) {
          fence = open;
          return line;
        }
        return H2.test(line) ? line.replace(/^( {0,3})##/, "$1###") : line;
      }
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = null;
      return line;
    })
    .join("\n");
}
