/**
 * `preside tray` on Linux: the systemd user units, written into a temp XDG_CONFIG_HOME, with a
 * stand-in systemctl and git that record what they were asked. Nothing here reaches the real
 * user manager or starts a hub.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/main.ts";
import { type TrayDeps, tray } from "../src/cli/tray.ts";
import {
  HUB_UNIT,
  hubUnit,
  ICON_UNIT,
  iconUnit,
  parseUnit,
  type UnitConfig,
  unitDir,
} from "../src/cli/tray-linux.ts";
import { tempDir } from "./helpers.ts";

function output() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
  };
}

/** A checkout with a built UI: sources an hour old, the build a minute old. */
async function checkout(root: string, name: string): Promise<string> {
  const repo = join(root, name);
  await mkdir(join(repo, "dist", "web"), { recursive: true });
  await mkdir(join(repo, "src", "web"), { recursive: true });
  await mkdir(join(repo, "src", "server"), { recursive: true });
  await writeFile(join(repo, "src", "web", "main.tsx"), "");
  await writeFile(join(repo, "src", "server", "main.ts"), "");
  await writeFile(join(repo, "dist", "web", "index.html"), "");
  // The icon's dependency, as `npm ci` leaves it.
  const dbus = join(repo, "node_modules", "dbus-native");
  await mkdir(dbus, { recursive: true });
  await writeFile(join(dbus, "package.json"), '{ "name": "dbus-native", "main": "index.js" }');
  await writeFile(join(dbus, "index.js"), "");
  const hourAgo = new Date(Date.now() - 3_600_000);
  await utimes(join(repo, "src", "web", "main.tsx"), hourAgo, hourAgo);
  await utimes(join(repo, "src", "web"), hourAgo, hourAgo);
  const minuteAgo = new Date(Date.now() - 60_000);
  await utimes(join(repo, "dist", "web", "index.html"), minuteAgo, minuteAgo);
  return repo;
}

/** A Linux with a user manager, where every systemctl and git run is recorded. */
async function fakeLinux(options: { env?: NodeJS.ProcessEnv; systemd?: boolean } = {}) {
  const root = await tempDir();
  const main = await checkout(root, "president");
  const config = join(root, "config");
  const calls: string[][] = [];
  const state = {
    systemd: options.systemd ?? true,
    /** The icon crashes as it starts (is-active says it is being restarted). */
    iconFails: false,
    /** The user manager's environment, as `systemctl --user show-environment` prints it. */
    manager: "HOME=/home/u\nPATH=/usr/bin\n",
    active: new Set<string>(),
    enabled: false,
    /** president.service's pid, and the pid /api/health gives (undefined: nobody answers). */
    mainPid: 4242,
    answering: 4242 as number | undefined,
    /** What git says about each checkout. */
    heads: new Map<string, { branch?: string; sha: string; time: number }>([
      [main, { branch: "main", sha: "1a2b3c4", time: Math.floor(Date.now() / 1000) - 7200 }],
    ]),
  };
  const deps: TrayDeps = {
    platform: "linux",
    env: {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: config,
      PATH: "/usr/bin:/bin",
      ...options.env,
    },
    nodePath: "/usr/bin/node",
    repoRoot: main,
    async run(file, args, cwd) {
      calls.push([file, ...args]);
      if (file === "git") {
        const head = state.heads.get(cwd);
        if (!head) return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
        if (args[0] === "rev-parse") return { code: 0, stdout: `${head.sha}\n`, stderr: "" };
        if (args[0] === "symbolic-ref") {
          return head.branch
            ? { code: 0, stdout: `${head.branch}\n`, stderr: "" }
            : { code: 1, stdout: "", stderr: "" };
        }
        if (args[0] === "log") return { code: 0, stdout: `${head.time}\n`, stderr: "" };
      }
      if (file === "systemctl") {
        expect(args[0]).toBe("--user");
        if (!state.systemd) {
          return { code: 1, stdout: "", stderr: "Failed to connect to bus: No medium found" };
        }
        const [verb, ...units] = args.slice(1);
        if (verb === "enable") state.enabled = true;
        if (verb === "disable") state.enabled = false;
        if (verb === "restart") for (const unit of units) state.active.add(unit);
        if (verb === "is-active" && state.iconFails && units[0] === ICON_UNIT) {
          return { code: 3, stdout: "activating\n", stderr: "" };
        }
        if (verb === "disable" && units[0] === "--now") state.active.delete(units[1] ?? "");
        if (verb === "stop") for (const unit of units) state.active.delete(unit);
        if (verb === "is-active") {
          const on = state.active.has(units[0] ?? "");
          return { code: on ? 0 : 3, stdout: on ? "active\n" : "inactive\n", stderr: "" };
        }
        if (verb === "is-enabled") {
          return { code: 0, stdout: state.enabled ? "enabled\n" : "disabled\n", stderr: "" };
        }
        if (verb === "show") return { code: 0, stdout: `${state.mainPid}\n`, stderr: "" };
        if (verb === "show-environment") return { code: 0, stdout: state.manager, stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    launch() {
      throw new Error("nothing is launched on Linux");
    },
    healthPid: async () => state.answering,
    sleep: async () => {},
  };
  const dir = join(config, "systemd", "user");
  return { root, main, deps, calls, state, dir, hubPath: join(dir, HUB_UNIT) };
}

const systemctlCalls = (calls: string[][]) =>
  calls.filter(([file]) => file === "systemctl").map((call) => call.slice(2));

// The units hold Linux paths, so this runs where they are (the Windows side is tray.test.ts).
describe.skipIf(process.platform === "win32")("preside tray on Linux", () => {
  it("install writes the hub's and the icon's units for this checkout, enables and starts them", async () => {
    const { deps, calls, dir, main, root, hubPath } = await fakeLinux();
    const { io, out, err } = output();
    expect(await tray(["install"], io, deps)).toBe(0);
    expect(err).toEqual([]);

    const hub = await readFile(hubPath, "utf8");
    expect(hub).toContain(`ExecStart="/usr/bin/node" "${join(main, "src", "server", "main.ts")}"`);
    expect(hub).toContain(`WorkingDirectory=${main}`);
    expect(hub).toContain(`Wants=${ICON_UNIT}`);
    expect(hub).toContain("Restart=on-failure");
    expect(hub).toContain("Type=exec");
    // Sync's git gets to finish: SIGTERM to the hub alone, and time for it to stop.
    expect(hub).toContain("KillMode=mixed");
    expect(hub).toContain("TimeoutStopSec=150");
    expect(hub).toContain("WantedBy=default.target");
    expect(hub).toContain('Environment="PATH=/usr/bin:/bin"');
    expect(hub).toContain('Environment="PRESIDENT_PORT=4747"');
    expect(parseUnit(hub)).toEqual({ repo: main, build: "main @ 1a2b3c4", port: 4747 });

    const icon = await readFile(join(dir, ICON_UNIT), "utf8");
    expect(icon).toContain(
      `ExecStart="/usr/bin/node" "${join(main, "tray", "linux", "preside-tray.ts")}"`,
    );
    // Not tied to the hub: a hub restarting (or crash-looping) leaves the icon running.
    expect(icon).not.toMatch(/PartOf|BindsTo/);
    expect(icon).toContain("Type=exec");
    expect(icon).toContain('Environment="PRESIDENT_BUILD=main @ 1a2b3c4"');

    expect(systemctlCalls(calls)).toEqual([
      ["show-environment"],
      ["daemon-reload"],
      ["enable", HUB_UNIT],
      ["restart", HUB_UNIT, ICON_UNIT],
      ["show", "--property=MainPID", "--value", HUB_UNIT],
      ["is-active", ICON_UNIT],
    ]);
    const text = out.join("\n");
    expect(text).toContain(`serving: ${main} (main @ 1a2b3c4)`);
    expect(text).toMatch(/Starts at login/);
    expect(text).toMatch(/the hub is at http:\/\/127\.0\.0\.1:4747/);
    expect(text).toMatch(/The icon is running/);
    expect(text).toMatch(/waybar's tray module/);
    // Only the temp XDG_CONFIG_HOME was written.
    expect(existsSync(join(root, "home"))).toBe(false);
  });

  it("install from another checkout serves that build, and from main again puts main back", async () => {
    const linux = await fakeLinux();
    const { deps, calls, state, root, main, hubPath } = linux;
    await tray(["install"], output().io, deps);
    const pr = await checkout(root, "pr-worktree");
    state.heads.set(pr, { branch: "feat/x", sha: "9f8e7d6", time: 0 });

    calls.length = 0;
    const swapped = output();
    expect(await tray(["install"], swapped.io, { ...deps, repoRoot: pr })).toBe(0);
    expect(parseUnit(await readFile(hubPath, "utf8"))).toMatchObject({
      repo: pr,
      build: "feat/x @ 9f8e7d6",
    });
    expect(await readFile(hubPath, "utf8")).toContain(join(pr, "src", "server", "main.ts"));
    expect(systemctlCalls(calls)).toContainEqual(["restart", HUB_UNIT, ICON_UNIT]);
    expect(swapped.out.join("\n")).toContain(`instead of: ${main} (main @ 1a2b3c4)`);

    const back = output();
    expect(await tray(["install"], back.io, deps)).toBe(0);
    expect(parseUnit(await readFile(hubPath, "utf8"))).toMatchObject({
      repo: main,
      build: "main @ 1a2b3c4",
    });
    expect(back.out.join("\n")).toContain(`instead of: ${pr} (feat/x @ 9f8e7d6)`);
  });

  it("install refuses a checkout whose UI isn't built, changing nothing", async () => {
    const { deps, calls, main, hubPath } = await fakeLinux();
    await tray(["install"], output().io, deps);
    const before = await readFile(hubPath, "utf8");
    await rm(join(main, "dist"), { recursive: true });
    calls.length = 0;
    await expect(tray(["install"], output().io, deps)).rejects.toThrow(
      /isn't built \(no dist\/web\).*npm run build.*Nothing was changed/,
    );
    expect(systemctlCalls(calls)).toEqual([]);
    expect(await readFile(hubPath, "utf8")).toBe(before);
  });

  it("install refuses a checkout without the icon's dependencies, changing nothing", async () => {
    const { deps, calls, main, dir } = await fakeLinux();
    await rm(join(main, "node_modules"), { recursive: true });
    await expect(tray(["install"], output().io, deps)).rejects.toThrow(
      /dependencies aren't installed in .* \(no dbus-native\): run `npm ci` there/,
    );
    expect(systemctlCalls(calls)).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  it("install says when the icon didn't stay up", async () => {
    const { deps, state } = await fakeLinux();
    state.iconFails = true;
    const { io, out } = output();
    expect(await tray(["install"], io, deps)).toBe(0);
    expect(out.join("\n")).toMatch(
      /The icon isn't running \(activating\): see `journalctl --user -u president\.service -u president-tray\.service`/,
    );
  });

  it("install warns when the UI looks older than its sources", async () => {
    const { deps, state, main } = await fakeLinux();
    const fresh = output();
    await tray(["install", "--no-start"], fresh.io, deps);
    expect(fresh.err).toEqual([]);

    // A commit after the build isn't a reason: only the sources' times are.
    state.heads.set(main, { branch: "main", sha: "1a2b3c4", time: Math.floor(Date.now() / 1000) });
    const committed = output();
    expect(await tray(["install", "--no-start"], committed.io, deps)).toBe(0);
    expect(committed.err).toEqual([]);

    await writeFile(join(main, "src", "web", "main.tsx"), "changed");
    const edited = output();
    expect(await tray(["install", "--no-start"], edited.io, deps)).toBe(0);
    expect(edited.err.join("\n")).toContain(
      `looks older than the checkout (${join("src", "web", "main.tsx")} changed after it)`,
    );
  });

  it("install --no-autostart --no-start only writes the units, and records PRESIDENT_PORT", async () => {
    const { deps, calls, hubPath } = await fakeLinux({ env: { PRESIDENT_PORT: "4800" } });
    expect(await tray(["install", "--no-autostart", "--no-start"], output().io, deps)).toBe(0);
    expect(systemctlCalls(calls)).toEqual([["show-environment"], ["daemon-reload"]]);
    const hub = await readFile(hubPath, "utf8");
    expect(hub).toContain('Environment="PRESIDENT_PORT=4800"');
    expect(parseUnit(hub).port).toBe(4800);
  });

  it("install says so when the hub doesn't answer after starting, or another program does", async () => {
    const { deps, state } = await fakeLinux();
    state.answering = undefined;
    const silent = output();
    expect(await tray(["install"], silent.io, deps)).toBe(0);
    expect(silent.out.join("\n")).toMatch(
      /doesn't answer at http:\/\/127\.0\.0\.1:4747 yet: see `journalctl --user -u president\.service/,
    );

    state.answering = 777;
    const other = output();
    expect(await tray(["install"], other.io, deps)).toBe(0);
    expect(other.out.join("\n")).toMatch(
      /another program answers at http:\/\/127\.0\.0\.1:4747 \(pid 777\), so this build isn't the one/,
    );
    const status = output();
    await tray(["status"], status.io, deps);
    expect(status.out).toContain(
      `hub: another program answers at http://127.0.0.1:4747 (pid 777), not ${HUB_UNIT}`,
    );
  });

  it("install --no-start over an installed hub says the running one isn't restarted", async () => {
    const { deps } = await fakeLinux();
    const first = output();
    await tray(["install", "--no-start"], first.io, deps);
    expect(first.out.join("\n")).not.toMatch(/Not restarted/);
    const again = output();
    await tray(["install", "--no-start"], again.io, deps);
    expect(again.out.join("\n")).toMatch(
      /Not restarted: a hub and icon already running keep serving what they started with/,
    );
  });

  it("install names a detached HEAD, and a checkout outside git", async () => {
    const { deps, state, main, hubPath } = await fakeLinux();
    state.heads.set(main, { sha: "abcdef0", time: 0 });
    await tray(["install", "--no-start"], output().io, deps);
    expect(parseUnit(await readFile(hubPath, "utf8")).build).toBe("detached @ abcdef0");
    state.heads.delete(main);
    await tray(["install", "--no-start"], output().io, deps);
    expect(parseUnit(await readFile(hubPath, "utf8")).build).toBe("unknown build");
  });

  it("install explains when there is no systemd user manager, and writes nothing", async () => {
    const { deps, dir } = await fakeLinux({ systemd: false });
    await expect(tray(["install"], output().io, deps)).rejects.toThrow(
      /can't reach your systemd user manager.*preside serve/,
    );
    expect(existsSync(dir)).toBe(false);
  });

  it("uninstall stops and disables the units and deletes them, installed or not", async () => {
    const { deps, calls, dir, hubPath, state } = await fakeLinux();
    await tray(["install"], output().io, deps);
    await writeFile(join(dir, "other.service"), "mine\n");
    calls.length = 0;
    const { io, out } = output();
    expect(await tray(["uninstall"], io, deps)).toBe(0);
    expect(systemctlCalls(calls)).toEqual([
      ["disable", "--now", HUB_UNIT],
      ["stop", ICON_UNIT],
      ["daemon-reload"],
      ["reset-failed", HUB_UNIT, ICON_UNIT],
    ]);
    expect(existsSync(hubPath)).toBe(false);
    expect(existsSync(join(dir, ICON_UNIT))).toBe(false);
    expect(existsSync(join(dir, "other.service"))).toBe(true);
    expect(state.enabled).toBe(false);
    expect(out.join("\n")).toMatch(/Removed president's units/);
    expect(await tray(["uninstall"], output().io, deps)).toBe(0);
  });

  it("status says what is served, whether it runs, and where the log is", async () => {
    const { deps, hubPath, main } = await fakeLinux();
    const missing = output();
    expect(await tray(["status"], missing.io, deps)).toBe(1);
    expect(missing.out.join("\n")).toMatch(/isn't installed/);

    await tray(["install"], output().io, deps);
    const { io, out } = output();
    expect(await tray(["status"], io, deps)).toBe(0);
    expect(out).toEqual([
      `unit: ${hubPath}`,
      `checkout: ${main}`,
      "build: main @ 1a2b3c4",
      "hub: active (enabled at login)",
      "icon: active",
      "hub: answering at http://127.0.0.1:4747",
      `log: journalctl --user -u ${HUB_UNIT} -u ${ICON_UNIT}`,
    ]);
  });

  it("status says when the checkout moved on or is gone", async () => {
    const { deps, state, main, root } = await fakeLinux();
    const pr = await checkout(root, "pr");
    state.heads.set(pr, { branch: "feat/x", sha: "9f8e7d6", time: 0 });
    await tray(["install", "--no-start"], output().io, { ...deps, repoRoot: pr });

    state.heads.set(pr, { branch: "feat/x", sha: "0000000", time: 0 });
    const moved = output();
    await tray(["status"], moved.io, deps);
    expect(moved.out.join("\n")).toMatch(
      /The checkout is now at feat\/x @ 0000000: the hub still runs what it started with/,
    );

    await rm(pr, { recursive: true });
    const gone = output();
    await tray(["status"], gone.io, deps);
    expect(gone.out.join("\n")).toMatch(/That checkout is gone, so the hub can't start/);
    void main;
  });

  it("puts the units in ~/.config/systemd/user without XDG_CONFIG_HOME", () => {
    expect(unitDir({ HOME: "/home/u" })).toBe("/home/u/.config/systemd/user");
    expect(unitDir({ HOME: "/home/u", XDG_CONFIG_HOME: "/x" })).toBe("/x/systemd/user");
    expect(() => unitDir({ XDG_CONFIG_HOME: "rel" })).toThrow(/absolute/);
    expect(() => unitDir({})).toThrow(/HOME/);
  });

  it("writes paths and values systemd takes literally", () => {
    const config: UnitConfig = {
      node: "/opt/my node/100%/node",
      repo: '/p/100% "x" $HOME\\y',
      port: 1,
      build: "a%b @ 1",
      env: { PATH: "/bin:/a%b" },
    };
    const hub = hubUnit(config);
    // The program is taken as it is (only specifiers), its arguments are unescaped.
    expect(hub).toContain(
      'ExecStart="/opt/my node/100%%/node" "/p/100%% \\"x\\" $$HOME\\\\y/src/server/main.ts"',
    );
    expect(hub).toContain('Environment="PATH=/bin:/a%%b"');
    expect(hub).toContain("Description=president hub (a%%b @ 1)");
    expect(iconUnit(config)).toContain('Environment="PRESIDENT_BUILD=a%%b @ 1"');
    expect(parseUnit(hub)).toEqual({ repo: config.repo, build: config.build, port: 1 });
  });

  it("refuses line breaks anywhere, environment included, and node paths systemd can't run", () => {
    const config: UnitConfig = { node: "/n", repo: "/r", port: 1, build: "b", env: {} };
    expect(() => hubUnit({ ...config, repo: "a\nb" })).toThrow(/checkout path has a line break/);
    expect(() => hubUnit({ ...config, env: { PATH: "/bin\nExecStartPre=/bin/sh" } })).toThrow(
      /PATH has a line break/,
    );
    expect(() => iconUnit({ ...config, env: { "A\nB": "x" } })).toThrow(
      /environment variable name has a line break/,
    );
    for (const node of ['/a"b/node', "/a\\b/node", "/a'b/node", "/$HOME/node"]) {
      expect(() => hubUnit({ ...config, node })).toThrow(/node's path has a quote/);
    }
  });

  it("install refuses a node path systemd can't run before writing anything", async () => {
    const { deps, dir } = await fakeLinux();
    await expect(
      tray(["install"], output().io, { ...deps, nodePath: "/home/$me/node" }),
    ).rejects.toThrow(/node's path has a quote, a backslash or a \$ in it/);
    expect(existsSync(dir)).toBe(false);
  });

  it("passes on CLAUDE_CONFIG_DIR, and not the ssh agent", async () => {
    const { deps, hubPath } = await fakeLinux({
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work", SSH_AUTH_SOCK: "/run/agent" },
    });
    await tray(["install", "--no-start"], output().io, deps);
    const hub = await readFile(hubPath, "utf8");
    expect(hub).toContain('Environment="CLAUDE_CONFIG_DIR=/home/u/.claude-work"');
    expect(hub).not.toContain("SSH_AUTH_SOCK");
  });

  it("status says when the shell has an ssh agent that systemd doesn't", async () => {
    const { deps, state } = await fakeLinux({ env: { SSH_AUTH_SOCK: "/run/agent" } });
    await tray(["install"], output().io, deps);
    const missing = output();
    await tray(["status"], missing.io, deps);
    expect(missing.out.join("\n")).toMatch(
      /systemd doesn't, so Sync can't use it.*dbus-update-activation-environment --systemd SSH_AUTH_SOCK/,
    );
    state.manager += "SSH_AUTH_SOCK=/run/agent\n";
    const given = output();
    await tray(["status"], given.io, deps);
    expect(given.out.join("\n")).not.toMatch(/ssh agent/);
  });

  it("is in the help, for Windows and Linux", async () => {
    const { io, out } = output();
    await run(["help"], io);
    expect(out.join("\n")).toMatch(/Linux: install systemd user units/);
  });
});
