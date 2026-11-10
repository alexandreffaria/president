/**
 * The hub registry: which project folders president shows cards from.
 *
 * Stored at $XDG_CONFIG_HOME/president/projects.json (default ~/.config/president/projects.json)
 * as { "projects": [{ "name": "...", "path": "/abs/path" }] }. The CLI and the server both
 * read and write it. Writes are atomic, and each change (read, modify, write) holds
 * projects.json.lock, so agents that run `president add` at the same time don't lose each
 * other's projects.
 */
import { mkdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { formatIssues } from "../core/schema.ts";
import { fileError, UserError } from "./errors.ts";
import {
  FileLockTimeout,
  isNotFound,
  KeyedMutex,
  withFileLock,
  writeFileAtomic,
} from "./fs-utils.ts";

export const DECISIONS_DIR = "decisions";
export const PROJECT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const ProjectSchema = z.looseObject({
  name: z.string().regex(PROJECT_NAME_PATTERN),
  path: z.string().refine(isAbsolute, { error: "must be an absolute path" }),
});
const RegistrySchema = z.looseObject({ projects: z.array(ProjectSchema) });

export type Project = z.infer<typeof ProjectSchema>;

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(base, "president");
}

export function decisionsDirOf(project: Pick<Project, "path">): string {
  return join(project.path, DECISIONS_DIR);
}

export interface AddProjectInput {
  path: string;
  name?: string | undefined;
  /** Create `<path>/decisions/` when it is missing. Without it, a missing folder is an error. */
  createDecisions?: boolean | undefined;
}

export class Registry {
  readonly file: string;
  readonly #lock = new KeyedMutex();

  constructor(configDir: string = defaultConfigDir()) {
    this.file = join(configDir, "projects.json");
  }

  async list(): Promise<Project[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (isNotFound(error)) return [];
      throw configError(`cannot read ${this.file}: ${(error as Error).message}`);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw configError(`${this.file} is not valid JSON: ${(error as Error).message}`);
    }
    const parsed = RegistrySchema.safeParse(data);
    if (!parsed.success) {
      throw configError(`${this.file} is invalid: ${formatIssues(parsed.error).join("; ")}`);
    }
    return parsed.data.projects;
  }

  async get(name: string): Promise<Project | undefined> {
    return (await this.list()).find((p) => p.name === name);
  }

  /**
   * Registers a folder. Without a name it is named after the folder, with "-2", "-3"... added
   * when another project has that name (`renamedFrom` is then the folder's name).
   */
  async add(
    input: AddProjectInput,
  ): Promise<{ project: Project; alreadyRegistered: boolean; renamedFrom?: string }> {
    return this.#change(async () => {
      if (!isAbsolute(input.path)) {
        throw new UserError(`"${input.path}" is not an absolute path`);
      }
      const path = await realDirectory(resolve(input.path));
      const projects = await this.list();

      const existing = await findByPath(projects, path);
      if (existing) {
        await ensureDecisionsDir(existing, input.createDecisions);
        return { project: existing, alreadyRegistered: true };
      }

      const taken = new Set(projects.map((p) => p.name));
      const given = input.name?.trim();
      let name = given || suggestName(path);
      if (!PROJECT_NAME_PATTERN.test(name)) {
        throw new UserError(
          `"${name}" is not a valid project name: use letters, digits, ".", "_" and "-" (max 64)`,
        );
      }
      if (given && taken.has(name)) {
        throw new UserError(
          `a project named "${name}" is already registered; choose another name (CLI: --name <name>)`,
          { status: 409 },
        );
      }
      const folderName = name;
      for (let i = 2; taken.has(name); i++) name = `${folderName.slice(0, 60)}-${i}`;

      const project: Project = { name, path };
      await ensureDecisionsDir(project, input.createDecisions);
      await this.#save([...projects, project]);
      return name === folderName
        ? { project, alreadyRegistered: false }
        : { project, alreadyRegistered: false, renamedFrom: folderName };
    });
  }

  /** Removes a project by name or by path. Card files are never touched. */
  async remove(nameOrPath: string): Promise<Project> {
    return this.#change(async () => {
      const projects = await this.list();
      let target = projects.find((p) => p.name === nameOrPath);
      if (!target && isAbsolute(nameOrPath)) {
        const real = await realpath(nameOrPath).catch(() => resolve(nameOrPath));
        target = await findByPath(projects, real);
      }
      if (!target) {
        const what = isAbsolute(nameOrPath) ? "at" : "named";
        throw new UserError(`no project ${what} "${nameOrPath}"`, { status: 404 });
      }
      await this.#save(projects.filter((p) => p !== target));
      return target;
    });
  }

  /**
   * Runs a read-modify-write of the registry: one at a time in this process, and holding the
   * lock file against other processes.
   */
  #change<T>(task: () => Promise<T>): Promise<T> {
    return this.#lock.run("registry", async () => {
      const dir = dirname(this.file);
      try {
        await mkdir(dir, { recursive: true });
        return await withFileLock(`${this.file}.lock`, task);
      } catch (error) {
        if (error instanceof FileLockTimeout) {
          throw new UserError(`cannot change the registry: ${error.message}`, { status: 500 });
        }
        if (error instanceof UserError) throw error;
        throw fileError("change", this.file, error);
      }
    });
  }

  async #save(projects: Project[]): Promise<void> {
    try {
      await writeFileAtomic(this.file, `${JSON.stringify({ projects }, null, 2)}\n`);
    } catch (error) {
      throw fileError("save", this.file, error);
    }
  }
}

/** The registry file is broken: every request needs it, so say how to fix it. */
function configError(message: string): UserError {
  return new UserError(`${message}. Fix or delete the file; it lists the registered projects.`, {
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

async function findByPath(projects: Project[], path: string): Promise<Project | undefined> {
  for (const project of projects) {
    if (project.path === path) return project;
    const real = await realpath(project.path).catch(() => undefined);
    if (real === path) return project;
  }
  return undefined;
}

async function ensureDecisionsDir(project: Project, create: boolean | undefined): Promise<void> {
  const dir = decisionsDirOf(project);
  try {
    if ((await stat(dir)).isDirectory()) return;
    throw new UserError(`"${dir}" exists but is not a directory`);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (!isNotFound(error)) throw fileError("open", dir, error);
  }
  if (!create) {
    throw new UserError(
      `"${project.path}" has no ${DECISIONS_DIR}/ folder. Create it, or ask president to (CLI: --create).`,
      { code: "no_decisions_dir" },
    );
  }
  try {
    await mkdir(dir);
  } catch (error) {
    throw fileError("create", dir, error);
  }
}

/** A registry name derived from the folder name. */
export function suggestName(path: string): string {
  const cleaned = basename(path)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  return cleaned || "project";
}
