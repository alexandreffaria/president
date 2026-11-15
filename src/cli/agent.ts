/**
 * The card commands the decision-cards skill has agents run: `validate`, `applied`,
 * `seen` and `update` (`pending` is in pending.ts). See main.ts for the dispatch and
 * the help text.
 */

import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { CardAction } from "../core/actions.ts";
import { parseCard, parseCardFileName } from "../core/card-file.ts";
import { checkAgentToken, unseenFeedback } from "../core/pending.ts";
import { HUMAN_FIELDS, humanChanges } from "../core/rewrite.ts";
import { cardWarnings, type Frontmatter, formatWarning, withdrawalOf } from "../core/schema.ts";
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
import { DECISIONS_DIR, type Project } from "../server/registry.ts";

import { CARD_FORMAT_DOC, type Output } from "./main.ts";
import { projectAt, registeredAs, sameFolder, single, warnIfWorktree } from "./shared.ts";

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
  for (const card of cards) out.log(okLine(card.fileName, card.frontmatter));
  printProblems(broken, warnings, out);
  out.log(
    `\n${cards.length} valid, ${broken.length} broken in ${join(project.path, DECISIONS_DIR)}. Format: ${CARD_FORMAT_DOC}`,
  );
  return broken.length > 0 ? 1 : 0;
}

/** `preside validate decisions/0012-x.md`: one card, checked in its project when it has one. */
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
    const card = mine.length === 0 ? cards.find((c) => c.fileName === fileName) : undefined;
    ok = card !== undefined;
    if (card) out.log(okLine(fileName, card.frontmatter));
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
    if (result.ok) {
      const { frontmatter, fieldLines } = result.card;
      out.log(okLine(fileName, frontmatter));
      const warnings = cardWarnings(frontmatter).map((w) => ({
        fileName,
        message: formatWarning(w, fieldLines),
      }));
      printProblems([], warnings, out);
    } else {
      printProblems([result.problem], [], out);
    }
  }
  out.log(`\nFormat: ${CARD_FORMAT_DOC}`);
  return ok ? 0 : 1;
}

/**
 * `validate`'s line for a valid card; a withdrawn card's line says so and why
 * (202611116ff6): `ok      0042-map-tiles.md (withdrawn: We dropped the map screen.)`.
 */
function okLine(fileName: string, card: Frontmatter): string {
  const withdrawal = withdrawalOf(card);
  return withdrawal
    ? `ok      ${fileName} (withdrawn: ${oneLine(withdrawal.reason)})`
    : `ok      ${fileName}`;
}

/** Text on one line: every run of whitespace, line breaks included, becomes one space. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
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
      "preside: warning: needs_new_options is still set. Remove it once the options are rewritten, or the card stays out of the human's queue.",
    );
  }
  reportUnread(after, out);
  return 0;
}

/** Why `update` refuses a decided card, or one whose decision changed. */
const DONT_REWRITE =
  "don't rewrite it: run `preside pending` and handle the card as it shows it (for a decided card, apply the decision).";

/**
 * `preside update <card-file> <new-version>`: replaces a card with an agent's rewrite of
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
  if (!cardFile || !newFile || extra.length > 0) throw new UserError(`usage: preside ${usage}`);
  const { project, card } = await cardAt(cardFile, out);
  if (card.frontmatter.status === "resolved") {
    throw new UserError(
      `${card.fileName} was not changed: the human decided it, and the decision is about the card as they saw it, so ${DONT_REWRITE}`,
    );
  }
  if (await sameFolder(newFile, card.path)) {
    throw new UserError(
      `give your new version of the card as a separate file (for example ${join(dirname(card.path), `.${card.fileName}.new`)}); usage: preside ${usage}`,
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
      `preside: ${card.fileName} was not changed. Fix ${newFile}, then run preside update again.`,
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
      `${card.fileName} was not changed: what the human owns differs between the card and your version, so the card changed since you read it. Read the card again, make your changes to it as it is now (keep ${HUMAN_FIELDS.join(", ")} exactly as they are), and run preside update again:`,
      { details: changes },
    );
  }
  // The card must still be what was compared (the hub may write it at any moment).
  if (revisionOf(await readFile(card.path, "utf8")) !== card.revision) {
    throw new UserError(`${card.fileName} changed while updating it; run preside update again`);
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
      "preside: warning: needs_new_options is still set. Remove it once the options are rewritten, or the card stays out of the human's queue.",
    );
  }
  return 0;
}

/** Feedback that arrived after the agent ran `pending` stays unread; say so. */
function reportUnread(card: LoadedCard, out: Output): void {
  const unread = unseenFeedback(card.frontmatter).length;
  if (unread === 0) return;
  out.log(
    `The human added ${unread} more ${unread === 1 ? "note" : "notes"} since you ran \`preside pending\`; they are still unread. Run \`preside pending\` again.`,
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
      `--token is required: run \`preside pending\` and use the \`done\` command it prints for this card (usage: preside ${usage})`,
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
  await warnIfWorktree(dir, out);
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
      `preside: note: card ${name.id} is now ${found.card.fileName} (renamed since); using that file`,
    );
  }
  return { project, card: found.card };
}
