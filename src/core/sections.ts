/**
 * Splits a card body into general context and per-option sections.
 *
 * A level-2 heading of the form `## Option <id>` (optionally followed by `:` or a dash
 * and a title) starts the section for that option. The section runs until the next
 * level-2 heading. Everything else is context: what comes before the first option
 * section is `context`, what comes after the last one (sources, notes) is `appendix`.
 * Headings inside fenced code blocks are ignored.
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

const H2 = /^##(?!#)\s*(.*?)\s*#*\s*$/;
const OPTION_HEADING = /^option\s+`?([^\s`:]+)`?\s*(?:[:—–-]\s*(.*))?$/i;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

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
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      target.push(line);
      return;
    }
    const heading = fence === null ? H2.exec(line) : null;
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
