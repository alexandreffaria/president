/**
 * Which project a command run in some folder is about, so agents can run `president` from
 * any subfolder of their project.
 */
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { UserError } from "../server/errors.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";
import type { Output } from "./main.ts";
import { shellQuote } from "./shell.ts";

export interface LocatedProject {
  /** The project folder. */
  root: string;
  /** False when no folder from the start up has decisions/ (`root` is then a fallback). */
  hasDecisions: boolean;
  /** The folder the search started from. */
  start: string;
}

/**
 * The nearest folder, `start` or one of its parents, that has a decisions/ folder, not
 * looking above the root of the git repository `start` is in. Without one, the repository's
 * root (or `start` itself, outside a repository). `start` may be a decisions/ folder.
 */
export async function locateProject(start: string): Promise<LocatedProject> {
  let from = resolve(start);
  if (basename(from) === DECISIONS_DIR && (await isDirectory(from))) from = dirname(from);
  if (!(await isDirectory(from))) throw new UserError(`"${from}" is not a folder`);
  for (let dir = from; ; dir = dirname(dir)) {
    if (await isDirectory(join(dir, DECISIONS_DIR))) {
      return { root: dir, hasDecisions: true, start: from };
    }
    const atGitRoot = await exists(join(dir, ".git"));
    if (atGitRoot || dirname(dir) === dir) {
      return { root: atGitRoot ? dir : from, hasDecisions: false, start: from };
    }
  }
}

/**
 * The project at `located`, under its registered name when it has one. Says on stderr when
 * the project is a parent of the folder the command was run in, and when the hub doesn't
 * know it (its cards then never reach the human).
 */
export async function projectFor(located: LocatedProject, out: Output): Promise<Project> {
  if (located.root !== located.start) {
    out.error(`president: note: using the project at ${located.root}`);
  }
  const registered = await registeredProject(located.root).catch((error: unknown) => {
    out.error(`president: note: can't read the registry: ${(error as Error).message}`);
    return null;
  });
  if (registered === undefined) {
    out.error(
      `president: note: ${located.root} is not registered with the hub, so the human doesn't see its cards. Register it: president add ${shellQuote(located.root)}`,
    );
  }
  return registered ?? { name: basename(located.root), path: located.root };
}

/** Why there is no decisions/ folder to look at, and what to do. */
export function noDecisionsError(located: LocatedProject): UserError {
  const where =
    located.root === located.start
      ? located.start
      : `${located.start} or its parents (up to the repository root, ${located.root})`;
  return new UserError(
    `there is no ${DECISIONS_DIR}/ folder in ${where}. Run this in the project's folder, or create one and register the project: president add ${shellQuote(located.root)} --create`,
  );
}

async function registeredProject(root: string): Promise<Project | undefined> {
  const real = await realpath(root).catch(() => root);
  for (const project of await new Registry().list()) {
    if (project.path === real) return project;
    if ((await realpath(project.path).catch(() => undefined)) === real) return project;
  }
  return undefined;
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
