/**
 * The `president` command line. Used by humans to run the hub and by agents to register
 * projects, validate the cards they wrote and find cards that need their attention.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { CardAction } from "../core/actions.ts";
import { parseCard, parseCardFileName } from "../core/card-file.ts";
import { earlierDecision, needsApplying, unseenFeedback } from "../core/pending.ts";
import {
  actOnCard,
  findCard,
  isIgnoredFile,
  type LoadedCard,
  loadProjectCards,
} from "../server/cards.ts";
import { UserError } from "../server/errors.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";

/** The card format spec, so agents in other projects can find it. */
export const CARD_FORMAT_DOC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "card-format.md",
);

const HELP = `president: decision cards for humans, written by agents

Usage:
  president add <path> [--name <name>] [--create]
      Register a project folder with the hub. --create makes <path>/decisions/ if missing.
  president list [--json]
      Show registered projects.
  president remove <name-or-path>
      Unregister a project (its files are not touched).
  president validate [path]
      Check every card in <path>/decisions/ (default: current folder), or one card file.
      Exit code 1 if any is broken.
  president pending [path] [--json]
      What an agent should act on: resolved cards not yet applied, cards where the human
      rejected all options, and new notes from the human.
  president applied <card-file>
      Mark a resolved card as applied (sets applied_at) after updating the project's docs.
  president seen <card-file>
      Mark the human's notes on a card as read (sets seen_at), after acting on them.
  president serve
      Start the hub web app (needs \`npm run build\` first for the UI).

Environment:
  PRESIDENT_PORT     port for \`serve\` (default 4747)
  XDG_CONFIG_HOME    the registry lives in $XDG_CONFIG_HOME/president/projects.json

Card format: ${CARD_FORMAT_DOC}
`;

type Output = { log: (line: string) => void; error: (line: string) => void };

export async function run(argv: string[], out: Output = console): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "add":
        return await add(rest, out);
      case "list":
      case "ls":
        return await list(rest, out);
      case "remove":
      case "rm":
        return await remove(rest, out);
      case "validate":
        return await validate(rest, out);
      case "pending":
        return await pending(rest, out);
      case "applied":
        return await applied(rest, out);
      case "seen":
        return await seen(rest, out);
      case "serve":
      case "start":
        return await serve(out);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        out.log(HELP);
        return 0;
      default:
        out.error(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof UserError || isArgError(error)) {
      out.error(`president: ${(error as Error).message}`);
      for (const line of (error as UserError).details ?? []) out.error(`  - ${line}`);
      return 1;
    }
    throw error;
  }
}

async function add(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" }, create: { type: "boolean" } },
  });
  const path = single(positionals, "add <path>");
  const { project, alreadyRegistered } = await new Registry().add({
    path: resolve(path),
    name: values.name,
    createDecisions: values.create,
  });
  if (alreadyRegistered && values.name !== undefined && values.name !== project.name) {
    out.error(
      `president: --name ignored: this folder is already registered as "${project.name}". To rename it, run \`president remove ${project.name}\` and add it again.`,
    );
  }
  out.log(
    alreadyRegistered
      ? `Already registered: ${project.name} (${project.path})`
      : `Registered ${project.name} (${project.path})`,
  );
  return 0;
}

async function list(args: string[], out: Output): Promise<number> {
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

async function remove(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const target = single(positionals, "remove <name-or-path>");
  const isPath = target.includes("/") || target.includes(sep) || target === "." || target === "..";
  const removed = await new Registry().remove(isPath ? resolve(target) : target);
  out.log(`Removed ${removed.name} (${removed.path}). Its files were not touched.`);
  return 0;
}

async function validate(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const target = resolve(positionals[0] ?? ".");
  const info = await stat(target).catch(() => undefined);
  if (info?.isFile()) return validateFile(target, out);

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

async function pending(args: string[], out: Output): Promise<number> {
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
  // Cards in the two lists above get read in full anyway.
  const withNotes = cards.filter(
    (c) =>
      !toApply.includes(c) && !needOptions.includes(c) && unseenFeedback(c.frontmatter).length > 0,
  );

  if (values.json) {
    const describe = (c: LoadedCard) => ({
      id: c.id,
      title: c.frontmatter.title,
      status: c.frontmatter.status,
      path: c.path,
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
          new_notes: withNotes.map((c) => ({
            ...describe(c),
            notes: unseenFeedback(c.frontmatter),
          })),
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
  if (toApply.length > 0) {
    out.log("Resolved, not yet applied (update the docs, then `president applied <file>`):");
    for (const c of toApply) {
      const r = c.frontmatter.resolution;
      out.log(
        `  ${c.path}\n    ${c.frontmatter.title} -> ${r?.choice}${r?.note ? ` (${r.note})` : ""}`,
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
    }
  }
  if (needOptions.length > 0) {
    out.log(
      "The human rejected the options; write new ones from the latest feedback, then `president seen <file>`:",
    );
    for (const c of needOptions) {
      const last = c.frontmatter.feedback.findLast((f) => f.type === "neither");
      out.log(
        `  ${c.path}\n    ${c.frontmatter.title}${last ? `\n    feedback: ${last.note}` : ""}`,
      );
    }
  }
  if (withNotes.length > 0) {
    out.log("New notes from the human (act on them, then `president seen <file>`):");
    for (const c of withNotes) {
      out.log(`  ${c.path}\n    ${c.frontmatter.title} (${c.frontmatter.status})`);
      for (const note of unseenFeedback(c.frontmatter)) {
        out.log(`    ${note.type ?? "note"} ${note.at}: ${note.note}`);
      }
    }
  }
  if (broken.length > 0) {
    out.log("Broken cards (fix these; run `president validate` for details):");
    for (const b of broken) out.log(`  ${b.fileName}: ${b.errors[0] ?? ""}`);
  }
  for (const w of warnings) out.log(`(warning) ${w.fileName}: ${w.message}`);
  return 0;
}

async function applied(args: string[], out: Output): Promise<number> {
  const { project, card } = await cardFromFile(args, "applied <card-file>");
  if (card.frontmatter.applied_at) {
    out.log(
      `${card.fileName} was already applied at ${card.frontmatter.applied_at}; nothing changed.`,
    );
    return 0;
  }
  const after = await act(project, card, { type: "applied" });
  out.log(`Marked ${after.fileName} as applied at ${after.frontmatter.applied_at}.`);
  return 0;
}

async function seen(args: string[], out: Output): Promise<number> {
  const { project, card } = await cardFromFile(args, "seen <card-file>");
  const after = await act(project, card, { type: "seen" });
  out.log(`Marked the feedback on ${after.fileName} as seen at ${after.frontmatter.seen_at}.`);
  return 0;
}

function act(project: Project, card: LoadedCard, action: CardAction): Promise<LoadedCard> {
  // The revision we just read: if the human acts on the card in between, this fails
  // instead of overwriting what they did.
  return actOnCard(project, card.id, action, { revision: card.revision });
}

/** The card a `<card-file>` argument names; it must exist and be that card's file. */
async function cardFromFile(
  args: string[],
  usage: string,
): Promise<{ project: Project; card: LoadedCard }> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const file = resolve(single(positionals, usage));
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
  return { project, card: found.card };
}

async function serve(out: Output): Promise<number> {
  const { runServer } = await import("../server/server.ts");
  return runServer(out);
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

function isArgError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS");
}
