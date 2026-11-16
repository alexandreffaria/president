/**
 * The checkouts of a registered project: the folder itself plus the same folder in every
 * other checkout `git worktree list` names. A card lives on the branch whose work it
 * unblocks, so the hub reads (and writes answers into) all of them.
 *
 * Only for the hub: `preside` works in the one checkout it runs in.
 *
 * The answer is cached for a moment (CACHE_MS) and shared by concurrent callers, so a listing
 * of every project, or a watcher poll, runs git at most once per project per moment. Git
 * failing (not installed, not a repository, a timeout) leaves just the folder itself.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
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
  const options = { timeoutMs: GIT_TIMEOUT_MS };
  const [where, list] = await Promise.all([
    runGit(folder, ["rev-parse", "--show-toplevel", "--show-prefix"], options),
    runGit(folder, ["worktree", "list", "--porcelain"], options),
  ]);
  if (where.code !== 0) return alone;
  const [top, prefix = ""] = where.stdout.split("\n");
  if (!top || !isAbsolute(top)) return alone;
  const here = await real(top);
  const entries = list.code === 0 ? parseWorktreeList(list.stdout) : [];

  let branch: string | null = null;
  const others: Checkout[] = [];
  for (const entry of entries) {
    if ((await real(entry.path)) === here) {
      branch = entry.branch;
      continue;
    }
    others.push({ path: resolve(entry.path, prefix), branch: entry.branch });
  }
  return [{ path: folder, branch }, ...others];
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

/**
 * The checkouts in `git worktree list --porcelain` output. Bare repositories and worktrees
 * git calls prunable (their folder is gone) are left out, and so is a path git had to quote
 * (a newline in it).
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  for (const block of output.split("\n\n")) {
    const lines = block.split("\n").filter((line) => line !== "");
    const first = lines[0];
    if (!first?.startsWith("worktree ")) continue;
    const raw = first.slice("worktree ".length);
    if (!isAbsolute(raw) || raw.startsWith('"')) continue;
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
