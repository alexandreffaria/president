/**
 * The hub registry: which project folders president shows cards from.
 *
 * One file per project, $XDG_CONFIG_HOME/president/projects/<name>.json (default
 * ~/.config/president/projects/), holding { "path": "/abs/path" }. The file name is the
 * project's name. The CLI and the server both read and write it, with no lock:
 *
 * - Registering creates the file exclusively (a temp file hard-linked into place, which fails
 *   if the name exists and never shows a half-written file). So two agents that run
 *   `preside add` at once can't take the same name: the second link fails and that one
 *   tries the next suffix (`app-2`, ...). Nothing is read, changed and written back, so no
 *   registration can be lost.
 * - Removing deletes the file; listing reads the folder.
 * - The one race left is harmless: two `add`s of the same folder at the same moment can both
 *   create a file, under two names. Listing then shows the folder once, under the name that
 *   sorts first (`app` before `app-2`), and whichever `add` sees the other removes the
 *   duplicate. `remove` removes every file for the folder.
 *
 * A projects.json from before this layout is moved into the folder on first use.
 */
import {
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { formatIssues } from "../core/schema.ts";
import { fileError, UserError } from "./errors.ts";
import {
  createFileExclusive,
  isNotFound,
  removeStaleTempFiles,
  retryTransientWindows,
} from "./fs-utils.ts";

export const DECISIONS_DIR = "decisions";
export const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENTRY_SUFFIX = ".json";

const EntrySchema = z.looseObject({
  path: z.string().refine(isAbsolute, { error: "must be an absolute path" }),
});
/** The old single-file registry (projects.json), read once to move it into projects/. */
const LegacySchema = z.looseObject({
  projects: z.array(
    z.looseObject({
      name: z.string().regex(PROJECT_NAME_PATTERN),
      path: z.string().refine(isAbsolute, { error: "must be an absolute path" }),
    }),
  ),
});

export interface Project {
  name: string;
  path: string;
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(base, "president");
}

export function decisionsDirOf(project: Pick<Project, "path">): string {
  return join(project.path, DECISIONS_DIR);
}

/** True for a file name in the registry folder that holds a project (not a temp file). */
export function isEntryFileName(fileName: string): boolean {
  return !fileName.startsWith(".") && fileName.endsWith(ENTRY_SUFFIX);
}

/** Orders names so that `app-2` comes before `app-10`. */
const byName = new Intl.Collator("en", { numeric: true }).compare;

export interface AddProjectInput {
  path: string;
  name?: string | undefined;
  /** Without `name`: the name to start from instead of the folder's ("-2"... if taken). */
  defaultName?: string | undefined;
  /** Create `<path>/decisions/` when it is missing. Without it, a missing folder is an error. */
  createDecisions?: boolean | undefined;
}

export class Registry {
  /** The folder with one file per project. */
  readonly dir: string;
  /** The registry file used before projects/ (moved into it on first use). */
  readonly legacyFile: string;
  #migrated = false;

  constructor(configDir: string = defaultConfigDir()) {
    this.dir = join(configDir, "projects");
    this.legacyFile = join(configDir, "projects.json");
  }

  /** The registered projects, sorted by name, each folder once. */
  async list(): Promise<Project[]> {
    return withoutDuplicates(await this.#entries());
  }

  async get(name: string): Promise<Project | undefined> {
    return (await this.list()).find((p) => p.name === name);
  }

  /**
   * Registers a folder. Without a name it is named after the folder (or `defaultName`), with
   * "-2", "-3"... added when another project has that name (`renamedFrom` is then the name
   * it started from).
   */
  async add(
    input: AddProjectInput,
  ): Promise<{ project: Project; alreadyRegistered: boolean; renamedFrom?: string }> {
    if (!isAbsolute(input.path)) {
      throw new UserError(`"${input.path}" is not an absolute path`);
    }
    const path = await realDirectory(resolve(input.path));
    const existing = await findByPath(await this.list(), path);
    if (existing) {
      await ensureDecisionsDir(existing, input.createDecisions);
      return { project: existing, alreadyRegistered: true };
    }

    const given = input.name?.trim();
    const start = given || input.defaultName || suggestName(path);
    if (!PROJECT_NAME_PATTERN.test(start)) {
      throw new UserError(
        `"${start}" is not a valid project name: use letters, digits, ".", "_" and "-" (max 64)`,
      );
    }
    await ensureDecisionsDir({ path }, input.createDecisions);
    await this.#ensureDir();

    let name = start;
    for (let i = 2; !(await this.#create(name, path)); i++) {
      const taken = await this.#read(name + ENTRY_SUFFIX);
      // The same folder, added under the same name a moment ago.
      if (taken?.path === path) return { project: taken, alreadyRegistered: true };
      if (given) {
        throw new UserError(
          `a project named "${name}" is already registered; choose another name (CLI: --name <name>)`,
          { status: 409 },
        );
      }
      if (i > 1000) throw new UserError(`too many projects are named "${start}-<n>"`);
      name = `${start.slice(0, 60)}-${i}`;
    }
    await removeStaleTempFiles(this.dir).catch(() => {});

    // Another `add` of the same folder may have run at the same moment.
    const twins = (await this.#entries()).filter((p) => p.path === path);
    const winner = twins.sort((a, b) => byName(a.name, b.name))[0];
    if (winner && winner.name !== name) {
      await this.#delete(name);
      return { project: winner, alreadyRegistered: true };
    }
    for (const twin of twins) if (twin.name !== name) await this.#delete(twin.name);

    const project = { name, path };
    return name === start
      ? { project, alreadyRegistered: false }
      : { project, alreadyRegistered: false, renamedFrom: start };
  }

  /** Removes a project by name or by path. Card files are never touched. */
  async remove(nameOrPath: string): Promise<Project> {
    // Every entry, duplicates too, so a name an `add` printed can always be removed.
    const entries = await this.#entries();
    let target = entries.find((p) => p.name === nameOrPath);
    if (!target && isAbsolute(nameOrPath)) {
      const real = await realpath(nameOrPath).catch(() => resolve(nameOrPath));
      target = await findByPath(entries, real);
    }
    if (!target) {
      const what = isAbsolute(nameOrPath) ? "at" : "named";
      throw new UserError(`no project ${what} "${nameOrPath}"`, { status: 404 });
    }
    const removed = target;
    for (const p of entries) if (p.path === removed.path) await this.#delete(p.name);
    return removed;
  }

  /** Every entry file, duplicates included, sorted by name. */
  async #entries(): Promise<Project[]> {
    await this.#migrate();
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter(isEntryFileName);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw configError(`cannot read ${this.dir}: ${(error as Error).message}`);
    }
    const projects = await Promise.all(names.map((fileName) => this.#read(fileName)));
    return projects
      .filter((p): p is Project => p !== undefined)
      .sort((a, b) => byName(a.name, b.name));
  }

  async #read(fileName: string): Promise<Project | undefined> {
    const file = join(this.dir, fileName);
    const name = fileName.slice(0, -ENTRY_SUFFIX.length);
    if (!PROJECT_NAME_PATTERN.test(name)) {
      throw configError(
        `${file}: "${name}" is not a valid project name (letters, digits, ".", "_" and "-")`,
        ENTRY_FIX,
      );
    }
    let text: string;
    try {
      text = await retryTransientWindows(() => readFile(file, "utf8"));
    } catch (error) {
      if (isNotFound(error)) return undefined; // removed while we were listing
      throw configError(`cannot read ${file}: ${(error as Error).message}`, ENTRY_FIX);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw configError(`${file} is not valid JSON: ${(error as Error).message}`, ENTRY_FIX);
    }
    const parsed = EntrySchema.safeParse(data);
    if (!parsed.success) {
      throw configError(`${file} is invalid: ${formatIssues(parsed.error).join("; ")}`, ENTRY_FIX);
    }
    return { name, path: parsed.data.path };
  }

  /** Creates the entry for `name`; false when that name is taken. */
  async #create(name: string, path: string): Promise<boolean> {
    const file = join(this.dir, name + ENTRY_SUFFIX);
    try {
      return await createFileExclusive(file, `${JSON.stringify({ path }, null, 2)}\n`);
    } catch (error) {
      throw fileError("create", file, error);
    }
  }

  async #delete(name: string): Promise<void> {
    const file = join(this.dir, name + ENTRY_SUFFIX);
    try {
      await retryTransientWindows(() => unlink(file));
    } catch (error) {
      if (!isNotFound(error)) throw fileError("delete", file, error);
    }
  }

  async #ensureDir(): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
    } catch (error) {
      throw fileError("create", this.dir, error);
    }
  }

  /**
   * Moves projects.json (the registry before projects/) into projects/, once. Each project is
   * created like a new one (a name that exists is left as it is), and the old file is renamed
   * to projects.json.migrated only after all of them exist, so a process that runs at the
   * same time either migrates too or finds them all.
   */
  async #migrate(): Promise<void> {
    if (this.#migrated) return;
    let text: string;
    try {
      text = await readFile(this.legacyFile, "utf8");
    } catch (error) {
      if (!isNotFound(error)) {
        throw configError(
          `cannot read ${this.legacyFile}: ${(error as Error).message}`,
          LEGACY_FIX,
        );
      }
      this.#migrated = true;
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw configError(
        `${this.legacyFile} is not valid JSON: ${(error as Error).message}`,
        LEGACY_FIX,
      );
    }
    const parsed = LegacySchema.safeParse(data);
    if (!parsed.success) {
      throw configError(
        `${this.legacyFile} is invalid: ${formatIssues(parsed.error).join("; ")}`,
        LEGACY_FIX,
      );
    }
    await this.#ensureDir();
    for (const project of parsed.data.projects) await this.#create(project.name, project.path);
    try {
      await retryTransientWindows(() => rename(this.legacyFile, `${this.legacyFile}.migrated`));
    } catch (error) {
      if (!isNotFound(error)) throw fileError("rename", this.legacyFile, error);
    }
    this.#migrated = true;
  }
}

/** Each folder once, under the name that sorts first. `projects` is sorted by name. */
function withoutDuplicates(projects: Project[]): Project[] {
  const seen = new Set<string>();
  return projects.filter((p) => !seen.has(p.path) && seen.add(p.path));
}

/** For a broken entry file, and for a broken projects.json from before projects/. */
const ENTRY_FIX = "Fix or delete this file; it registers one project.";
const LEGACY_FIX = "Fix it; president moves it into projects/ once it can read it.";

/** The registry is broken: every request needs it, so say how to fix it (`fix`). */
function configError(message: string, fix = ""): UserError {
  return new UserError(`${message}.${fix ? ` ${fix}` : ""}`, {
    status: 500,
    code: "invalid_config",
  });
}

async function realDirectory(path: string): Promise<string> {
  let real: string;
  try {
    real = await realpath(path);
  } catch (error) {
    if (isNotFound(error)) throw new UserError(`"${path}" does not exist`);
    throw fileError("open", path, error);
  }
  if (!(await stat(real)).isDirectory()) throw new UserError(`"${path}" is not a directory`);
  return real;
}

/** The project registered at `path` (a real path), also when its entry names a link to it. */
export async function findByPath(projects: Project[], path: string): Promise<Project | undefined> {
  for (const project of projects) {
    if (project.path === path) return project;
    const real = await realpath(project.path).catch(() => undefined);
    if (real === path) return project;
  }
  return undefined;
}

async function ensureDecisionsDir(
  project: Pick<Project, "path">,
  create: boolean | undefined,
): Promise<void> {
  const dir = decisionsDirOf(project);
  if (create) {
    try {
      await mkdir(dir);
    } catch (error) {
      // Something is there already (a folder, maybe another add's, or not one): checked below.
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw fileError("create", dir, error);
    }
  }
  if (await isDecisionsDir(dir)) return;
  throw new UserError(
    `"${project.path}" has no ${DECISIONS_DIR}/ folder. Create it, or ask president to (CLI: --create).`,
    { code: "no_decisions_dir" },
  );
}

/** True when `dir` is a folder, false when nothing is there; anything else is refused. */
async function isDecisionsDir(dir: string): Promise<boolean> {
  try {
    if ((await stat(dir)).isDirectory()) return true;
    throw new UserError(`"${dir}" exists but is not a directory`);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (!isNotFound(error)) throw fileError("open", dir, error);
  }
  // stat follows links: a link to nothing is "not found" too (R9-1).
  const target = await readlink(dir).catch(() => undefined);
  if (target !== undefined) {
    throw new UserError(
      `"${dir}" is a link to ${resolve(dirname(dir), target)}, which doesn't exist`,
    );
  }
  return false;
}

/** A registry name derived from the folder name. */
export function suggestName(path: string): string {
  const cleaned = basename(path)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  return cleaned || "project";
}
