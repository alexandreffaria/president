/**
 * The `president` command line. Used by humans to run the hub and by agents to register
 * projects, validate the cards they wrote and find cards that need their attention.
 */
import { stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseCardFileName } from "../core/card-file.ts";
import { actOnCard, type LoadedCard, loadProjectCards } from "../server/cards.ts";
import { UserError } from "../server/errors.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";

const HELP = `president: decision cards for humans, written by agents

Usage:
  president add <path> [--name <name>] [--create]
      Register a project folder with the hub. --create makes <path>/decisions/ if missing.
  president list [--json]
      Show registered projects.
  president remove <name-or-path>
      Unregister a project (its files are not touched).
  president validate [path]
      Check every card in <path>/decisions/ (default: current folder). Exit code 1 if any is broken.
  president pending [path] [--json]
      Cards an agent should act on: resolved but not yet applied, and cards where the
      human rejected all options and asked for new ones.
  president applied <card-file>
      Mark a resolved card as applied (sets applied_at) after updating the project's docs.
  president serve
      Start the hub web app (needs \`npm run build\` first for the UI).

Environment:
  PRESIDENT_PORT     port for \`serve\` (default 4747)
  XDG_CONFIG_HOME    the registry lives in $XDG_CONFIG_HOME/president/projects.json
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
  const isPath = target.includes("/") || target === ".";
  const removed = await new Registry().remove(isPath ? resolve(target) : target);
  out.log(`Removed ${removed.name} (${removed.path}). Its files were not touched.`);
  return 0;
}

async function validate(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const project = await projectAt(positionals[0] ?? ".");
  const { cards, broken, error } = await loadProjectCards(project);
  if (error) throw new UserError(error);
  for (const card of cards) out.log(`ok      ${card.fileName}`);
  for (const problem of broken) {
    out.error(`broken  ${problem.fileName}`);
    for (const line of problem.errors) out.error(`          - ${line}`);
  }
  out.log(
    `\n${cards.length} valid, ${broken.length} broken in ${project.path}/${DECISIONS_DIR}. Format: docs/card-format.md in the president repo.`,
  );
  return broken.length > 0 ? 1 : 0;
}

async function pending(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { json: { type: "boolean" } },
  });
  const project = await projectAt(positionals[0] ?? ".");
  const { cards, broken, error } = await loadProjectCards(project);
  if (error) throw new UserError(error);
  const toApply = cards.filter(
    (c) => c.frontmatter.status === "resolved" && !c.frontmatter.applied_at,
  );
  const needOptions = cards.filter(
    (c) => c.frontmatter.status === "open" && c.frontmatter.needs_new_options === true,
  );

  if (values.json) {
    const describe = (c: LoadedCard) => ({ id: c.id, title: c.frontmatter.title, path: c.path });
    out.log(
      JSON.stringify(
        {
          resolved_not_applied: toApply.map((c) => ({
            ...describe(c),
            resolution: c.frontmatter.resolution,
          })),
          needs_new_options: needOptions.map((c) => ({
            ...describe(c),
            feedback: c.frontmatter.feedback,
          })),
          broken: broken.map((b) => ({ file: b.fileName, errors: b.errors })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (toApply.length + needOptions.length + broken.length === 0) {
    out.log("Nothing pending.");
    return 0;
  }
  if (toApply.length > 0) {
    out.log("Resolved, not yet applied (update the docs, then `president applied <file>`):");
    for (const c of toApply) {
      const r = c.frontmatter.resolution;
      out.log(
        `  ${c.path}\n    ${c.frontmatter.title} -> ${r?.choice}${r?.note ? ` (${r.note})` : ""}`,
      );
    }
  }
  if (needOptions.length > 0) {
    out.log("The human rejected the options; write new ones from the latest feedback:");
    for (const c of needOptions) {
      const last = c.frontmatter.feedback.at(-1);
      out.log(
        `  ${c.path}\n    ${c.frontmatter.title}${last ? `\n    feedback: ${last.note}` : ""}`,
      );
    }
  }
  if (broken.length > 0) {
    out.log("Broken cards (fix these; run `president validate` for details):");
    for (const b of broken) out.log(`  ${b.fileName}: ${b.errors[0] ?? ""}`);
  }
  return 0;
}

async function applied(args: string[], out: Output): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true });
  const file = resolve(single(positionals, "applied <card-file>"));
  const name = parseCardFileName(basename(file));
  if (!name || basename(dirname(file)) !== DECISIONS_DIR) {
    throw new UserError(`"${file}" is not a card file inside a ${DECISIONS_DIR}/ folder`);
  }
  const projectPath = dirname(dirname(file));
  const card = await actOnCard({ name: basename(projectPath), path: projectPath }, name.id, {
    type: "applied",
  });
  out.log(`Marked ${card.fileName} as applied at ${card.frontmatter.applied_at}.`);
  return 0;
}

async function serve(out: Output): Promise<number> {
  const { startHub } = await import("../server/server.ts");
  const hub = await startHub();
  out.log(`president is running at ${hub.url}`);
  await new Promise<void>((resolveStop) => {
    const stop = () => resolveStop();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await hub.close();
  return 0;
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
