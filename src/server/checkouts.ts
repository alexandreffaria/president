/**
 * The checkouts of a registered project: the folder itself plus the same folder in every
 * other checkout `git worktree list` names. A card lives on the branch whose work it
 * unblocks, so the hub reads (and writes answers into) all of them.
 *
 * `preside` works in the one checkout it runs in. It uses this only to find the registered
 * project a worktree belongs to, to hint at the main checkout in its "not registered" notes,
 * for `add`'s warning about a second checkout, and for `list`'s missing-decisions/ check (as
 * the hub reports it).
 *
 * The answer is cached for a moment (CACHE_MS) and shared by concurrent callers, so a listing
 * of every project, or a watcher poll, runs git at most once per project per moment. When git
 * gives no answer (a timeout, or it can't start), the last answer for the folder is kept.
 * Otherwise a folder outside git, or one no checkout holds (a bare repository's own folder),
 * is just itself.
 */
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { runGit } from "./git.ts";
import { findByPath, type Project } from "./registry.ts";

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
/** How many folders' last answers are kept (far more than anyone registers). */
const MAX_ANSWERS = 200;
const GIT_TIMEOUT_MS = 5000;

/** `at`: when the answer came; undefined while git is still running (callers share it). */
const cache = new Map<string, { at: number | undefined; checkouts: Promise<Checkout[]> }>();
/**
 * The last answer git gave for each folder. When git can't answer for a moment (it timed out,
 * or couldn't start), that one is used instead of the folder alone, so a slow git doesn't
 * hide the worktrees' cards and make the watcher drop and re-add their folders.
 */
const lastAnswer = new Map<string, Checkout[]>();

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
  const fresh = (entry: { at: number | undefined }) =>
    entry.at === undefined || now - entry.at < CACHE_MS;
  const cached = cache.get(project.path);
  if (cached && fresh(cached)) return cached.checkouts;
  // Entries for projects that are gone don't pile up.
  for (const [path, entry] of cache) if (!fresh(entry)) cache.delete(path);
  const entry: { at: number | undefined; checkouts: Promise<Checkout[]> } = {
    at: undefined,
    checkouts: listCheckouts(project.path).finally(() => {
      entry.at = Date.now();
    }),
  };
  cache.set(project.path, entry);
  return entry.checkouts;
}

/**
 * The registered project that `dir` is a checkout of: registered itself, or the same folder
 * in another checkout of its git repository (a worktree of a registered folder, or the
 * registered worktree of a bare repository). `at` is the registered folder.
 */
export async function registeredCheckout(
  dir: string,
  projects: Project[],
): Promise<{ project: Project; at: string } | undefined> {
  const itself = await findByPath(projects, await realpath(dir).catch(() => dir));
  if (itself) return { project: itself, at: dir };
  for (const checkout of await checkoutsOf({ path: dir })) {
    const real = await realpath(checkout.path).catch(() => checkout.path);
    const project = await findByPath(projects, real);
    if (project) return { project, at: checkout.path };
  }
  return undefined;
}

/**
 * The warning for registering `dir` when another checkout of its repository is registered
 * already (`other`, from {@link registeredCheckout} before the add): the hub then shows the
 * same cards under two projects. Undefined when there is nothing to warn about.
 */
export async function secondCheckoutWarning(
  dir: string,
  other: { project: Project; at: string } | undefined,
): Promise<string | undefined> {
  if (!other) return undefined;
  const [a, b] = await Promise.all([real(other.at), real(dir)]);
  if (a === b) return undefined;
  return `${dir} is another checkout of ${other.project.name}'s git repository (registered at ${other.at}); the hub already shows the cards of every checkout of it, so registering this one too shows them twice.`;
}

/** Forgets the cached checkouts (tests). */
export function forgetCheckouts(): void {
  cache.clear();
  lastAnswer.clear();
}

async function listCheckouts(folder: string): Promise<Checkout[]> {
  const alone: Checkout[] = [{ path: folder, branch: null }];
  // One git command per look: the hub runs this for every request about a project.
  const list = await runGit(folder, ["worktree", "list", "--porcelain"], {
    timeoutMs: GIT_TIMEOUT_MS,
  });
  // No answer at all (code null): keep the last one, unless the folder itself is gone (git
  // can't start in a missing folder either). Not a repository (an exit code): alone.
  if (list.code === null) {
    if (
      await lstat(folder).then(
        () => true,
        () => false,
      )
    )
      return lastAnswer.get(folder) ?? alone;
    lastAnswer.delete(folder);
    return alone;
  }
  const checkouts = list.code === 0 ? await fromWorktreeList(folder, list.stdout) : alone;
  lastAnswer.delete(folder);
  lastAnswer.set(folder, checkouts);
  // Folders asked about long ago (projects since removed) don't pile up.
  for (const old of lastAnswer.keys()) {
    if (lastAnswer.size <= MAX_ANSWERS) break;
    lastAnswer.delete(old);
  }
  return checkouts;
}

/** The checkouts `git worktree list --porcelain` printed, run in `folder`. */
async function fromWorktreeList(folder: string, output: string): Promise<Checkout[]> {
  const alone: Checkout[] = [{ path: folder, branch: null }];
  const here = await real(folder);
  const entries = await Promise.all(
    parseWorktreeList(output).map(async (entry) => ({
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
  const others: Checkout[] = [];
  for (const entry of entries) {
    if (entry === own) continue;
    const path = resolve(entry.path, inside);
    // The project's subfolder must be inside that checkout: a branch that made it a link to
    // somewhere else doesn't get that place read or written.
    const real = await realOrMissing(path);
    if (real !== undefined && real !== entry.real && !real.startsWith(entry.real + sep)) continue;
    others.push({ path, branch: entry.branch });
  }
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

/** The real path, or undefined when nothing is there (a branch without the subfolder). */
async function realOrMissing(path: string): Promise<string | undefined> {
  return realpath(path).catch(() => undefined);
}

async function real(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}
