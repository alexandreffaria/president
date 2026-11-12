/**
 * What changed between the version of a card the human read and the one on disk now, in
 * words. Everything counts except an agent marking feedback as read (`seen_at`) or
 * applying a decision (`applied_at`), which changes nothing the human has to look at again.
 * Changes this file has no words for are still reported, as "Other details changed."
 */
import type { CardDetailDto } from "../core/api.ts";
import { deepEqual } from "../core/equal.ts";
import { CUSTOM_CHOICE } from "../core/model.ts";
import { optionLabel, PRIORITY_LABEL } from "./format.ts";

/** Fields whose changes the human doesn't have to read again. */
const UNREAD_FIELDS = new Set(["seen_at", "applied_at"]);
/** Fields described in words below. */
const DESCRIBED_FIELDS = new Set([
  "title",
  "status",
  "resolution",
  "needs_new_options",
  "kind",
  "priority",
  "tags",
  "depends_on",
  "options",
  "recommendation",
  "feedback",
  "withdrawn",
]);

export function describeChanges(before: CardDetailDto, after: CardDetailDto): string[] {
  const a = before.frontmatter;
  const b = after.frontmatter;
  const changes: string[] = [];
  if (a.title !== b.title) changes.push(`The question is now "${b.title}" (was "${a.title}").`);
  if (a.status !== b.status) changes.push(`It is now ${b.status} (was ${a.status}).`);
  if (!deepEqual(a.resolution, b.resolution) && b.resolution) {
    const choice = b.resolution.choice;
    const option = b.options.find((o) => o.id === choice);
    changes.push(
      option
        ? `It was decided: "${option.title}".`
        : choice === CUSTOM_CHOICE
          ? "It was decided, with an answer in words."
          : `It was decided: ${choice}.`,
    );
  }
  if (Boolean(a.needs_new_options) !== Boolean(b.needs_new_options)) {
    changes.push(
      b.needs_new_options ? "New options were asked for." : "It no longer waits for new options.",
    );
  }
  if (a.kind !== b.kind) changes.push(`It is now a ${b.kind} card (was ${a.kind}).`);
  if (a.priority !== b.priority) {
    changes.push(
      `It is now ${PRIORITY_LABEL[b.priority].toLowerCase()} (was ${PRIORITY_LABEL[a.priority].toLowerCase()}).`,
    );
  }
  if (!deepEqual(a.tags, b.tags)) changes.push("The tags changed.");
  if (!deepEqual(a.depends_on, b.depends_on)) {
    changes.push(
      b.depends_on.length > 0
        ? `It now depends on ${b.depends_on.map((d) => `#${d}`).join(", ")}.`
        : "It no longer depends on other cards.",
    );
  }
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

  // #0014: an agent withdrew the card, changed its reason, or took the withdrawal back.
  if (!deepEqual(a.withdrawn, b.withdrawn)) {
    changes.push(
      !b.withdrawn
        ? "It is no longer withdrawn."
        : a.withdrawn
          ? `The agent's withdrawal changed: ${b.withdrawn.reason}`
          : `An agent withdrew it: ${b.withdrawn.reason}`,
    );
  }

  const otherFields = new Set([...Object.keys(a), ...Object.keys(b)]);
  const otherFieldChanged = [...otherFields].some(
    (field) =>
      !UNREAD_FIELDS.has(field) &&
      !DESCRIBED_FIELDS.has(field) &&
      !deepEqual((a as Record<string, unknown>)[field], (b as Record<string, unknown>)[field]),
  );
  // Body text outside the sections compared above (before the context, say).
  const otherText = before.body !== after.body && deepEqual(before.sections, after.sections);
  if (otherFieldChanged || otherText) {
    changes.push("Other details changed.");
  }
  return changes;
}
