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
const FENCE_OPEN = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
/** A closing fence: only the fence characters, then optional spaces. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

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
