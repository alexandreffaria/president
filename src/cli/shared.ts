/**
 * What the human and agent commands share: the project a command names, the worktree
 * warning, and small file and argument checks.
 */

import type { Stats } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileError, UserError } from "../server/errors.ts";
import { isNotFound } from "../server/fs-utils.ts";
import { DECISIONS_DIR, findByPath, type Project, Registry } from "../server/registry.ts";

import type { Output } from "./main.ts";
import { shellQuote } from "./shell.ts";
import { linkedWorktree } from "./worktree.ts";

/**
 * The project of a command given a folder (`validate`, `pending`): that folder, exactly as
 * given, whatever it is called. Nothing above it is looked at.
 */
export async function projectAt(path: string, out: Output): Promise<Project> {
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

export function noDecisionsError(dir: string, more = ""): UserError {
  return new UserError(
    `${dir} has no ${DECISIONS_DIR}/ folder. Run this in the project's main folder (the one that contains ${DECISIONS_DIR}/), not in a git worktree.${more}`,
  );
}

/**
 * A warning, not an error: in a git worktree `decisions/` is the worktree's own copy, so an
 * agent there misses the human's answers and marks only that copy (#0022). None for a
 * worktree registered with the hub, since the rule is "the registered folder": with a bare
 * repository, every checkout is a worktree, and the registered one is the main folder.
 */
export async function warnIfWorktree(dir: string, out: Output): Promise<void> {
  const worktree = await linkedWorktree(dir);
  if (worktree === undefined) return;
  const projects = await new Registry().list().catch(() => []);
  const registered = async (folder: string) =>
    (await findByPath(projects, await realpath(folder).catch(() => folder))) !== undefined;
  if (await registered(dir)) return;
  // The registered checkout, else the main one (none when the repository is bare).
  let main = worktree.main;
  for (const checkout of worktree.checkouts) {
    if (await registered(checkout)) {
      main = checkout;
      break;
    }
  }
  const instead =
    main !== undefined
      ? `Give preside commands paths in the project's main folder instead (${main}), and don't register a worktree with preside add.`
      : worktree.bare
        ? "The repository is bare, so every checkout is a worktree, and none is registered with president: ask the human which one is the project's main folder."
        : "Give preside commands paths in the project's main folder instead (the folder registered with president), and don't register a worktree with preside add.";
  out.error(
    `preside: warning: ${dir} is in a git worktree, which has its own copy of ${DECISIONS_DIR}/: the human's answers are not in it, and this command reads or marks only that copy. ${instead}`,
  );
}

/**
 * The project at `root`, under its registered name when it has one. Says on stderr when the
 * hub doesn't know it: its cards then never reach the human.
 */
export async function registeredAs(root: string, out: Output): Promise<Project> {
  const real = await realpath(root).catch(() => root);
  const registered = await new Registry().list().then(
    (projects) => findByPath(projects, real),
    (error: unknown) => {
      out.error(`preside: note: can't read the registry: ${(error as Error).message}`);
      return null;
    },
  );
  if (registered === undefined) {
    out.error(
      `preside: note: ${root} is not registered with the hub, so the human doesn't see its cards. Register it: preside add ${shellQuote(root)}`,
    );
  }
  return registered ?? { name: basename(root), path: root };
}

/** What is at `path` (not following a link), or undefined when nothing is; other errors say why. */
export async function lstatIfThere(path: string): Promise<Stats | undefined> {
  return lstat(path).catch((error: unknown) => {
    if (isNotFound(error)) return undefined;
    throw fileError("open", path, error);
  });
}

export async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

export async function sameFolder(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([realpath(a).catch(() => a), realpath(b).catch(() => b)]);
  return x === y;
}

export function single(positionals: string[], usage: string): string {
  const [value, ...extra] = positionals;
  if (!value || extra.length > 0) throw new UserError(`usage: preside ${usage}`);
  return value;
}
