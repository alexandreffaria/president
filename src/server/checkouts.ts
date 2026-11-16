/**
 * The checkouts of a registered project: the folder itself plus the same folder in every
 * other checkout `git worktree list` names. A card lives on the branch whose work it
 * unblocks, so the hub reads (and writes answers into) all of them.
 *
 * `preside` works in the one checkout it runs in, and uses this only to find the registered
 * project a worktree belongs to.
 *
 * The answer is cached for a moment (CACHE_MS) and shared by concurrent callers, so a listing
 * of every project, or a watcher poll, runs git at most once per project per moment. Git
 * failing (not installed, not a repository, a timeout) leaves just the folder itself, and so
 * does a folder no checkout holds (a bare repository's own folder).
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { runGit } from "./git.ts";
import type { Project } from "./registry.ts";

export interface Checkout {
  /** The project's folder in this checkout (the registered folder first). */
  path: string;
  /** The branch checked out there; null when HEAD is detached or the folder isn't in git. */
  branch: string | null;
}

/** A registered project with the checkouts the hub reads its cards from. */
export interface HubProject extends Project {
  checkouts: readonly Checkout[];
}

const CACHE_MS = 1000;
const GIT_TIMEOUT_MS = 5000;

const cache = new Map<string, { at: number; checkouts: Promise<Checkout[]> }>();

/** The project with its checkouts. */
export async function withCheckouts(project: Project): Promise<HubProject> {
  return { ...project, checkouts: await checkoutsOf(project) };
}

/** {@link withCheckouts} for every project. */
export function allWithCheckouts(projects: Project[]): Promise<HubProject[]> {
  return Promise.all(projects.map(withCheckouts));
}

export function checkoutsOf(project: Pick<Project, "path">): Promise<Checkout[]> {
  const now = Date.now();
  const cached = cache.get(project.path);
  if (cached && now - cached.at < CACHE_MS) return cached.checkouts;
  const checkouts = listCheckouts(project.path);
  cache.set(project.path, { at: now, checkouts });
  // Entries for projects that are gone don't pile up.
  for (const [path, entry] of cache) if (now - entry.at >= CACHE_MS) cache.delete(path);
  return checkouts;
}

/** Forgets the cached checkouts (tests). */
export function forgetCheckouts(): void {
  cache.clear();
}

async function listCheckouts(folder: string): Promise<Checkout[]> {
  const alone: Checkout[] = [{ path: folder, branch: null }];
  // One git command per look: the hub runs this for every request about a project.
  const list = await runGit(folder, ["worktree", "list", "--porcelain"], {
    timeoutMs: GIT_TIMEOUT_MS,
  });
  if (list.code !== 0) return alone;
  const here = await real(folder);
  const entries = await Promise.all(
    parseWorktreeList(list.stdout).map(async (entry) => ({
      ...entry,
      real: await real(entry.path),
    })),
  );
  // The checkout the folder is in: the deepest one holding it (a worktree may sit inside
  // another checkout's folder, as .claude/worktrees/ does). None: a bare repository's folder.
  const holds = (root: string) => here === root || here.startsWith(root + sep);
  const own = entries
    .filter((entry) => holds(entry.real))
    .sort((a, b) => b.real.length - a.real.length)[0];
  if (!own) return alone;
  const inside = relative(own.real, here);
  const others = entries
    .filter((entry) => entry !== own)
    .map((entry) => ({ path: resolve(entry.path, inside), branch: entry.branch }));
  return [{ path: folder, branch: own.branch }, ...others];
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/**
 * The checkouts in `git worktree list --porcelain` output. Bare repositories and worktrees
 * git calls prunable (their folder is gone) are left out, and so is a path git had to quote
 * (a newline in it: it starts with a quote, so it isn't absolute).
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of output.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line !== "");
    const first = lines[0];
    if (!first?.startsWith("worktree ")) continue;
    const raw = first.slice("worktree ".length);
    if (!isAbsolute(raw)) continue;
    if (lines.some((line) => line === "bare" || line.startsWith("prunable"))) continue;
    const ref = lines.find((line) => line.startsWith("branch "))?.slice("branch ".length);
    const branch = ref ? ref.replace(/^refs\/heads\//, "") : null;
    // Git prints C:/Users/... on Windows; president spells paths natively.
    entries.push({ path: resolve(raw), branch });
  }
  return entries;
}

async function real(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}
