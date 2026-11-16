/**
 * What the human and agent commands share: the project a command names, and small file and
 * argument checks. A command works in the checkout it is given (a worktree or the
 * registered folder alike): a card lives on the branch whose work it unblocks, and the hub
 * reads every checkout of a registered project.
 */

import type { Stats } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { checkoutsOf, registeredCheckout } from "../server/checkouts.ts";
import { fileError, UserError } from "../server/errors.ts";
import { isNotFound } from "../server/fs-utils.ts";
import { DECISIONS_DIR, type Project, Registry } from "../server/registry.ts";

import type { Output } from "./main.ts";
import { shellQuote } from "./shell.ts";

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
    if ((await lstatIfThere(decisions)) === undefined) {
      // A new project: say how to register it, which also makes the folder.
      const projects = await new Registry().list().catch(() => []);
      const known = await registeredCheckout(dir, projects);
      throw noDecisionsError(
        dir,
        known
          ? ""
          : ` No checkout of it is registered with the hub either. If this is a new project's folder, register it, which makes the folder: preside add ${shellQuote(dir)} --create${await worktreeHint(dir)}`,
      );
    }
    throw new UserError(`"${decisions}" is not a folder`);
  }
  return registeredAs(dir, out);
}

export function noDecisionsError(dir: string, more = ""): UserError {
  return new UserError(
    `${dir} has no ${DECISIONS_DIR}/ folder.${more || ` If this is the project's folder (the registered one, or a checkout of it) and its branch has no cards yet, create ${DECISIONS_DIR}/ to write the first card.`}`,
  );
}

/**
 * The project at `root`, under its registered name when it (or another checkout of it, see
 * {@link registeredCheckout}) has one; its path is `root` either way, the checkout the
 * command works in. Says on stderr when the hub doesn't know it: its cards then never reach
 * the human.
 */
export async function registeredAs(root: string, out: Output): Promise<Project> {
  const registered = await new Registry().list().then(
    (projects) => registeredCheckout(root, projects),
    (error: unknown) => {
      out.error(`preside: note: can't read the registry: ${(error as Error).message}`);
      return null;
    },
  );
  if (registered === undefined) {
    out.error(
      `preside: note: ${root} is not registered with the hub, so the human doesn't see its cards. Register it: preside add ${shellQuote(root)}${await worktreeHint(root)}`,
    );
  }
  return { name: registered?.project.name ?? basename(root), path: root };
}

/**
 * In a repository with worktrees the folder to register may be another checkout: what the
 * "register it" hints add then (empty otherwise).
 */
async function worktreeHint(dir: string): Promise<string> {
  if ((await checkoutsOf({ path: dir })).length <= 1) return "";
  return " (if this is a git worktree, register the project's main checkout instead: the first entry of `git worktree list`, plus the project's subfolder; in a bare repository, the checkout the human chose)";
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
