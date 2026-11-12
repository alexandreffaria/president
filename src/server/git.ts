/**
 * Runs git for Sync (see sync.ts). Every call:
 *
 * - spawns `git` with an argument array, never a shell string;
 * - runs in the given folder, without the inherited variables that point git at another
 *   repository: the ones `git rev-parse --local-env-vars` lists (GIT_DIR, GIT_WORK_TREE,
 *   GIT_INDEX_FILE, GIT_CONFIG_PARAMETERS, ...; git removes the same ones before it runs a
 *   hook in another repository), plus GIT_CONFIG_KEY_n/GIT_CONFIG_VALUE_n, GIT_EXEC_PATH and
 *   GIT_{LITERAL,GLOB,NOGLOB,ICASE}_PATHSPECS (they change what `-- decisions/` matches).
 *   A git hook that started the hub exports some of them. The user's own git setup
 *   (GIT_SSH_COMMAND, GIT_CONFIG_GLOBAL, GIT_SSL_CAINFO, GIT_AUTHOR_NAME, ...) is kept, so
 *   Sync behaves like git in their terminal;
 * - can't stop to ask for anything: GIT_TERMINAL_PROMPT=0 turns off git's own prompts, an
 *   empty GIT_ASKPASS turns off askpass programs (core.askPass, SSH_ASKPASS), stdin is
 *   closed, and git runs in its own session with no terminal, so ssh can't ask for a
 *   passphrase or a host key either. Credential helpers still work;
 * - has a timeout. When it runs out, git and everything it started (ssh, a credential
 *   helper) get SIGTERM, then SIGKILL, and the result says so.
 *
 * GIT_OPTIONAL_LOCKS=0 keeps read-only commands (`git status`) from taking the index lock,
 * so the hub's status checks never make an agent's own git command fail.
 */
import { execFileSync, spawn } from "node:child_process";

export interface GitOptions {
  /** Extra variables for git, set after the GIT_* ones are removed (tests use this). */
  env?: Record<string, string>;
  /** How long a local command may take (ms). */
  timeoutMs?: number;
  /** How long a command that talks to the remote (fetch, pull, push, ls-remote) may take (ms). */
  networkTimeoutMs?: number;
}

export interface GitResult {
  /** The exit code; null when git couldn't start or was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_NETWORK_TIMEOUT_MS = 60_000;
/** After SIGTERM, how long git gets to remove its lock files before SIGKILL. */
const KILL_GRACE_MS = 2000;
/** Output beyond this is dropped (git's answers here are short lists of files). */
const MAX_OUTPUT = 4 * 1024 * 1024;

const NETWORK_COMMANDS = new Set(["fetch", "pull", "push", "ls-remote"]);

/**
 * What `git rev-parse --local-env-vars` prints on git 2.56. The installed git is asked too
 * (see {@link localEnvVars}), so a variable a newer git adds is removed as well.
 */
export const LOCAL_ENV_VARS: readonly string[] = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

let localEnvVarsCache: ReadonlySet<string> | undefined;

/** The variables to remove: {@link LOCAL_ENV_VARS} and what the installed git lists. */
export function localEnvVars(): ReadonlySet<string> {
  if (!localEnvVarsCache) {
    const known = new Set(LOCAL_ENV_VARS);
    let installed: string[] = [];
    try {
      // The list is built into git: this needs no repository and no configuration.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !isLocalEnvVar(key, known)),
      );
      installed = execFileSync("git", ["rev-parse", "--local-env-vars"], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: DEFAULT_TIMEOUT_MS,
        windowsHide: true,
      })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^GIT_[A-Z0-9_]+$/.test(line));
    } catch {
      // No git: runGit reports that on its own; the known list still applies.
    }
    localEnvVarsCache = new Set([...known, ...installed]);
  }
  return localEnvVarsCache;
}

function isLocalEnvVar(key: string, local: ReadonlySet<string>): boolean {
  // Upper-cased: on Windows, variable names ignore case.
  const name = key.toUpperCase();
  return (
    local.has(name) ||
    name === "GIT_EXEC_PATH" ||
    /^GIT_(LITERAL|GLOB|NOGLOB|ICASE)_PATHSPECS$/.test(name) ||
    name.startsWith("GIT_CONFIG_KEY_") ||
    name.startsWith("GIT_CONFIG_VALUE_")
  );
}

/**
 * The environment git runs with: ours without the variables that point git at another
 * repository, plus the fixed settings above.
 */
export function gitEnv(
  extra: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const local = localEnvVars();
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!isLocalEnvVar(key, local)) env[key] = value;
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "",
    SSH_ASKPASS_REQUIRE: "never",
    GIT_OPTIONAL_LOCKS: "0",
    ...extra,
  };
}

/** Runs `git <args>` in `cwd`. Never throws; a failure is in the result. */
export function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const network = NETWORK_COMMANDS.has(args[0] ?? "");
  const timeoutMs = network
    ? (options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS)
    : (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn("git", args, {
      cwd,
      env: gitEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
      // Its own session: no controlling terminal for ssh to prompt on, and a process group
      // that can be stopped as a whole.
      detached: true,
      shell: false,
      windowsHide: true,
    });
    const killGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
      } catch {
        // Already gone, or no process groups (Windows): stop git itself.
        child.kill(signal);
      }
    };
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
    }, timeoutMs);
    const finish = (result: GitResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve(result);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk;
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        code: null,
        stdout,
        stderr:
          error.code === "ENOENT"
            ? "git is not installed, or not on the PATH of the president server"
            : error.message,
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      // Anything it started that is still running (an ssh waiting on a dead remote) goes too.
      if (timedOut) killGroup("SIGKILL");
      finish({
        code: timedOut ? null : code,
        stdout,
        stderr: timedOut
          ? `git ${args[0]} took longer than ${formatSeconds(timeoutMs)} and was stopped. ${stderr}`.trim()
          : stderr,
        timedOut,
      });
    });
  });
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

/** NUL-separated output (`-z`) as a list, without empty entries. */
export function splitZ(output: string): string[] {
  return output.split("\0").filter((entry) => entry.trim() !== "");
}
