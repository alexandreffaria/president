/**
 * The \`president\` commands (see main.ts for the dispatch and the help text).
 */
import { cp, mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import type { CardAction } from "../core/actions.ts";
import { parseCard, parseCardFileName } from "../core/card-file.ts";
import {
  agentToken,
  checkAgentToken,
  earlierDecision,
  needsApplying,
  unseenFeedback,
} from "../core/pending.ts";
import {
  actOnCard,
  findCard,
  isIgnoredFile,
  type LoadedCard,
  loadProjectCards,
} from "../server/cards.ts";
import { UserError } from "../server/errors.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";

import { CARD_FORMAT_DOC, DEMO_SOURCE, type Output } from "./main.ts";
import { shellQuote } from "./shell.ts";

export async function add(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" }, create: { type: "boolean" } },
  });
  const path = single(positionals, "add <path>");
  const { project, alreadyRegistered, renamedFrom } = await new Registry().add({
    path: resolve(path),
    name: values.name,
    createDecisions: values.create,
  });
  if (await sameFolder(project.path, DEMO_SOURCE)) {
    out.error(
      "president: warning: this is president's own sample folder, tracked in git; every click in the UI changes its files. To try president, run `president demo` instead: it works on a copy.",
    );
  }
  if (alreadyRegistered && values.name !== undefined && values.name !== project.name) {
    out.error(
      `president: --name ignored: this folder is already registered as "${project.name}". To rename it, run \`president remove ${shellQuote(project.name)}\` and add it again.`,
    );
  }
  out.log(
    alreadyRegistered
      ? `Already registered: ${project.name} (${project.path})`
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
  const projects = await new Registry().list();
  if (values.json) {
    out.log(JSON.stringify(projects, null, 2));
  } else if (projects.length === 0) {
    out.log("No projects registered. Add one with: president add <path>");
  } else {
    for (const p of projects) out.log(`${p.name}\t${p.path}`);
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
  const info = await stat(target).catch(() => undefined);
  if (!info) throw new UserError(`"${target}" does not exist`);
  if (info.isFile()) return validateFile(target, out);

  const project = await projectAt(target);
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
    // Inside a project: also catches a duplicate id or an unknown depends_on.
    const project = await projectAt(dirname(dirname(file)));
    const { cards, broken, warnings } = await loadProjectCards(project);
    const mine = broken.filter((b) => b.fileName === fileName);
    ok = mine.length === 0 && cards.some((c) => c.fileName === fileName);
    if (ok) out.log(`ok      ${fileName}`);
    printProblems(
      mine,
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
  const project = await projectAt(positionals[0] ?? ".");
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
    for (const note of unseenFeedback(c.frontmatter)) {
      out.log(`    ${note.type ?? "note"} ${note.at}: ${continued(note.note)}`);
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
        const was = (earlier.resolution as { choice?: unknown } | undefined)?.choice;
        out.log(
          earlier.appliedAt
            ? `    Decided again: it was "${String(was)}" before, applied at ${earlier.appliedAt}. Replace the earlier record and undo work that no longer applies.`
            : `    Decided again: it was "${String(was)}" before (never applied).`,
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
  const { project, card, token } = await cardFromFile(args, "applied <card-file> --token <token>");
  // The token first: "already applied" is only true of the decision the agent was shown.
  const check = checkAgentToken(card, token);
  if (!check.ok) throw new UserError(check.error);
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
  const { project, card, token } = await cardFromFile(args, "seen <card-file> --token <token>");
  const check = checkAgentToken(card, token);
  if (!check.ok) throw new UserError(check.error);
  const after = await act(project, card, { type: "seen", token });
  const count = check.shown.length;
  out.log(
    `Marked the human's feedback on ${after.fileName} as read (${count} ${count === 1 ? "entry" : "entries"}).`,
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
  const name = parseCardFileName(basename(file));
  if (!name || basename(dirname(file)) !== DECISIONS_DIR) {
    throw new UserError(`"${file}" is not a card file inside a ${DECISIONS_DIR}/ folder`);
  }
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw new UserError(`"${file}" does not exist`);
  const project = await projectAt(dirname(dirname(file)));
  const found = await findCard(project, name.id);
  if (!found.ok) {
    throw new UserError(`${found.broken.fileName} is broken; fix it first`, {
      details: found.broken.errors,
    });
  }
  if (found.card.fileName !== basename(file)) {
    throw new UserError(
      `card ${name.id} is ${found.card.fileName}, not ${basename(file)}; check the file name`,
    );
  }
  return { project, card: found.card, token };
}

export async function serve(out: Output): Promise<number> {
  const { runServer } = await import("../server/server.ts");
  return runServer(out);
}

async function sameFolder(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([realpath(a).catch(() => a), realpath(b).catch(() => b)]);
  return x === y;
}

/** A project for commands that work on a folder, whether or not it is registered. */
async function projectAt(path: string): Promise<Project> {
  let dir = resolve(path);
  if (basename(dir) === DECISIONS_DIR) dir = dirname(dir);
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) throw new UserError(`"${dir}" is not a folder`);
  return { name: basename(dir), path: dir };
}

function single(positionals: string[], usage: string): string {
  const [value, ...extra] = positionals;
  if (!value || extra.length > 0) throw new UserError(`usage: president ${usage}`);
  return value;
}
