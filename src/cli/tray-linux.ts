/**
 * `preside tray` on Linux: the hub in the background, with an icon, as the Windows helper
 * gives it (20261112vzn8, option `count`).
 *
 * Two systemd user units, written into $XDG_CONFIG_HOME/systemd/user/:
 * - president.service runs the hub (`node <checkout>/src/server/main.ts`), starts at login,
 *   and is started again when it fails;
 * - president-tray.service runs the icon (tray/linux/preside-tray.ts, a StatusNotifierItem),
 *   pulled in by the hub's unit and stopped or restarted with it.
 *
 * Both run from the checkout `install` ran from, so installing from another checkout (a pull
 * request's worktree) serves that build, and installing from main again puts main back. The
 * units name the build (branch @ short sha) for the icon's tooltip and `status`.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { UserError } from "../server/errors.ts";
import { writeFileAtomic } from "../server/fs-utils.ts";
import { portFromEnv } from "../server/server.ts";
import type { Output } from "./main.ts";
import type { TrayDeps } from "./tray.ts";

export const HUB_UNIT = "president.service";
export const ICON_UNIT = "president-tray.service";
export const ICON_SOURCE = join("tray", "linux", "preside-tray.ts");
const HUB_SOURCE = join("src", "server", "main.ts");
/** What the UI is built from (vite.config.ts: root src/web, which imports src/core). */
const UI_SOURCES = [join("src", "web"), join("src", "core"), "vite.config.ts"];
/** How long `install` waits for the hub it (re)started to answer. */
const ANSWER_TRIES = 20;
const LOGS = `journalctl --user -u ${HUB_UNIT} -u ${ICON_UNIT}`;

export async function linuxTray(
  sub: "install" | "uninstall" | "status",
  args: string[],
  out: Output,
  deps: TrayDeps,
): Promise<number> {
  if (sub === "install") return install(args, out, deps);
  parseArgs({ args, options: {} });
  return sub === "uninstall" ? uninstall(out, deps) : status(out, deps);
}

/** $XDG_CONFIG_HOME/systemd/user (default ~/.config/systemd/user): where user units go. */
export function unitDir(env: NodeJS.ProcessEnv): string {
  const config = env.XDG_CONFIG_HOME || (env.HOME ? join(env.HOME, ".config") : undefined);
  if (!config) throw new UserError("neither XDG_CONFIG_HOME nor HOME is set");
  if (!isAbsolute(config)) throw new UserError(`XDG_CONFIG_HOME isn't an absolute path: ${config}`);
  return join(config, "systemd", "user");
}

export interface UnitConfig {
  node: string;
  repo: string;
  port: number;
  /** "main @ 1a2b3c4": what the icon's tooltip and `status` name. */
  build: string;
  /** The environment the hub and the icon get besides systemd's (PATH, XDG_*). */
  env: Record<string, string>;
}

/** The variables `install` passes on, so the hub finds `claude`, git and the registry. */
const PASSED_ON = ["PATH", "XDG_CONFIG_HOME", "XDG_STATE_HOME"];

/**
 * A quoted value in a unit file, taken literally: no specifiers (%), and in a command line
 * (ExecStart) no variables ($) either.
 */
function quote(value: string, command = false): string {
  const literal = value.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%");
  return `"${command ? literal.replace(/\$/g, "$$$$") : literal}"`;
}

function execStart(config: UnitConfig, source: string): string {
  return `ExecStart=${quote(config.node, true)} ${quote(join(config.repo, source), true)}`;
}

function environment(config: UnitConfig, extra: Record<string, string>): string[] {
  return Object.entries({ ...config.env, PRESIDENT_PORT: String(config.port), ...extra }).map(
    ([key, value]) => `Environment=${quote(`${key}=${value}`)}`,
  );
}

function header(config: UnitConfig): string[] {
  for (const [key, value] of Object.entries(config)) {
    if (/[\r\n]/.test(typeof value === "string" ? value : JSON.stringify(value))) {
      throw new UserError(`the ${key} has a line break in it`);
    }
  }
  return [
    "# Written by `preside tray install`; run it again rather than editing this file.",
    `# repo=${config.repo}`,
    `# build=${config.build}`,
    `# port=${config.port}`,
  ];
}

export function hubUnit(config: UnitConfig): string {
  return [
    ...header(config),
    "[Unit]",
    `Description=president hub (${config.build.replace(/%/g, "%%")})`,
    `Wants=${ICON_UNIT}`,
    // Started again however often it fails (a port taken for a while), with a growing delay
    // where systemd has one (254+; older versions ignore those keys).
    "StartLimitIntervalSec=0",
    "",
    "[Service]",
    `WorkingDirectory=${config.repo.replace(/%/g, "%%")}`,
    execStart(config, HUB_SOURCE),
    ...environment(config, {}),
    "Restart=on-failure",
    "RestartSec=1",
    "RestartSteps=6",
    "RestartMaxDelaySec=60",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function iconUnit(config: UnitConfig): string {
  return [
    ...header(config),
    "[Unit]",
    "Description=president tray icon",
    `PartOf=${HUB_UNIT}`,
    `After=${HUB_UNIT}`,
    "",
    "[Service]",
    `WorkingDirectory=${config.repo.replace(/%/g, "%%")}`,
    execStart(config, ICON_SOURCE),
    ...environment(config, { PRESIDENT_BUILD: config.build }),
    "Restart=on-failure",
    "RestartSec=10",
    "",
  ].join("\n");
}

export interface InstalledUnit {
  repo?: string;
  build?: string;
  port?: number;
}

/** What `install` wrote in a unit's header: the checkout, the build and the port. */
export function parseUnit(text: string): InstalledUnit {
  const found: InstalledUnit = {};
  for (const line of text.split("\n")) {
    const match = /^# (repo|build|port)=(.*)$/.exec(line);
    const value = match?.[2] ?? "";
    if (match?.[1] === "port") found.port = Number(value);
    else if (match?.[1] === "repo" || match?.[1] === "build") found[match[1]] = value;
  }
  return found;
}

async function git(deps: TrayDeps, repo: string, args: string[]): Promise<string | undefined> {
  const result = await deps.run("git", args, repo);
  return result.code === 0 ? result.stdout.trim() : undefined;
}

/** "main @ 1a2b3c4" ("detached @ ..." off a branch); "unknown build" outside git. */
export async function buildLabel(deps: TrayDeps, repo: string): Promise<string> {
  const sha = await git(deps, repo, ["rev-parse", "--short", "HEAD"]);
  if (!sha) return "unknown build";
  const branch = await git(deps, repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return `${branch || "detached"} @ ${sha}`;
}

/** The newest modification time of a file under `path` (or of `path`), 0 if there is none. */
async function newest(path: string): Promise<{ time: number; file?: string }> {
  const info = await stat(path).catch(() => undefined);
  if (!info) return { time: 0 };
  if (!info.isDirectory()) return { time: info.mtimeMs, file: path };
  let best: { time: number; file?: string } = { time: 0 };
  for (const entry of await readdir(path)) {
    const found = await newest(join(path, entry));
    if (found.time > best.time) best = found;
  }
  return best;
}

/**
 * Refuses a checkout whose UI isn't built (the hub would serve only its API), and says when
 * the build looks older than the checkout: a source file or HEAD's commit newer than it.
 */
async function checkBuilt(out: Output, deps: TrayDeps): Promise<void> {
  const repo = deps.repoRoot;
  const built = await stat(join(repo, "dist", "web", "index.html")).catch(() => undefined);
  if (!built) {
    throw new UserError(
      `the UI of ${repo} isn't built (no dist/web), so the hub would only serve its API: run \`npm run build\` there, then \`preside tray install\` again. Nothing was changed.`,
    );
  }
  const sources = { time: 0 } as { time: number; file?: string };
  for (const path of UI_SOURCES) {
    const found = await newest(join(repo, path));
    if (found.time > sources.time) Object.assign(sources, found);
  }
  const commit = Number(await git(deps, repo, ["log", "-1", "--format=%ct"])) * 1000;
  const why =
    sources.time > built.mtimeMs && sources.file
      ? `${sources.file.slice(repo.length + 1)} changed after it`
      : commit > built.mtimeMs
        ? "HEAD was committed after it"
        : undefined;
  if (why) {
    out.error(
      `preside: warning: the UI in ${join(repo, "dist", "web")} looks older than the checkout (${why}), so it may not be this build's. Run \`npm run build\` there and install again if it isn't.`,
    );
  }
}

async function systemctl(deps: TrayDeps, args: string[]): Promise<{ ok: boolean; text: string }> {
  const result = await deps.run("systemctl", ["--user", ...args], deps.repoRoot);
  return { ok: result.code === 0, text: (result.stdout + result.stderr).trim() };
}

async function mustSystemctl(deps: TrayDeps, args: string[], what: string): Promise<void> {
  const result = await systemctl(deps, args);
  if (!result.ok) throw new UserError(`${what} failed: ${result.text || "systemctl failed"}`);
}

/** Who answers on the port: president.service's hub, nobody, or another program (its pid). */
type HubAnswer = "ours" | "none" | number;

async function whoAnswers(deps: TrayDeps, port: number): Promise<HubAnswer> {
  const pid = await deps.healthPid(port);
  if (pid === undefined) return "none";
  const main = await systemctl(deps, ["show", "--property=MainPID", "--value", HUB_UNIT]);
  return main.ok && Number(main.text) !== pid ? pid : "ours";
}

async function install(args: string[], out: Output, deps: TrayDeps): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { "no-autostart": { type: "boolean" }, "no-start": { type: "boolean" } },
  });
  const port = portFromEnv(deps.env);
  const dir = unitDir(deps.env);
  await checkBuilt(out, deps);
  if (!(await systemctl(deps, ["show-environment"])).ok) {
    throw new UserError(
      "can't reach your systemd user manager (`systemctl --user`), which runs the hub in the background. Without it, run the hub with `preside serve`.",
    );
  }
  const config: UnitConfig = {
    node: deps.nodePath,
    repo: deps.repoRoot,
    port,
    build: await buildLabel(deps, deps.repoRoot),
    env: Object.fromEntries(
      PASSED_ON.flatMap((key) => {
        const value = deps.env[key];
        return value ? [[key, value]] : [];
      }),
    ),
  };
  const hubPath = join(dir, HUB_UNIT);
  const before = parseUnit(await readFile(hubPath, "utf8").catch(() => ""));
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(hubPath, hubUnit(config));
  await writeFileAtomic(join(dir, ICON_UNIT), iconUnit(config));
  await mustSystemctl(deps, ["daemon-reload"], "reloading systemd's user units");
  out.log(`Wrote ${hubPath} and ${ICON_UNIT}`);
  out.log(`  serving: ${config.repo} (${config.build})`);
  if (before.repo !== undefined && before.repo !== config.repo) {
    out.log(`  instead of: ${before.repo} (${before.build ?? "unknown build"})`);
  }
  out.log(`  log: ${LOGS}`);

  if (!values["no-autostart"]) {
    await mustSystemctl(deps, ["enable", HUB_UNIT], "turning on start at login");
    out.log("Starts at login (`systemctl --user disable president` turns that off).");
  }
  if (!values["no-start"]) {
    // A restart also starts a stopped hub, and restarts the icon with it (PartOf).
    await mustSystemctl(deps, ["restart", HUB_UNIT], "starting the hub");
    let hub: HubAnswer = "none";
    for (let i = 0; i < ANSWER_TRIES && hub === "none"; i++) {
      hub = await whoAnswers(deps, port);
      if (hub === "none") await deps.sleep(500);
    }
    const url = `http://127.0.0.1:${port}`;
    if (hub === "ours") out.log(`Started: the hub is at ${url}, its icon in your tray.`);
    else if (hub === "none") {
      out.log(`Started, but the hub doesn't answer at ${url} yet: see \`${LOGS}\`.`);
    } else {
      out.log(
        `Started, but another program answers at ${url} (pid ${hub}), so this build isn't the one you'd see there: stop it (an \`npm start\`?) and ${HUB_UNIT} starts again on its own.`,
      );
    }
  } else if (before.repo !== undefined) {
    out.log(
      `Not restarted: a hub already running keeps serving what it started with until \`systemctl --user restart ${HUB_UNIT}\`.`,
    );
  }
  out.log(
    "The icon shows in a StatusNotifierItem tray: waybar's tray module, KDE Plasma, or GNOME with the AppIndicator extension. Without one the hub runs all the same.",
  );
  return 0;
}

async function uninstall(out: Output, deps: TrayDeps): Promise<number> {
  const dir = unitDir(deps.env);
  // Not installed, or no user manager: still fine, the files go all the same.
  await systemctl(deps, ["disable", "--now", HUB_UNIT]);
  await systemctl(deps, ["stop", ICON_UNIT]);
  for (const name of [HUB_UNIT, ICON_UNIT]) await rm(join(dir, name), { force: true });
  await systemctl(deps, ["daemon-reload"]);
  await systemctl(deps, ["reset-failed", HUB_UNIT, ICON_UNIT]);
  out.log(
    `Removed president's units (stopped the hub and its icon, no longer starts at login, ${HUB_UNIT} and ${ICON_UNIT} deleted from ${dir}).`,
  );
  return 0;
}

async function status(out: Output, deps: TrayDeps): Promise<number> {
  const dir = unitDir(deps.env);
  const hubPath = join(dir, HUB_UNIT);
  const text = await readFile(hubPath, "utf8").catch(() => undefined);
  if (text === undefined) {
    out.log("The hub's unit isn't installed. Run `preside tray install`.");
    return 1;
  }
  const unit = parseUnit(text);
  out.log(`unit: ${hubPath}`);
  out.log(`checkout: ${unit.repo ?? "(missing)"}`);
  out.log(`build: ${unit.build ?? "(missing)"}`);
  if (unit.repo === undefined || !existsSync(join(unit.repo, HUB_SOURCE))) {
    out.log(
      "That checkout is gone, so the hub can't start: run `preside tray install` from the checkout to serve (main's, to put main back).",
    );
  } else {
    const now = await buildLabel(deps, unit.repo);
    if (now !== unit.build) {
      out.log(
        `The checkout is now at ${now}: the hub still runs what it started with until \`preside tray install\` is run there again.`,
      );
    }
  }
  const state = async (name: string) =>
    (await systemctl(deps, ["is-active", name])).text || "unknown";
  const enabled = (await systemctl(deps, ["is-enabled", HUB_UNIT])).text || "unknown";
  out.log(`hub: ${await state(HUB_UNIT)} (${enabled} at login)`);
  out.log(`icon: ${await state(ICON_UNIT)}`);
  const port = unit.port ?? portFromEnv(deps.env);
  const hub = await whoAnswers(deps, port);
  const url = `http://127.0.0.1:${port}`;
  out.log(
    hub === "ours"
      ? `hub: answering at ${url}`
      : hub === "none"
        ? `hub: not answering at ${url}`
        : `hub: another program answers at ${url} (pid ${hub}), not ${HUB_UNIT}`,
  );
  out.log(`log: ${LOGS}`);
  return 0;
}
