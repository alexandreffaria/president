/**
 * `preside pending`: what an agent should act on. `collectPending` reads the cards and
 * sorts them into the lists, and `pendingText` and `pendingJson` render them. Agents in
 * other projects parse both and run the `done:` lines, so their wording is an interface.
 */

import { parseArgs } from "node:util";
import { agentToken, earlierDecision, needsApplying, unseenFeedback } from "../core/pending.ts";
import { continued } from "../core/rewrite.ts";
import { CUSTOM_CHOICE, withdrawalOf } from "../core/schema.ts";
import { type LoadedCard, loadProjectCards } from "../server/cards.ts";
import { UserError } from "../server/errors.ts";
import type { Project } from "../server/registry.ts";

import type { Output } from "./main.ts";
import { projectAt } from "./shared.ts";
import { shellQuote } from "./shell.ts";

/** A project's cards that need an agent, as `pending` lists them. */
export type Pending = {
  toApply: LoadedCard[];
  needOptions: LoadedCard[];
  withNotes: LoadedCard[];
  broken: { fileName: string; errors: string[] }[];
  warnings: { fileName: string; message: string }[];
};

export async function pending(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  const project = await projectAt(positionals[0] ?? ".", out);
  const found = await collectPending(project);
  if (values.json) {
    out.log(pendingJson(found));
    return 0;
  }
  pendingText(found, (line) => out.log(line));
  return 0;
}

export async function collectPending(project: Project): Promise<Pending> {
  const { cards, broken, warnings, error } = await loadProjectCards(project);
  if (error) throw new UserError(error);
  const toApply = cards.filter((c) => needsApplying(c.frontmatter));
  // Deferred cards too: the agent can rewrite the options while the card is snoozed.
  const needOptions = cards.filter(
    (c) => c.frontmatter.status !== "resolved" && c.frontmatter.needs_new_options === true,
  );
  // Notes are listed whatever the card's status; cards in the two lists above show their
  // new notes there.
  const withNotes = cards.filter(
    (c) =>
      !toApply.includes(c) && !needOptions.includes(c) && unseenFeedback(c.frontmatter).length > 0,
  );
  return { toApply, needOptions, withNotes, broken, warnings };
}

/** The command that marks exactly what this output showed about the card. */
const done = (c: LoadedCard) =>
  `preside ${needsApplying(c.frontmatter) ? "applied" : "seen"} ${shellQuote(c.path)} --token ${shellQuote(agentToken(c))}`;

/** `pending --json`: one JSON document. */
export function pendingJson({
  toApply,
  needOptions,
  withNotes,
  broken,
  warnings,
}: Pending): string {
  // Only on a card an agent withdrew (202611116ff6): just `{ at, reason }`, whatever else the
  // agent put in the field.
  const withdrawn = (c: LoadedCard) => {
    const w = withdrawalOf(c.frontmatter);
    return w ? { withdrawn: { at: w.at, reason: w.reason } } : {};
  };
  const describe = (c: LoadedCard) => ({
    id: c.id,
    title: c.frontmatter.title,
    status: c.frontmatter.status,
    ...withdrawn(c),
    path: c.path,
    new_notes: unseenFeedback(c.frontmatter),
    token: agentToken(c),
    done: done(c),
  });
  return JSON.stringify(
    {
      resolved_not_applied: toApply.map((c) => {
        const earlier = earlierDecision(c.frontmatter);
        return {
          ...describe(c),
          resolution: c.frontmatter.resolution,
          ...(earlier
            ? {
                previous_resolution: earlier.resolution,
                previous_applied_at: earlier.appliedAt ?? null,
              }
            : {}),
        };
      }),
      needs_new_options: needOptions.map((c) => ({
        ...describe(c),
        feedback: c.frontmatter.feedback,
      })),
      new_notes: withNotes.map(describe),
      broken: broken.map((b) => ({ file: b.fileName, errors: b.errors })),
      warnings: warnings.map((w) => ({ file: w.fileName, message: w.message })),
    },
    null,
    2,
  );
}

/**
 * `pending`'s text, handed to `log` as it goes (one call per line printed; a call may hold
 * several lines, as `  <path>\n    <title>` does). As it goes, not all at the end, so that
 * if a card makes it throw, what came before is still printed, as before the split.
 */
export function pendingText(
  { toApply, needOptions, withNotes, broken, warnings }: Pending,
  log: (line: string) => void,
): void {
  if (toApply.length + needOptions.length + withNotes.length + broken.length === 0) {
    log("Nothing pending.");
    for (const w of warnings) log(`(warning) ${w.fileName}: ${w.message}`);
    return;
  }
  // A withdrawn card is listed only when it would be anyway, marked, with the agent's
  // reason (202611116ff6, option `labelled`).
  const title = (c: LoadedCard) =>
    `${c.frontmatter.title}${withdrawalOf(c.frontmatter) ? " (withdrawn)" : ""}`;
  const whyWithdrawn = (c: LoadedCard) => {
    const withdrawal = withdrawalOf(c.frontmatter);
    if (withdrawal) {
      log(`    Withdrawn by an agent at ${withdrawal.at}: ${continued(withdrawal.reason)}`);
    }
  };
  const notes = (c: LoadedCard) => {
    const entries = unseenFeedback(c.frontmatter);
    for (const note of entries) {
      log(`    ${note.type ?? "note"} ${note.at}: ${continued(note.note)}`);
    }
    // Whatever came after them: a note after an undo or a reopen doesn't make them stale.
    for (const undo of entries.filter((f) => f.type === "undo")) {
      // A custom answer is its note: the choice alone says nothing (R8-3).
      const r = c.frontmatter.resolution;
      const now = needsApplying(c.frontmatter)
        ? `, then apply the current decision, ${describeDecision(r?.choice === CUSTOM_CHOICE ? r : { choice: r?.choice })}, as usual`
        : "";
      log(
        `    The human took back the earlier decision ${describeDecision(undo.previous_resolution)}. If you recorded it in the docs or changed code for it, revert that${now}, then run the done line.`,
      );
    }
    const reopened = entries.some(
      (f) => f.type === "reopen" && f.previous_resolution !== undefined,
    );
    if (reopened && c.frontmatter.status === "open") {
      log(
        '    Reopened, not decided again yet: don\'t change the docs or code for it now. Run the done line; when the human decides again, pending says "Decided again".',
      );
    }
  };
  if (toApply.length > 0) {
    log(
      "Resolved, not yet applied. Record the decision in the docs and act on it (and on any notes), then run its `done` command:",
    );
    for (const c of toApply) {
      const r = c.frontmatter.resolution;
      log(
        `  ${c.path}\n    ${title(c)} -> ${r?.choice}${r?.note ? ` (${continued(r.note)})` : ""}`,
      );
      whyWithdrawn(c);
      const earlier = earlierDecision(c.frontmatter);
      if (earlier) {
        const was = describeDecision(earlier.resolution);
        log(
          earlier.appliedAt
            ? `    Decided again: it was ${was} before, applied at ${earlier.appliedAt}. Replace the earlier record and undo work that no longer applies.`
            : `    Decided again: it was ${was} before (never applied).`,
        );
      }
      notes(c);
      log(`    done: ${done(c)}`);
    }
  }
  if (needOptions.length > 0) {
    log(
      "The human rejected the options. Write new options that answer all the feedback shown, remove `needs_new_options`, then run its `done` command:",
    );
    for (const c of needOptions) {
      log(`  ${c.path}\n    ${title(c)}`);
      whyWithdrawn(c);
      if (unseenFeedback(c.frontmatter).length > 0) {
        notes(c);
      } else {
        // Already read, but the options were never rewritten.
        const last = c.frontmatter.feedback.findLast((f) => f.type === "neither");
        if (last) log(`    neither ${last.at} (read before): ${continued(last.note)}`);
        log("    The feedback was marked read, but `needs_new_options` is still set.");
      }
      log(`    done: ${done(c)}`);
    }
  }
  if (withNotes.length > 0) {
    log("New notes from the human. Act on them, then run its `done` command:");
    for (const c of withNotes) {
      log(`  ${c.path}\n    ${title(c)} (${c.frontmatter.status})`);
      whyWithdrawn(c);
      notes(c);
      log(`    done: ${done(c)}`);
    }
  }
  if (broken.length > 0) {
    log("Broken cards (fix these; run `preside validate` for details):");
    for (const b of broken) log(`  ${b.fileName}: ${b.errors[0] ?? ""}`);
  }
  for (const w of warnings) log(`(warning) ${w.fileName}: ${w.message}`);
}

/**
 * A decision for the agent: `"km"`, or `custom ("the human's answer")`, with its note. The
 * schema checks `previous_resolution` like `resolution` (a card with a `choice` that isn't
 * text is broken), so both arrive here as text.
 */
function describeDecision(
  resolution: { choice?: string | undefined; note?: string | undefined } | undefined,
): string {
  const { choice, note } = resolution ?? {};
  const said = note?.trim() ? ` (${continued(JSON.stringify(note))})` : "";
  return choice === CUSTOM_CHOICE ? `custom${said}` : `"${choice}"${said}`;
}
