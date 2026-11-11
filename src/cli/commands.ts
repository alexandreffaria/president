/**
 * The \`president\` commands (see main.ts for the dispatch and the help text).
 */

import type { Stats } from "node:fs";
import { cp, lstat, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import type { CardAction } from "../core/actions.ts";
import { parseCard, parseCardFileName } from "../core/card-file.ts";
import {
  agentToken,
  checkAgentToken,
  earlierDecision,
  needsApplying,
  unseenFeedback,
} from "../core/pending.ts";
import { CUSTOM_CHOICE, type Frontmatter } from "../core/schema.ts";
import {
  actOnCard,
  findCard,
  isIgnoredFile,
  type LoadedCard,
  loadProjectCards,
  revisionOf,
} from "../server/cards.ts";
import { fileError, UserError } from "../server/errors.ts";
import { isNotFound, writeFileAtomic } from "../server/fs-utils.ts";
import { DECISIONS_DIR, findByPath, type Project, Registry } from "../server/registry.ts";

import { CARD_FORMAT_DOC, DEMO_SOURCE, type Output } from "./main.ts";
import { shellQuote } from "./shell.ts";

export async function add(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" }, create: { type: "boolean" } },
  });
  const path = resolve(single(positionals, "add <path>"));
  if (
    !values.create &&
    (await isDirectory(path)) &&
    // Something else there (a file, a link) is the registry's to explain (R8-4, R9-1).
    (await lstatIfThere(join(path, DECISIONS_DIR))) === undefined
  ) {
    throw noDecisionsError(path, " Or add --create to make one here.");
  }
  const { project, alreadyRegistered, renamedFrom } = await new Registry().add({
    path,
    name: values.name,
    createDecisions: values.create,
  });
  if (await sameFolder(project.path, DEMO_SOURCE)) {
    out.error(
      "president: warning: this is president's own sample folder, tracked in git; every click in the UI changes its files. To try president, run `president demo` instead: it works on a copy.",
    );
  }
  if (alreadyRegistered && values.name !== undefined && values.name !== project.name) {
    // Also on stdout (below): an agent that reads only stdout must not think it is "foo".
    out.error(
      `president: --name ignored: this folder is already registered as "${project.name}". To rename it, run \`president remove ${shellQuote(project.name)}\` and add it again.`,
    );
  }
  const nameIgnored =
    alreadyRegistered && values.name !== undefined && values.name !== project.name;
  out.log(
    alreadyRegistered
      ? `Already registered: ${project.name} (${project.path})${nameIgnored ? `, not as "${values.name}"` : ""}`
      : `Registered ${project.name} (${project.path})`,
  );
  if (renamedFrom !== undefined) {
    out.log(
      `Another project is already named "${renamedFrom}", so this one is "${project.name}". To choose its name: president remove ${shellQuote(project.name)}, then president add <path> --name <name>.`,
    );
  }
  return 0;
}

/** `president demo`: a copy of the sample project, registered, so nothing tracked changes. */
export async function demo(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" } },
  });
  if (positionals.length > 1) throw new UserError("usage: president demo [path] [--name <name>]");
  const tempParent = positionals[0] ? undefined : await mkdtemp(join(tmpdir(), "president-demo-"));
  const target = tempParent ? join(tempParent, "demo") : resolve(positionals[0] ?? ".");
  const info = await stat(target).catch(() => undefined);
  if (info && !info.isDirectory()) {
    throw new UserError(`"${target}" is not a folder; give a new or empty folder for the demo`);
  }
  const existing = info ? await readdir(target) : undefined;
  if (existing && existing.length > 0) {
    throw new UserError(`"${target}" is not empty; give a new or empty folder for the demo`);
  }
  let project: Project;
  try {
    await cp(DEMO_SOURCE, target, { recursive: true });
    // The registry picks a free name ("demo", "demo-2"...) by creating its file exclusively.
    ({ project } = await new Registry().add({
      path: target,
      name: values.name,
      defaultName: "demo",
    }));
  } catch (error) {
    // Leave no unregistered copy behind: the folder as it was (missing, or empty).
    if (existing) {
      const copied = await readdir(target).catch(() => []);
      await Promise.all(copied.map((f) => rm(join(target, f), { recursive: true, force: true })));
    } else {
      await rm(tempParent ?? target, { recursive: true, force: true });
    }
    throw error;
  }
  out.log(`Copied the demo project to ${project.path} and registered it as "${project.name}".`);
  out.log(
    `Open the hub (\`president serve\`, http://127.0.0.1:${process.env.PRESIDENT_PORT || 4747}) to see its cards. When you are done: president remove ${shellQuote(project.name)}`,
  );
  return 0;
}

export async function list(args: string[], out: Output): Promise<number> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } } });
  const projects = await Promise.all(
    (await new Registry().list()).map(async (p) => {
      const missing = await missingFolder(p);
      return missing ? { ...p, missing } : p;
    }),
  );
  if (values.json) {
    out.log(JSON.stringify(projects, null, 2));
  } else if (projects.length === 0) {
    out.log("No projects registered. Add one with: president add <path>");
  } else {
    for (const p of projects) {
      out.log(`${p.name}\t${p.path}${"missing" in p ? `\t(${p.missing} missing)` : ""}`);
    }
    if (projects.some((p) => "missing" in p && p.missing === "folder")) {
      out.log(
        "A project is its folder: if one moved, run president remove <name>, then president add <new path>.",
      );
    }
  }
  return 0;
}

export async function remove(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const target = single(positionals, "remove <name-or-path>");
  const isPath = target.includes("/") || target.includes(sep) || target === "." || target === "..";
  const removed = await new Registry().remove(isPath ? resolve(target) : target);
  out.log(`Removed ${removed.name} (${removed.path}). Its files were not touched.`);
  return 0;
}

export async function validate(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const target = resolve(positionals[0] ?? ".");
  const info = await stat(target).catch((error: unknown) => {
    if (isNotFound(error)) throw new UserError(`"${target}" does not exist`);
    throw fileError("open", target, error);
  });
  if (info.isFile()) return validateFile(target, out);

  const project = await projectAt(target, out);
  const { cards, broken, warnings, error } = await loadProjectCards(project);
  if (error) throw new UserError(error);
  for (const card of cards) out.log(`ok      ${card.fileName}`);
  printProblems(broken, warnings, out);
  out.log(
    `\n${cards.length} valid, ${broken.length} broken in ${join(project.path, DECISIONS_DIR)}. Format: ${CARD_FORMAT_DOC}`,
  );
  return broken.length > 0 ? 1 : 0;
}

/** `president validate decisions/0012-x.md`: one card, checked in its project when it has one. */
async function validateFile(file: string, out: Output): Promise<number> {
  const fileName = basename(file);
  if (isIgnoredFile(fileName)) {
    throw new UserError(
      `"${fileName}" is not a card file: president ignores README.md, non-.md files and names starting with "." or "_"`,
    );
  }
  let ok: boolean;
  if (basename(dirname(file)) === DECISIONS_DIR) {
    // Its project is the folder that holds its decisions/ folder: this also catches a
    // duplicate id or an unknown depends_on.
    const project = await registeredAs(dirname(dirname(file)), out);
    const { cards, broken, warnings, error } = await loadProjectCards(project);
    if (error) throw new UserError(error);
    const mine = broken.filter((b) => b.fileName === fileName);
    ok = mine.length === 0 && cards.some((c) => c.fileName === fileName);
    if (ok) out.log(`ok      ${fileName}`);
    // Never exit 1 without saying why (the file went away while it was being read).
    const missing = { fileName, errors: [`not found in ${join(project.path, DECISIONS_DIR)}`] };
    printProblems(
      ok || mine.length > 0 ? mine : [missing],
      warnings.filter((w) => w.fileName === fileName),
      out,
    );
  } else {
    const result = parseCard(await readFile(file, "utf8"), fileName);
    ok = result.ok;
    if (result.ok) out.log(`ok      ${fileName}`);
    else printProblems([result.problem], [], out);
  }
  out.log(`\nFormat: ${CARD_FORMAT_DOC}`);
  return ok ? 0 : 1;
}

function printProblems(
  broken: { fileName: string; errors: string[] }[],
  warnings: { fileName: string; message: string }[],
  out: Output,
): void {
  for (const problem of broken) {
    out.error(`broken  ${problem.fileName}`);
    for (const line of problem.errors) out.error(`          - ${line}`);
  }
  for (const warning of warnings) out.error(`warning ${warning.fileName}: ${warning.message}`);
}

export async function pending(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  const project = await projectAt(positionals[0] ?? ".", out);
  const { cards, broken, warnings, error } = await loadProjectCards(project);
  if (error) throw new UserError(error);
  const toApply = cards.filter((c) => needsApplying(c.frontmatter));
  const needOptions = cards.filter(
    (c) => c.frontmatter.status === "open" && c.frontmatter.needs_new_options === true,
  );
  // Notes are listed whatever the card's status; cards in the two lists above show their
  // new notes there.
  const withNotes = cards.filter(
    (c) =>
      !toApply.includes(c) && !needOptions.includes(c) && unseenFeedback(c.frontmatter).length > 0,
  );
  /** The command that marks exactly what this output showed about the card. */
  const done = (c: LoadedCard) =>
    `president ${needsApplying(c.frontmatter) ? "applied" : "seen"} ${shellQuote(c.path)} --token ${shellQuote(agentToken(c))}`;

  if (values.json) {
    const describe = (c: LoadedCard) => ({
      id: c.id,
      title: c.frontmatter.title,
      status: c.frontmatter.status,
      path: c.path,
      new_notes: unseenFeedback(c.frontmatter),
      token: agentToken(c),
      done: done(c),
    });
    out.log(
      JSON.stringify(
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
      ),
    );
    return 0;
  }

  if (toApply.length + needOptions.length + withNotes.length + broken.length === 0) {
    out.log("Nothing pending.");
    for (const w of warnings) out.log(`(warning) ${w.fileName}: ${w.message}`);
    return 0;
  }
  const notes = (c: LoadedCard) => {
    const entries = unseenFeedback(c.frontmatter);
    for (const note of entries) {
      out.log(`    ${note.type ?? "note"} ${note.at}: ${continued(note.note)}`);
    }
    // Whatever came after them: a note after an undo or a reopen doesn't make them stale.
    for (const undo of entries.filter((f) => f.type === "undo")) {
      // A custom answer is its note: the choice alone says nothing (R8-3).
      const r = c.frontmatter.resolution;
      const now = needsApplying(c.frontmatter)
        ? `, then apply the current decision, ${describeDecision(r?.choice === CUSTOM_CHOICE ? r : { choice: r?.choice })}, as usual`
        : "";
      out.log(
        `    The human took back the earlier decision ${describeDecision(undo.previous_resolution)}. If you recorded it in the docs or changed code for it, revert that${now}, then run the done line.`,
      );
    }
    const reopened = entries.some(
      (f) => f.type === "reopen" && f.previous_resolution !== undefined,
    );
    if (reopened && c.frontmatter.status === "open") {
      out.log(
        '    Reopened, not decided again yet: don\'t change the docs or code for it now. Run the done line; when the human decides again, pending says "Decided again".',
      );
    }
  };
  if (toApply.length > 0) {
    out.log(
      "Resolved, not yet applied. Record the decision in the docs and act on it (and on any notes), then run its `done` command:",
    );
    for (const c of toApply) {
      const r = c.frontmatter.resolution;
      out.log(
        `  ${c.path}\n    ${c.frontmatter.title} -> ${r?.choice}${r?.note ? ` (${continued(r.note)})` : ""}`,
      );
      const earlier = earlierDecision(c.frontmatter);
      if (earlier) {
        const was = describeDecision(earlier.resolution);
        out.log(
          earlier.appliedAt
            ? `    Decided again: it was ${was} before, applied at ${earlier.appliedAt}. Replace the earlier record and undo work that no longer applies.`
            : `    Decided again: it was ${was} before (never applied).`,
        );
      }
      notes(c);
      out.log(`    done: ${done(c)}`);
    }
  }
  if (needOptions.length > 0) {
    out.log(
      "The human rejected the options. Write new options that answer all the feedback shown, remove `needs_new_options`, then run its `done` command:",
    );
    for (const c of needOptions) {
      out.log(`  ${c.path}\n    ${c.frontmatter.title}`);
      if (unseenFeedback(c.frontmatter).length > 0) {
        notes(c);
      } else {
        // Already read, but the options were never rewritten.
        const last = c.frontmatter.feedback.findLast((f) => f.type === "neither");
        if (last) out.log(`    neither ${last.at} (read before): ${continued(last.note)}`);
        out.log("    The feedback was marked read, but `needs_new_options` is still set.");
      }
      out.log(`    done: ${done(c)}`);
    }
  }
  if (withNotes.length > 0) {
    out.log("New notes from the human. Act on them, then run its `done` command:");
    for (const c of withNotes) {
      out.log(`  ${c.path}\n    ${c.frontmatter.title} (${c.frontmatter.status})`);
      notes(c);
      out.log(`    done: ${done(c)}`);
    }
  }
  if (broken.length > 0) {
    out.log("Broken cards (fix these; run `president validate` for details):");
    for (const b of broken) out.log(`  ${b.fileName}: ${b.errors[0] ?? ""}`);
  }
  for (const w of warnings) out.log(`(warning) ${w.fileName}: ${w.message}`);
  return 0;
}

/** A decision for the agent: `"km"`, or `custom ("the human's answer")`, with its note. */
function describeDecision(resolution: unknown): string {
  const { choice, note } = (resolution ?? {}) as { choice?: unknown; note?: unknown };
  const said =
    typeof note === "string" && note.trim() ? ` (${continued(JSON.stringify(note))})` : "";
  return choice === CUSTOM_CHOICE ? `custom${said}` : `"${String(choice)}"${said}`;
}

/**
 * Text that may span lines, with each line after the first indented to where a card's
 * notes start, so a note's own lines can't be mistaken for the output's structure.
 */
function continued(text: string, indent = "      "): string {
  return text
    .split(/\r?\n/)
    .map((line, i) => (i === 0 || line === "" ? line : indent + line))
    .join("\n");
}

export async function applied(args: string[], out: Output): Promise<number> {
  const { project, card, token } = await cardFromFile(
    args,
    "applied <card-file> --token <token>",
    out,
  );
  // The token first: "already applied" is only true of the decision the agent was shown.
  const check = checkAgentToken(card, token);
  if (!check.ok) {
    // The agent may already have acted on a decision that is gone.
    throw new UserError(
      `${check.error} If the decision pending showed you is no longer the card's (it was taken back, reopened or changed), revert what you recorded in the docs and changed for it.`,
    );
  }
  if (card.frontmatter.applied_at) {
    out.log(
      `${card.fileName} was already applied at ${card.frontmatter.applied_at}; nothing changed.`,
    );
    return 0;
  }
  const after = await act(project, card, { type: "applied", token });
  out.log(`Marked ${after.fileName} as applied at ${after.frontmatter.applied_at}.`);
  reportUnread(after, out);
  return 0;
}

export async function seen(args: string[], out: Output): Promise<number> {
  const { project, card, token } = await cardFromFile(
    args,
    "seen <card-file> --token <token>",
    out,
  );
  const check = checkAgentToken(card, token);
  if (!check.ok) throw new UserError(check.error);
  // The entries this marks: the ones shown that were not read before.
  const count = unseenFeedback({ ...card.frontmatter, feedback: check.shown }).length;
  const after = await act(project, card, { type: "seen", token });
  out.log(
    count === 0
      ? `Nothing new to mark as read on ${after.fileName}; the feedback pending showed was already read.`
      : `Marked the human's feedback on ${after.fileName} as read (${count} new ${count === 1 ? "entry" : "entries"}).`,
  );
  const lastNeither = check.shown.findLast((f) => f.type === "neither");
  if (after.frontmatter.needs_new_options && lastNeither) {
    out.error(
      "president: warning: needs_new_options is still set. Remove it once the options are rewritten, or the card stays out of the human's queue.",
    );
  }
  reportUnread(after, out);
  return 0;
}

/** What the human (and president) own in a card; an agent's rewrite keeps these as they are. */
const HUMAN_FIELDS = ["status", "resolution", "feedback", "applied_at", "seen_at"] as const;

/** Why `update` refuses a decided card, or one whose decision changed. */
const DONT_REWRITE =
  "don't rewrite it: run `president pending` and handle the card as it shows it (for a decided card, apply the decision).";

/**
 * `president update <card-file> <new-version>`: replaces a card with an agent's rewrite of
 * it (new options, recommendation, body...), only if what the human owns is the same in the
 * rewrite as in the card now. The rewrite was made from the card as the agent read it, so a
 * note the human added since (or a decision, an undo) shows up as a difference, and the card
 * is left alone instead of losing it. A decided card is never rewritten: the decision is
 * about the options and text the human saw.
 */
export async function update(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const usage = "update <card-file> <new-version-file>";
  const [cardFile, newFile, ...extra] = positionals.map((p) => resolve(p));
  if (!cardFile || !newFile || extra.length > 0) throw new UserError(`usage: president ${usage}`);
  const { project, card } = await cardAt(cardFile, out);
  if (card.frontmatter.status === "resolved") {
    throw new UserError(
      `${card.fileName} was not changed: the human decided it, and the decision is about the card as they saw it, so ${DONT_REWRITE}`,
    );
  }
  if (await sameFolder(newFile, card.path)) {
    throw new UserError(
      `give your new version of the card as a separate file (for example ${join(dirname(card.path), `.${card.fileName}.new`)}); usage: president ${usage}`,
    );
  }
  let text: string;
  try {
    text = await readFile(newFile, "utf8");
  } catch (error) {
    throw new UserError(`cannot read ${newFile}: ${(error as Error).message}`);
  }
  const parsed = parseCard(text, card.fileName);
  if (!parsed.ok) {
    // Line numbers are the new file's, so the problems are labeled with it.
    printProblems([{ fileName: newFile, errors: parsed.problem.errors }], [], out);
    out.error(
      `president: ${card.fileName} was not changed. Fix ${newFile}, then run president update again.`,
    );
    return 1;
  }
  const mine = parsed.card.frontmatter;
  const changes = humanChanges(card.frontmatter, mine);
  // A deferral or a reopen alone is like a note: the rewrite can be made again (R7-5).
  if (changes.some((c) => c.startsWith("resolution:"))) {
    throw new UserError(
      `${card.fileName} was not changed: its decision changed since you read it (the human took back a decision), or your version changes it, so ${DONT_REWRITE}`,
      { details: changes },
    );
  }
  if (changes.length > 0) {
    throw new UserError(
      `${card.fileName} was not changed: what the human owns differs between the card and your version, so the card changed since you read it. Read the card again, make your changes to it as it is now (keep ${HUMAN_FIELDS.join(", ")} exactly as they are), and run president update again:`,
      { details: changes },
    );
  }
  // The card must still be what was compared (the hub may write it at any moment).
  if (revisionOf(await readFile(card.path, "utf8")) !== card.revision) {
    throw new UserError(`${card.fileName} changed while updating it; run president update again`);
  }
  await writeFileAtomic(card.path, text);
  out.log(`Updated ${card.fileName}. Remove ${newFile} once you no longer need it.`);
  // The checks `validate` runs across the project (a depends_on that names no card).
  const { warnings } = await loadProjectCards(project);
  printProblems(
    [],
    warnings.filter((w) => w.fileName === card.fileName),
    out,
  );
  if (mine.needs_new_options) {
    out.error(
      "president: warning: needs_new_options is still set. Remove it once the options are rewritten, or the card stays out of the human's queue.",
    );
  }
  return 0;
}

/** How what the human owns differs from the card (`now`) to an agent's rewrite (`mine`). */
function humanChanges(now: Frontmatter, mine: Frontmatter): string[] {
  const changes: string[] = [];
  const isPrefix = (short: Frontmatter["feedback"], long: Frontmatter["feedback"]) =>
    isDeepStrictEqual(long.slice(0, short.length), short);
  const entries = (list: Frontmatter["feedback"]) =>
    list.map((f) => `${f.type ?? "note"} ${f.at}: ${continued(f.note, "    ")}`);
  if (now.feedback.length > mine.feedback.length && isPrefix(mine.feedback, now.feedback)) {
    const added = now.feedback.slice(mine.feedback.length);
    changes.push(
      `feedback: the human added ${added.length} ${added.length === 1 ? "entry" : "entries"} since you read the card:`,
      ...entries(added),
    );
  } else if (now.feedback.length < mine.feedback.length && isPrefix(now.feedback, mine.feedback)) {
    const gone = mine.feedback.slice(now.feedback.length);
    changes.push(
      `feedback: the human took back ${gone.length} ${gone.length === 1 ? "entry" : "entries"} since you read the card; drop ${gone.length === 1 ? "it" : "them"} from your version, and undo anything you changed for ${gone.length === 1 ? "it" : "them"}:`,
      ...entries(gone),
    );
  } else if (!isDeepStrictEqual(now.feedback, mine.feedback)) {
    changes.push("feedback: your version's entries are not the card's; copy them unchanged");
  }
  for (const field of HUMAN_FIELDS) {
    if (field === "feedback" || isDeepStrictEqual(now[field], mine[field])) continue;
    changes.push(
      `${field}: the card has ${describe(now[field])}, your version ${describe(mine[field])}`,
    );
  }
  return changes;
}

function describe(value: unknown): string {
  if (value === undefined) return "none";
  if (typeof value === "string") return `"${value}"`;
  const choice = (value as { choice?: unknown }).choice;
  return choice === undefined ? JSON.stringify(value) : `a decision ("${String(choice)}")`;
}

/** Feedback that arrived after the agent ran `pending` stays unread; say so. */
function reportUnread(card: LoadedCard, out: Output): void {
  const unread = unseenFeedback(card.frontmatter).length;
  if (unread === 0) return;
  out.log(
    `The human added ${unread} more ${unread === 1 ? "note" : "notes"} since you ran \`president pending\`; they are still unread. Run \`president pending\` again.`,
  );
}

function act(project: Project, card: LoadedCard, action: CardAction): Promise<LoadedCard> {
  // The revision we just read: if the human acts on the card in between, this fails
  // instead of overwriting what they did.
  return actOnCard(project, card.id, action, { revision: card.revision });
}

/**
 * The card a `<card-file> --token <token>` pair names; the file must exist and be that
 * card's file.
 */
async function cardFromFile(
  args: string[],
  usage: string,
  out: Output,
): Promise<{ project: Project; card: LoadedCard; token: string }> {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: { token: { type: "string" } },
  });
  const file = resolve(single(positionals, usage));
  const token = values.token;
  if (!token) {
    throw new UserError(
      `--token is required: run \`president pending\` and use the \`done\` command it prints for this card (usage: president ${usage})`,
    );
  }
  return { ...(await cardAt(file, out)), token };
}

/**
 * The card whose file is `file`. A card is its id: when an agent renamed the file (a new
 * slug), the card with that id in the same decisions/ folder is used, and the note says so.
 */
async function cardAt(file: string, out: Output): Promise<{ project: Project; card: LoadedCard }> {
  const name = parseCardFileName(basename(file));
  if (!name || basename(dirname(file)) !== DECISIONS_DIR) {
    throw new UserError(`"${file}" is not a card file inside a ${DECISIONS_DIR}/ folder`);
  }
  const dir = dirname(dirname(file));
  const project = { name: basename(dir), path: dir };
  const exists = (await stat(file).catch(() => undefined))?.isFile() ?? false;
  const found = await findCard(project, name.id).catch((error: unknown) => {
    if (!exists) throw new UserError(`"${file}" does not exist`);
    throw error;
  });
  if (!found.ok) {
    throw new UserError(
      `${found.broken.fileName} is broken. Fix it by editing the file directly (president doesn't write broken cards, so this is the one case to edit a card yourself), then run this again`,
      {
        details: found.broken.errors,
      },
    );
  }
  if (found.card.fileName !== basename(file)) {
    if (exists) {
      throw new UserError(
        `card ${name.id} is ${found.card.fileName}, not ${basename(file)}; check the file name`,
      );
    }
    out.error(
      `president: note: card ${name.id} is now ${found.card.fileName} (renamed since); using that file`,
    );
  }
  return { project, card: found.card };
}

export async function serve(out: Output): Promise<number> {
  const { runServer } = await import("../server/server.ts");
  return runServer(out);
}

/** "folder" when the project's folder is gone, "decisions/ folder" when only that is. */
async function missingFolder(project: Project): Promise<string | undefined> {
  if (!(await isDirectory(project.path))) return "folder";
  if (!(await isDirectory(join(project.path, DECISIONS_DIR)))) return `${DECISIONS_DIR}/ folder`;
  return undefined;
}

/**
 * The project of a command given a folder (`validate`, `pending`): that folder, exactly as
 * given, whatever it is called. Nothing above it is looked at.
 */
async function projectAt(path: string, out: Output): Promise<Project> {
  const dir = resolve(path);
  const found = await stat(dir).catch((error: unknown) => {
    if (isNotFound(error)) throw new UserError(`"${dir}" does not exist`);
    throw fileError("open", dir, error);
  });
  if (!found.isDirectory()) throw new UserError(`"${dir}" is not a folder`);
  const decisions = join(dir, DECISIONS_DIR);
  if (!(await isDirectory(decisions))) {
    // Nothing there is a missing folder; anything else (a file, a link to nothing) is not one (R9-1).
    if ((await lstatIfThere(decisions)) === undefined) throw noDecisionsError(dir);
    throw new UserError(`"${decisions}" is not a folder`);
  }
  return registeredAs(dir, out);
}

function noDecisionsError(dir: string, more = ""): UserError {
  return new UserError(
    `${dir} has no ${DECISIONS_DIR}/ folder. Run this from the project root (the folder that contains ${DECISIONS_DIR}/).${more}`,
  );
}

/**
 * The project at `root`, under its registered name when it has one. Says on stderr when the
 * hub doesn't know it: its cards then never reach the human.
 */
async function registeredAs(root: string, out: Output): Promise<Project> {
  const real = await realpath(root).catch(() => root);
  const registered = await new Registry().list().then(
    (projects) => findByPath(projects, real),
    (error: unknown) => {
      out.error(`president: note: can't read the registry: ${(error as Error).message}`);
      return null;
    },
  );
  if (registered === undefined) {
    out.error(
      `president: note: ${root} is not registered with the hub, so the human doesn't see its cards. Register it: president add ${shellQuote(root)}`,
    );
  }
  return registered ?? { name: basename(root), path: root };
}

/** What is at `path` (not following a link), or undefined when nothing is; other errors say why. */
async function lstatIfThere(path: string): Promise<Stats | undefined> {
  return lstat(path).catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw fileError("open", path, error);
  });
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

async function sameFolder(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([realpath(a).catch(() => a), realpath(b).catch(() => b)]);
  return x === y;
}

function single(positionals: string[], usage: string): string {
  const [value, ...extra] = positionals;
  if (!value || extra.length > 0) throw new UserError(`usage: president ${usage}`);
  return value;
}
