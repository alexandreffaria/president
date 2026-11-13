/**
 * Finding a program (git) on PATH before running it, so that it is never one in the folder
 * it runs in.
 *
 * On Windows, `spawn("git", { cwd })` looks in the child's cwd before PATH (libuv's
 * search_path), so a `git.exe` committed at a project's root would run whenever the hub reads
 * that project or syncs it. On Linux an empty or relative PATH entry means a folder relative
 * to the cwd too. Spawning the absolute path found here, from the absolute PATH entries only,
 * rules both out.
 */
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

/** What a program's name gets on Windows, in the order libuv tries them. Never .cmd or .bat. */
const WINDOWS_EXTENSIONS = [".com", ".exe"];

const found = new Map<string, string>();

/**
 * The absolute path of `name` in the PATH of `env` (the child's environment, as spawn uses
 * it), or undefined when no PATH folder has it. Only absolute PATH entries are looked in,
 * never the cwd. What is found is remembered for that PATH; what isn't is looked for again
 * next time (git installed while the hub runs).
 */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const windows = process.platform === "win32";
  // Without PATH, POSIX execvp looks in its default one.
  const path = pathOf(env, windows) ?? (windows ? "" : "/usr/bin:/bin");
  const key = `${name}\0${path}`;
  const cached = found.get(key);
  if (cached !== undefined) return cached;
  for (const raw of path.split(delimiter)) {
    // Windows allows a quoted entry ("C:\Program Files\Git\cmd").
    const dir = windows ? raw.replace(/^"(.*)"$/, "$1") : raw;
    // Absolute only. On Windows that is a drive's root or a UNC share: "\bin" is on the cwd's
    // drive.
    if (!(windows ? /^([a-zA-Z]:[\\/]|\\\\)/.test(dir) : isAbsolute(dir))) continue;
    const candidates = windows
      ? WINDOWS_EXTENSIONS.map((ext) => join(dir, name + ext))
      : [join(dir, name)];
    for (const candidate of candidates) {
      if (isExecutableFile(candidate, windows)) {
        found.set(key, candidate);
        return candidate;
      }
    }
  }
  return undefined;
}

/** PATH in `env`; on Windows the name ignores case (it is often "Path"). */
function pathOf(env: NodeJS.ProcessEnv, windows: boolean): string | undefined {
  if (!windows) return env.PATH;
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return key === undefined ? undefined : env[key];
}

function isExecutableFile(path: string, windows: boolean): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!windows) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
