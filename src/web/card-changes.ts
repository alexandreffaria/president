/**
 * What changed between the version of a card the human read and the one on disk now, in
 * words. Only what the human sees and decides on counts: an agent marking feedback as read
 * (`seen_at`) or applying a decision changes nothing they have to look at again.
 */
import type { CardDetailDto } from "../core/api.ts";
import { deepEqual } from "../core/equal.ts";
import { optionLabel } from "./format.ts";

export function describeChanges(before: CardDetailDto, after: CardDetailDto): string[] {
  const a = before.frontmatter;
  const b = after.frontmatter;
  const changes: string[] = [];
  if (a.title !== b.title) changes.push(`The question is now "${b.title}" (was "${a.title}").`);
  if (a.status !== b.status) changes.push(`It is now ${b.status} (was ${a.status}).`);
  if (!deepEqual(a.resolution, b.resolution) && b.resolution) {
    changes.push(`It was decided: ${b.resolution.choice}.`);
  }
  if (Boolean(a.needs_new_options) !== Boolean(b.needs_new_options)) {
    changes.push(
      b.needs_new_options ? "New options were asked for." : "It no longer waits for new options.",
    );
  }
  if (a.kind !== b.kind) changes.push(`It is now a ${b.kind} card (was ${a.kind}).`);
  if (before.sections.context !== after.sections.context) changes.push("The context changed.");

  const sectionOf = (card: CardDetailDto, id: string) =>
    card.sections.options.find((s) => s.id === id)?.markdown;
  b.options.forEach((option, index) => {
    const old = a.options.find((o) => o.id === option.id);
    const label = `${optionLabel(index, b.kind)} ("${option.title}")`;
    if (!old) {
      changes.push(`New option ${label}.`);
      return;
    }
    const parts = [
      old.title !== option.title && "title",
      old.summary !== option.summary && "summary",
      !deepEqual(old.pros, option.pros) && "pros",
      !deepEqual(old.cons, option.cons) && "cons",
      sectionOf(before, option.id) !== sectionOf(after, option.id) && "details",
      !deepEqual(old, option) && "other fields",
    ].filter((p): p is string => typeof p === "string");
    const shown = parts.includes("other fields") && parts.length > 1 ? parts.slice(0, -1) : parts;
    if (shown.length > 0) changes.push(`Option ${label} changed: ${shown.join(", ")}.`);
  });
  for (const old of a.options) {
    if (!b.options.some((o) => o.id === old.id)) {
      changes.push(`Option "${old.title}" was removed.`);
    }
  }
  const order = (card: CardDetailDto) => card.frontmatter.options.map((o) => o.id).join(",");
  if (
    order(before) !== order(after) &&
    a.options.length === b.options.length &&
    a.options.every((o) => b.options.some((n) => n.id === o.id))
  ) {
    changes.push("The options are in a different order.");
  }
  if (!deepEqual(a.recommendation, b.recommendation)) {
    changes.push("The agent's recommendation changed.");
  }
  if (before.sections.appendix !== after.sections.appendix) {
    changes.push("The notes below the options changed.");
  }
  if (b.feedback.length > a.feedback.length) {
    changes.push("A note was added.");
  } else if (!deepEqual(a.feedback, b.feedback)) {
    changes.push("The notes changed.");
  }
  return changes;
}
