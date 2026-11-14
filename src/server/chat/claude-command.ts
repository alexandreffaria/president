/**
 * What a run of `claude` actually executes: an absolute path, never the bare name.
 *
 * A run's cwd is the card's project folder, and `spawn("claude", { cwd })` would look there
 * first on Windows (libuv), or, on Linux and macOS, in a folder relative to it for an empty or
 * relative PATH entry. So `claude` is looked for the way git is (findExecutable): in the
 * absolute PATH folders only.
 *
 * Claude Code comes as a program (claude.exe from the native installer, or what npm's package
 * puts in place today) or as a Node script (`cli.js`, what npm's package shipped before). On
 * Linux and macOS either one is `claude` on PATH: a program runs as is, a Node script with
 * the hub's own Node (`process.execPath`), never a `node` looked for on PATH. On
 * Windows, npm installs neither on PATH but a batch file, `claude.cmd`, which recent Node
 * refuses to run without a shell (and a shell would read the message's quoting). So a
 * claude.exe (or .com) anywhere on PATH comes first; otherwise the first claude.cmd is read,
 * never run, for what it starts: that program is run itself, and a script with the hub's own
 * Node (`process.execPath`).
 */
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { findExecutable, pathDirs } from "../executable.ts";

/** A program to spawn and the arguments that come before the run's own. */
export interface ClaudeCommand {
  file: string;
  args: string[];
}

export const CLAUDE_NOT_FOUND =
  "Claude Code isn't installed here: president couldn't find the `claude` command.";

/** Scripts run with Node rather than as programs. */
const SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
/** What a Windows batch file may start: a program, or a script. */
const TARGET_EXTENSIONS = new Set([".exe", ".com", ...SCRIPT_EXTENSIONS]);
/** npm's shims are a few hundred bytes; anything far larger isn't one. */
const MAX_SHIM_BYTES = 64 * 1024;
/** Where npm's install of Claude Code is, next to its shim. */
const NPM_PACKAGE = join("node_modules", "@anthropic-ai", "claude-code");

/**
 * The command for `bin` (a name looked for on PATH, or a path) in the environment `env`, or an
 * error in words for the page. Looked for again at each run, so installing Claude Code while
 * the hub runs works without a restart.
 */
export function resolveClaude(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
): ClaudeCommand | { error: string } {
  const windows = process.platform === "win32";
  // A path (tests, a claudeBin option) is taken as given, from the hub's cwd, never the run's.
  if (bin.includes("/") || (windows && bin.includes("\\"))) {
    return commandFor(resolve(bin), windows) ?? { error: notRunnable(resolve(bin)) };
  }
  const program = findExecutable(bin, env);
  if (program !== undefined) return commandFor(program, windows) ?? { error: CLAUDE_NOT_FOUND };
  if (!windows) return { error: CLAUDE_NOT_FOUND };
  for (const dir of pathDirs(env)) {
    const shim = join(dir, `${bin}.cmd`);
    if (!isFile(shim)) continue;
    return commandFor(shim, windows) ?? { error: notRunnable(shim) };
  }
  return { error: CLAUDE_NOT_FOUND };
}

function notRunnable(path: string): string {
  return `Claude Code isn't available here: president found ${path} but can't tell what it runs.`;
}

/**
 * How to run the file at `path`, or undefined when it is a batch file of unknown form. A Node
 * script (npm's `claude` on Linux and macOS is a link to `cli.js`) runs with the hub's own
 * Node: its `#!/usr/bin/env node` would look for `node` on PATH, in the project folder too
 * for an empty or relative entry.
 */
function commandFor(path: string, windows: boolean): ClaudeCommand | undefined {
  const ext = extname(path).toLowerCase();
  if (!windows) {
    const real = realPath(path);
    const options = nodeOptions(real);
    return options
      ? { file: process.execPath, args: [...options, real] }
      : { file: path, args: [] };
  }
  const script = (file: string) => ({
    file: process.execPath,
    args: [...(nodeOptions(file) ?? []), file],
  });
  if (SCRIPT_EXTENSIONS.has(ext)) return script(path);
  if (ext === ".cmd" || ext === ".bat") {
    const target = shimTarget(path);
    if (target === undefined) return undefined;
    return SCRIPT_EXTENSIONS.has(extname(target).toLowerCase())
      ? script(target)
      : { file: target, args: [] };
  }
  return { file: path, args: [] };
}

/**
 * What the batch file at `path` starts: the last `%~dp0`-relative path, other than Node
 * itself, on the line that passes the arguments on (`%*`). npm's cmd-shim writes, for a
 * program,
 *
 *   "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
 *
 * and for a script (`IF EXIST "%dp0%\node.exe" ... SET "_prog=node" ...` before it)
 *
 *   ... "%_prog%"  "%dp0%\node_modules\@anthropic-ai\claude-code\cli.js" %*
 *
 * where `%dp0%` is `%~dp0`, the batch file's folder; pnpm and older npm write `"%~dp0\..."`.
 * When no such path names an existing program or script, the package npm installed next to
 * the shim says (its package.json's `bin`).
 */
export function shimTarget(path: string): string | undefined {
  const dir = dirname(path);
  let text: string;
  try {
    if (statSync(path).size > MAX_SHIM_BYTES) return undefined;
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/).reverse()) {
    if (!line.includes("%*")) continue;
    const targets = [...line.matchAll(/"%~?dp0%?\\?([^"%]*)"/gi)]
      .map((match) => join(dir, ...(match[1] ?? "").split(/[\\/]/)))
      .filter((target) => !/^node(\.exe)?$/i.test(basename(target)));
    const target = targets.at(-1);
    if (target !== undefined && isTarget(target)) return target;
  }
  return packageBin(join(dir, NPM_PACKAGE));
}

/** The `claude` bin of the npm package in `dir`, when it is a program or a script there. */
function packageBin(dir: string): string | undefined {
  let bin: unknown;
  try {
    bin = (
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        bin?: unknown;
      }
    ).bin;
  } catch {
    return undefined;
  }
  const relative =
    typeof bin === "string"
      ? bin
      : typeof bin === "object" && bin !== null
        ? (bin as Record<string, unknown>).claude
        : undefined;
  if (typeof relative !== "string" || isAbsolute(relative)) return undefined;
  const target = join(dir, ...relative.split(/[\\/]/));
  return isTarget(target) ? target : undefined;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * The Node options of a Node script: a `.js`/`.cjs`/`.mjs` file, or one whose `#!` line runs
 * `node` through env. With `env -S` that line's words after `node` are its options
 * (`#!/usr/bin/env -S node --no-warnings`), split on whitespace as env -S does for simple
 * cases; quotes, escapes and `$` aren't parsed, so a line with any of them gives undefined
 * and the file runs as is. Without -S, env on Linux takes "node --flag" as one name, so the
 * line gives no options. Undefined for anything else.
 */
function nodeOptions(path: string): string[] | undefined {
  const script = SCRIPT_EXTENSIONS.has(extname(path).toLowerCase());
  let head = "";
  try {
    const fd = openSync(path, "r");
    try {
      const buffer = Buffer.alloc(512);
      head = buffer.toString("utf8", 0, readSync(fd, buffer, 0, buffer.length, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return script ? [] : undefined;
  }
  const line = head.split(/\r?\n/)[0] ?? "";
  const match = /^#!\s*\/usr\/bin\/env\s+(-S\s+)?node(?:[ \t]+(.*))?$/.exec(line);
  if (!match) return script ? [] : undefined;
  if (!match[1]) return [];
  const words = match[2] ?? "";
  if (/["'\\$]/.test(words)) return undefined;
  return words.split(/[ \t]+/).filter(Boolean);
}

function isTarget(path: string): boolean {
  return TARGET_EXTENSIONS.has(extname(path).toLowerCase()) && isFile(path);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
