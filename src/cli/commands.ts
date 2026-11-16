/**
 * The `preside` commands for the human: registering projects, the demo and the hub (see
 * main.ts for the dispatch and the help text). The commands agents run on cards are in
 * agent.ts and pending.ts.
 */

import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { UserError } from "../server/errors.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";

import { DEMO_SOURCE, type Output } from "./main.ts";
import {
  isDirectory,
  lstatIfThere,
  noDecisionsError,
  registeredCheckout,
  sameFolder,
  single,
} from "./shared.ts";
import { shellQuote } from "./shell.ts";

export async function add(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" }, create: { type: "boolean" } },
  });
  const path = resolve(single(positionals, "add <path>"));
  // A hint, not a refusal: the human may register a worktree on purpose.
  const other = await registeredCheckout(path, await new Registry().list().catch(() => []));
  if (other && !(await sameFolder(other.at, path))) {
    out.error(
      `preside: warning: ${path} is a git worktree of ${other.project.name}, registered at ${other.at}; the hub already shows the cards of every checkout of it, so registering this one too shows them twice. Run \`preside remove ${shellQuote(path)}\` to undo.`,
    );
  }
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
      "preside: warning: this is president's own sample folder, tracked in git; every click in the UI changes its files. To try president, run `preside demo` instead: it works on a copy.",
    );
  }
  if (alreadyRegistered && values.name !== undefined && values.name !== project.name) {
    // Also on stdout (below): an agent that reads only stdout must not think it is "foo".
    out.error(
      `preside: --name ignored: this folder is already registered as "${project.name}". To rename it, run \`preside remove ${shellQuote(project.name)}\` and add it again.`,
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
      `Another project is already named "${renamedFrom}", so this one is "${project.name}". To choose its name: preside remove ${shellQuote(project.name)}, then preside add <path> --name <name>.`,
    );
  }
  return 0;
}

/** `preside demo`: a copy of the sample project, registered, so nothing tracked changes. */
export async function demo(args: string[], out: Output): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { name: { type: "string" } },
  });
  if (positionals.length > 1) throw new UserError("usage: preside demo [path] [--name <name>]");
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
    `Open the hub (\`preside serve\`, http://127.0.0.1:${process.env.PRESIDENT_PORT || 4747}) to see its cards. When you are done: preside remove ${shellQuote(project.name)}`,
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
    out.log("No projects registered. Add one with: preside add <path>");
  } else {
    for (const p of projects) {
      out.log(`${p.name}\t${p.path}${"missing" in p ? `\t(${p.missing} missing)` : ""}`);
    }
    if (projects.some((p) => "missing" in p && p.missing === "folder")) {
      out.log(
        "A project is its folder: if one moved, run preside remove <name>, then preside add <new path>.",
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
