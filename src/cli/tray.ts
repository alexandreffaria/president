/**
 * `preside tray`: the Windows notification-area helper (20261112vzn8, option `count`). On
 * Linux the same command installs systemd user units instead (tray-linux.ts).
 *
 * The helper is tray/windows/PresideTray.cs, compiled here, on the user's machine, by the C#
 * compiler that ships with Windows (.NET Framework 4's csc.exe), into
 * %LOCALAPPDATA%\president\ with a small config next to it: which node.exe runs the hub and
 * from which checkout. Nothing is downloaded and nothing runs from node_modules. The exe does
 * the Windows parts itself (the Run key, stopping a running copy), so they live in one place.
 */
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { UserError } from "../server/errors.ts";
import { type RetryOptions, retryTransientWindows, writeFileAtomic } from "../server/fs-utils.ts";
import { portFromEnv } from "../server/server.ts";
import type { Output } from "./main.ts";

export const EXE_NAME = "PresideTray.exe";
/** Where a new build goes first, so a failed one leaves the installed helper alone. */
const NEW_EXE_NAME = "PresideTray.new.exe";
export const CONFIG_NAME = "tray.config";
/** What the helper writes next to itself, removed by uninstall with the exe and config. */
const OWN_FILES = [
  EXE_NAME,
  NEW_EXE_NAME,
  CONFIG_NAME,
  "hub.log",
  "hub.log.1",
  "self-test.log",
  "self-test.log.1",
];

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TRAY_SOURCE = join("tray", "windows", "PresideTray.cs");

/** HKCU's Run key, for uninstall when the exe that knows it is already gone. */
const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE = "president";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Everything `tray` touches outside its folder, so tests can run it on any system. */
export interface TrayDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The node.exe the helper starts the hub with (process.execPath). */
  nodePath: string;
  /** The president checkout the hub runs from. */
  repoRoot: string;
  /**
   * Runs a program, by its absolute path, to the end, in `cwd` (the helper's folder, never
   * the caller's: on Windows a program looks for what it starts in its cwd first). On Linux,
   * systemctl and git by name, in the checkout.
   */
  run(file: string, args: string[], cwd: string): Promise<RunResult>;
  /** Starts a program that outlives this one, in `cwd` (as for `run`). */
  launch(file: string, args: string[], cwd: string): void;
  /** Whether a hub answers /api/health on that port. */
  hubAnswers(port: number): Promise<boolean>;
  /** The pid a hub on that port gives in /api/health, if one answers (Linux). */
  healthPid(port: number): Promise<number | undefined>;
  /** Waits between tries (a file still locked by an exe that is exiting). */
  sleep(ms: number): Promise<void>;
}

export function systemDeps(): TrayDeps {
  return {
    platform: process.platform,
    env: process.env,
    nodePath: process.execPath,
    repoRoot: REPO_ROOT,
    run: (file, args, cwd) =>
      new Promise((resolve) => {
        execFile(
          file,
          args,
          { cwd, windowsHide: true, timeout: 120_000 },
          (error, stdout, stderr) => {
            const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
            resolve({ code, stdout, stderr: stderr || (error && code === 1 ? error.message : "") });
          },
        );
      }),
    launch: (file, args, cwd) => {
      spawn(file, args, { cwd, detached: true, stdio: "ignore", windowsHide: true }).unref();
    },
    hubAnswers: async (port) => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
    healthPid: async (port) => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(2000),
        });
        const pid = response.ok ? ((await response.json()) as { pid?: unknown }).pid : undefined;
        return typeof pid === "number" ? pid : undefined;
      } catch {
        return undefined;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

const USAGE = "usage: preside tray install [--no-autostart] [--no-start] | uninstall | status";

export async function tray(
  args: string[],
  out: Output,
  deps: TrayDeps = systemDeps(),
): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "install" && sub !== "uninstall" && sub !== "status") {
    out.error(`preside: ${sub === undefined ? "" : `unknown tray command "${sub}"; `}${USAGE}`);
    return 2;
  }
  if (deps.platform === "linux") {
    return (await import("./tray-linux.ts")).linuxTray(sub, rest, out, deps);
  }
  if (deps.platform !== "win32") {
    out.error(
      "preside: `preside tray` is for Windows and Linux only: it puts president in the Windows notification area, or in a Linux tray with systemd. Elsewhere, run the hub with `preside serve` (or your system's service manager).",
    );
    return 1;
  }
  if (sub === "install") return install(rest, out, deps);
  parseArgs({ args: rest, options: {} });
  return sub === "uninstall" ? uninstall(out, deps) : status(out, deps);
}

/** %LOCALAPPDATA%\president: the exe, its config and its log. */
export function trayDir(env: NodeJS.ProcessEnv): string {
  const base = env.LOCALAPPDATA;
  if (!base) throw new UserError("LOCALAPPDATA is not set, so there is nowhere to put the helper");
  if (!isAbsolute(base)) throw new UserError(`LOCALAPPDATA isn't an absolute path: ${base}`);
  return join(base, "president");
}

/** Windows' own folder (%SystemRoot%). */
function windowsDir(env: NodeJS.ProcessEnv): string {
  return env.SystemRoot ?? env.WINDIR ?? "C:\\Windows";
}

/**
 * reg.exe by its full path: `execFile("reg")` would look in the cwd before PATH on Windows
 * (libuv's search_path), so a reg.exe in the folder `preside` runs from would come first.
 */
export function regExe(env: NodeJS.ProcessEnv): string {
  return join(windowsDir(env), "System32", "reg.exe");
}

/** The C# compiler of .NET Framework 4, part of Windows; the 64-bit one first. */
export function findCsc(env: NodeJS.ProcessEnv): string | undefined {
  return ["Framework64", "Framework"]
    .map((bits) => join(windowsDir(env), "Microsoft.NET", bits, "v4.0.30319", "csc.exe"))
    .find((path) => existsSync(path));
}

export interface TrayConfig {
  node: string;
  repo: string;
  port: number;
  /** sha256 of PresideTray.cs as compiled, so `status` can tell when it changed. */
  source: string;
}

export function formatConfig(config: TrayConfig): string {
  for (const [key, value] of Object.entries(config)) {
    if (/[\r\n]/.test(String(value))) throw new UserError(`the ${key} path has a line break in it`);
  }
  return [
    "# Written by `preside tray install`; run it again rather than editing this file.",
    `node=${config.node}`,
    `repo=${config.repo}`,
    `port=${config.port}`,
    `source=${config.source}`,
    "",
  ].join("\r\n");
}

export function parseConfig(text: string): Partial<TrayConfig> {
  const config: Partial<TrayConfig> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    if (line.startsWith("#") || eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "node" || key === "repo" || key === "source") config[key] = value;
    else if (key === "port") config.port = Number(value);
  }
  return config;
}

async function sourceHash(repoRoot: string): Promise<string> {
  const text = await readFile(join(repoRoot, TRAY_SOURCE));
  return createHash("sha256").update(text).digest("hex");
}

async function install(args: string[], out: Output, deps: TrayDeps): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { "no-autostart": { type: "boolean" }, "no-start": { type: "boolean" } },
  });
  const port = portFromEnv(deps.env);
  const dir = trayDir(deps.env);
  const exe = join(dir, EXE_NAME);
  const source = join(deps.repoRoot, TRAY_SOURCE);
  const csc = findCsc(deps.env);
  if (!csc) {
    throw new UserError(
      "can't find the C# compiler that comes with Windows (.NET Framework 4's csc.exe under %WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319). Turn on .NET Framework 4.8 in Windows Features (it is on by default).",
    );
  }
  if (!existsSync(join(deps.repoRoot, "dist", "web", "index.html"))) {
    out.error(
      `preside: warning: the UI isn't built, so the hub will only serve its API. Run \`npm run build\` in ${deps.repoRoot}.`,
    );
  }
  await mkdir(dir, { recursive: true });

  // Built next to the old one first: a failed build leaves a working install running.
  const built = join(dir, NEW_EXE_NAME);
  const compiled = await deps.run(
    csc,
    [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      `/out:${built}`,
      "/reference:System.dll",
      "/reference:System.Drawing.dll",
      "/reference:System.Windows.Forms.dll",
      source,
    ],
    dir,
  );
  if (compiled.code !== 0 || !existsSync(built)) {
    await rm(built, { force: true });
    throw new UserError("compiling the tray helper failed", {
      details: `${compiled.stdout}\n${compiled.stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 30),
    });
  }

  if (existsSync(exe)) await stopRunning(exe, deps);
  await replaceFile(built, exe, deps);
  await writeFileAtomic(
    join(dir, CONFIG_NAME),
    formatConfig({
      node: deps.nodePath,
      repo: deps.repoRoot,
      port,
      source: await sourceHash(deps.repoRoot),
    }),
  );
  out.log(`Built ${exe}`);
  out.log(`  hub: ${deps.nodePath} ${join(deps.repoRoot, "src", "server", "main.ts")}`);
  out.log(`  log: ${join(dir, "hub.log")}`);

  if (!values["no-autostart"]) {
    await runExe(exe, ["--autostart", "on"], deps, "turning on Start with Windows");
    out.log("Starts with Windows (turn it off from the icon's menu).");
  }
  if (!values["no-start"]) {
    deps.launch(exe, [], dir);
    out.log(
      `Started: president's icon is in the notification area, the hub at http://127.0.0.1:${port}.`,
    );
  }
  out.log(
    "On Windows 11 new icons hide behind the ^ arrow. To see the number of cards waiting, show it once: Settings > Personalization > Taskbar > Other system tray icons > president: On (or drag it onto the taskbar).",
  );
  return 0;
}

async function uninstall(out: Output, deps: TrayDeps): Promise<number> {
  const dir = trayDir(deps.env);
  const exe = join(dir, EXE_NAME);
  if (existsSync(exe)) {
    await stopRunning(exe, deps);
    await runExe(exe, ["--autostart", "off"], deps, "turning off Start with Windows");
  } else {
    // Nothing to ask: remove the Run value directly, if one was left (not there is fine).
    // In System32: the folder may be gone already, and the cwd must not be the caller's.
    const reg = regExe(deps.env);
    await deps.run(reg, ["delete", RUN_KEY, "/v", RUN_VALUE, "/f"], dirname(reg));
  }
  for (const name of OWN_FILES) await removeFile(join(dir, name), deps);
  const left = await readdir(dir).catch(() => undefined);
  if (left?.length === 0) await rmdir(dir);
  out.log(
    `Removed president's tray helper (stopped it, no longer starts with Windows, ${dir} cleaned up).`,
  );
  return 0;
}

async function status(out: Output, deps: TrayDeps): Promise<number> {
  const dir = trayDir(deps.env);
  const exe = join(dir, EXE_NAME);
  const configText = await readFile(join(dir, CONFIG_NAME), "utf8").catch(() => undefined);
  if (!existsSync(exe) || configText === undefined) {
    out.log("The tray helper isn't installed. Run `preside tray install`.");
    return 1;
  }
  const config = parseConfig(configText);
  out.log(`helper: ${exe}`);
  out.log(`node: ${config.node ?? "(missing)"}`);
  out.log(`repo: ${config.repo ?? "(missing)"}`);
  // A Node upgrade can move node.exe (nvm-windows, a new installer), and a checkout can move:
  // the helper then can't start the hub, and only a new install fixes it.
  const gone = [
    config.node === undefined || !existsSync(config.node) ? "node.exe" : undefined,
    config.repo === undefined || !existsSync(join(config.repo, "src", "server", "main.ts"))
      ? "the president checkout"
      : undefined,
  ].filter((what) => what !== undefined);
  if (gone.length > 0) {
    out.log(
      `${gone.join(" and ")} ${gone.length > 1 ? "are" : "is"} no longer where the helper was told, so it can't start the hub: run \`preside tray install\` again (from the checkout, with the node you use).`,
    );
  }
  const asked = await deps.run(exe, ["--status"], dir);
  for (const line of asked.stdout.split(/\r?\n/)) if (line.trim()) out.log(line.trim());
  const port = config.port ?? 4747;
  out.log(
    `hub: ${(await deps.hubAnswers(port)) ? "answering" : "not answering"} at http://127.0.0.1:${port}`,
  );
  out.log(`log: ${join(dir, "hub.log")}`);
  const repo = config.repo ?? deps.repoRoot;
  const current = await sourceHash(repo).catch(() => undefined);
  if (current !== undefined && current !== config.source) {
    out.log(
      "The helper's source changed since it was built: run `preside tray install` again to rebuild it.",
    );
  }
  return 0;
}

/** Asks a running helper to quit (it stops its hub) and waits for it. */
async function stopRunning(exe: string, deps: TrayDeps): Promise<void> {
  await runExe(exe, ["--quit"], deps, "stopping the running tray helper");
}

async function runExe(exe: string, args: string[], deps: TrayDeps, what: string): Promise<void> {
  const result = await deps.run(exe, args, dirname(exe));
  if (result.code !== 0) {
    throw new UserError(
      `${what} failed: ${(result.stdout + result.stderr).trim() || `exit code ${result.code}`}`,
    );
  }
}

/** A helper that just quit can hold its exe for a moment more, so a few tries. */
const LOCKED_TRIES = 20;

async function replaceFile(from: string, to: string, deps: TrayDeps): Promise<void> {
  await retryTransientWindows(() => rename(from, to), lockedRetry(deps));
}

async function removeFile(path: string, deps: TrayDeps): Promise<void> {
  await retryTransientWindows(() => rm(path, { force: true }), lockedRetry(deps));
}

function lockedRetry(deps: TrayDeps): RetryOptions {
  return { platform: deps.platform, tries: LOCKED_TRIES, delayMs: () => 250, sleep: deps.sleep };
}
