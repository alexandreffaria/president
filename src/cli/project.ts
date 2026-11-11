/**
 * Which project a command run in some folder is about, so agents can run `president` from
 * any subfolder of their project.
 */
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { UserError } from "../server/errors.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";
import type { Output } from "./main.ts";
import { shellQuote } from "./shell.ts";

export interface LocatedProject {
  /** The project folder. */
  root: string;
  /** False when `root` has no decisions/ folder. */
  hasDecisions: boolean;
  /** True when `root` is registered with the hub. */
  registered: boolean;
  /** The folder the search started from. */
  start: string;
}

/**
 * Which project `start` (or the decisions/ folder `start`) is in. Inside a git repository it
 * is the nearest folder from `start` up to the repository's root that is registered (unless
 * `preferRegistered` is false: `add` registers a part of a monorepo that has decisions/),
 * else the nearest that has a decisions/ folder, else the root; outside one it is `start`
 * itself, and the search for a repository never goes above $HOME.
 */
export async function locateProject(
  start: string,
  preferRegistered = true,
): Promise<LocatedProject> {
  let from = resolve(start);
  if (basename(from) === DECISIONS_DIR && (await isDirectory(from))) from = dirname(from);
  if (!(await isDirectory(from))) throw new UserError(`"${from}" is not a folder`);
  const folders = await repositoryFolders(from);
  // An unreadable registry is reported by projectFor.
  const projects = preferRegistered ? await new Registry().list().catch(() => []) : [];
  for (const dir of folders) {
    if (await registeredProject(dir, projects)) {
      const hasDecisions = await isDirectory(join(dir, DECISIONS_DIR));
      return { root: dir, hasDecisions, registered: true, start: from };
    }
  }
  for (const dir of folders) {
    if (await isDirectory(join(dir, DECISIONS_DIR))) {
      return { root: dir, hasDecisions: true, registered: false, start: from };
    }
  }
  return { root: folders.at(-1) ?? from, hasDecisions: false, registered: false, start: from };
}

/**
 * `from` and the folders above it, up to the root of the git repository it is in; only
 * `from` when it is not in one, looking no higher than $HOME.
 */
async function repositoryFolders(from: string): Promise<string[]> {
  const folders = [from];
  for (let dir = from; ; dir = dirname(dir)) {
    if (await exists(join(dir, ".git"))) return folders;
    if (dir === homedir() || dirname(dir) === dir) return [from];
    folders.push(dirname(dir));
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
    located.root === located.start || located.registered
      ? located.root
      : `${located.start} or its parents (up to the repository root, ${located.root})`;
  return new UserError(
    `there is no ${DECISIONS_DIR}/ folder in ${where}. Run this in the project's folder, or create one and register the project: president add ${shellQuote(located.root)} --create`,
  );
}

async function registeredProject(root: string, projects?: Project[]): Promise<Project | undefined> {
  const real = await realpath(root).catch(() => root);
  for (const project of projects ?? (await new Registry().list())) {
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
