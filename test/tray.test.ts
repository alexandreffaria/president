/**
 * `preside tray` (20261112vzn8): the TypeScript side, run here with a stand-in Windows (the
 * compiler, the helper exe and the Run key are fakes that record what they were asked). The
 * helper itself is compiled and smoke-tested on Windows in CI (`--self-test`).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli/main.ts";
import {
  CONFIG_NAME,
  EXE_NAME,
  formatConfig,
  parseConfig,
  type RunResult,
  TRAY_SOURCE,
  type TrayDeps,
  tray,
} from "../src/cli/tray.ts";
import { tempDir } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");

function output() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
  };
}

/** A Windows with csc.exe, where every program run is recorded. */
async function fakeWindows(options: { csc?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const root = await tempDir();
  const localAppData = join(root, "AppData", "Local");
  const windir = join(root, "Windows");
  const csc = join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (options.csc ?? true) {
    await mkdir(join(csc, ".."), { recursive: true });
    await writeFile(csc, "");
  }
  const calls: string[][] = [];
  const launched: string[][] = [];
  let autostart = false;
  const state = { compileFails: false };
  const deps: TrayDeps = {
    platform: "win32",
    env: { LOCALAPPDATA: localAppData, WINDIR: windir, ...options.env },
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    repoRoot: ROOT,
    async run(file, args): Promise<RunResult> {
      calls.push([file, ...args]);
      if (file === csc) {
        if (state.compileFails) {
          return { code: 1, stdout: "PresideTray.cs(1,1): error CS1002: ; expected", stderr: "" };
        }
        const target = args.find((a) => a.startsWith("/out:"))?.slice(5) ?? "";
        await writeFile(target, "exe");
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "--autostart") autostart = args[1] === "on";
      if (args[0] === "--status") {
        return {
          code: 0,
          stdout: `running: no\r\nautostart: ${autostart ? "on" : "off"}\r\n`,
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    launch(file, args) {
      launched.push([file, ...args]);
    },
    hubAnswers: async () => false,
    sleep: async () => {},
  };
  const dir = join(localAppData, "president");
  return {
    deps,
    calls,
    launched,
    csc,
    dir,
    exe: join(dir, EXE_NAME),
    set compileFails(value: boolean) {
      state.compileFails = value;
    },
  };
}

describe("preside tray", () => {
  it.each(["install", "uninstall", "status"])(
    "refuses `%s` outside Windows, saying it is Windows only",
    async (sub) => {
      const { deps, calls } = await fakeWindows();
      const { io, err } = output();
      expect(await tray([sub], io, { ...deps, platform: "linux" })).toBe(1);
      expect(err.join("\n")).toMatch(/Windows only/);
      expect(calls).toEqual([]);
    },
  );

  it.skipIf(process.platform === "win32")("refuses on this system from the real CLI", async () => {
    const { io, err } = output();
    expect(await run(["tray", "install"], io)).toBe(1);
    expect(err.join("\n")).toMatch(/Windows only/);
  });

  it("explains its usage for a missing or unknown subcommand", async () => {
    const { deps } = await fakeWindows();
    for (const args of [[], ["start"]]) {
      const { io, err } = output();
      expect(await tray(args, io, deps)).toBe(2);
      expect(err.join("\n")).toMatch(/usage: preside tray install/);
    }
  });

  it("is in the help", async () => {
    const { io, out } = output();
    await run(["help"], io);
    expect(out.join("\n")).toMatch(/preside tray install \[--no-autostart\] \[--no-start\]/);
    expect(out.join("\n")).toMatch(/preside tray uninstall/);
  });

  it("install compiles the helper, records node and the repo, turns on autostart and starts it", async () => {
    const { deps, calls, launched, csc, dir, exe } = await fakeWindows();
    const { io, out } = output();
    expect(await tray(["install"], io, deps)).toBe(0);
    expect(calls[0]).toEqual([
      csc,
      "/nologo",
      "/target:winexe",
      "/optimize+",
      `/out:${join(dir, "PresideTray.new.exe")}`,
      "/reference:System.dll",
      "/reference:System.Drawing.dll",
      "/reference:System.Windows.Forms.dll",
      join(ROOT, TRAY_SOURCE),
    ]);
    expect(await readFile(exe, "utf8")).toBe("exe");
    expect(existsSync(join(dir, "PresideTray.new.exe"))).toBe(false);
    const config = parseConfig(await readFile(join(dir, CONFIG_NAME), "utf8"));
    expect(config).toMatchObject({
      node: "C:\\Program Files\\nodejs\\node.exe",
      repo: ROOT,
      port: 4747,
    });
    expect(config.source).toMatch(/^[0-9a-f]{64}$/);
    expect(calls.slice(1)).toEqual([[exe, "--autostart", "on"]]);
    expect(launched).toEqual([[exe]]);
    expect(out.join("\n")).toMatch(/Other system tray icons > president: On/);
  });

  it("install --no-autostart --no-start only builds, and records PRESIDENT_PORT", async () => {
    const { deps, calls, launched, dir } = await fakeWindows({ env: { PRESIDENT_PORT: "4800" } });
    expect(await tray(["install", "--no-autostart", "--no-start"], output().io, deps)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(launched).toEqual([]);
    expect(parseConfig(await readFile(join(dir, CONFIG_NAME), "utf8")).port).toBe(4800);
  });

  it("install again stops the running helper before replacing it", async () => {
    const { deps, calls, exe } = await fakeWindows();
    await tray(["install"], output().io, deps);
    calls.length = 0;
    expect(await tray(["install", "--no-start"], output().io, deps)).toBe(0);
    expect(calls.slice(1, 3)).toEqual([
      [exe, "--quit"],
      [exe, "--autostart", "on"],
    ]);
  });

  it("a failed build changes nothing and leaves the running helper alone", async () => {
    const windows = await fakeWindows();
    const { deps, calls, dir, exe } = windows;
    await tray(["install"], output().io, deps);
    const before = await readFile(join(dir, CONFIG_NAME), "utf8");
    calls.length = 0;
    windows.compileFails = true;
    await expect(tray(["install"], output().io, deps)).rejects.toThrow(
      /compiling the tray helper failed/,
    );
    expect(calls).toHaveLength(1); // only csc: no --quit
    expect(await readFile(exe, "utf8")).toBe("exe");
    expect(await readFile(join(dir, CONFIG_NAME), "utf8")).toBe(before);
    expect(existsSync(join(dir, "PresideTray.new.exe"))).toBe(false);
  });

  it("says where to get the compiler when csc.exe isn't there", async () => {
    const { deps, dir } = await fakeWindows({ csc: false });
    await expect(tray(["install"], output().io, deps)).rejects.toThrow(/C# compiler/);
    expect(existsSync(dir)).toBe(false);
  });

  it("refuses a PRESIDENT_PORT that isn't a port", async () => {
    const { deps } = await fakeWindows({ env: { PRESIDENT_PORT: "http" } });
    await expect(tray(["install"], output().io, deps)).rejects.toThrow(/PRESIDENT_PORT/);
  });

  it("uninstall stops the helper, turns off autostart and removes its folder", async () => {
    const { deps, calls, dir, exe } = await fakeWindows();
    await tray(["install"], output().io, deps);
    await writeFile(join(dir, "hub.log"), "log\n");
    calls.length = 0;
    expect(await tray(["uninstall"], output().io, deps)).toBe(0);
    expect(calls).toEqual([
      [exe, "--quit"],
      [exe, "--autostart", "off"],
    ]);
    expect(existsSync(dir)).toBe(false);
  });

  it("uninstall keeps files it didn't write, and clears the Run value with reg when the exe is gone", async () => {
    const { deps, calls, dir } = await fakeWindows();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, CONFIG_NAME), "node=x\n");
    await writeFile(join(dir, "notes.txt"), "mine\n");
    expect(await tray(["uninstall"], output().io, deps)).toBe(0);
    expect(calls).toEqual([
      [
        "reg",
        "delete",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        "/v",
        "president",
        "/f",
      ],
    ]);
    expect(await readdir(dir)).toEqual(["notes.txt"]);
  });

  it("status reports what the helper says, the hub, the log, and a stale build", async () => {
    const { deps, dir } = await fakeWindows();
    const missing = output();
    expect(await tray(["status"], missing.io, deps)).toBe(1);
    expect(missing.out.join("\n")).toMatch(/isn't installed/);

    await tray(["install"], output().io, deps);
    const { io, out } = output();
    expect(await tray(["status"], io, { ...deps, hubAnswers: async () => true })).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/^running: no$/m);
    expect(text).toMatch(/^autostart: on$/m);
    expect(text).toMatch(/hub: answering at http:\/\/127\.0\.0\.1:4747/);
    expect(text).toContain(join(dir, "hub.log"));
    expect(text).not.toMatch(/source changed/);

    const config = parseConfig(await readFile(join(dir, CONFIG_NAME), "utf8"));
    await writeFile(
      join(dir, CONFIG_NAME),
      formatConfig({ node: config.node ?? "", repo: ROOT, port: 4747, source: "0".repeat(64) }),
    );
    const stale = output();
    await tray(["status"], stale.io, deps);
    expect(stale.out.join("\n")).toMatch(/source changed since it was built/);
  });

  it("writes a config the helper can read: CRLF key=value lines, no line breaks in values", () => {
    const text = formatConfig({ node: "C:\\n\\node.exe", repo: "D:\\p r", port: 1, source: "ab" });
    expect(text).toContain("\r\nnode=C:\\n\\node.exe\r\nrepo=D:\\p r\r\nport=1\r\nsource=ab\r\n");
    expect(parseConfig(text)).toEqual({
      node: "C:\\n\\node.exe",
      repo: "D:\\p r",
      port: 1,
      source: "ab",
    });
    expect(() => formatConfig({ node: "a\nb", repo: "r", port: 1, source: "" })).toThrow(
      /line break/,
    );
  });
});

describe("the hub under the tray helper", () => {
  it("shuts down cleanly when its stdin closes (PRESIDENT_STOP_ON_STDIN_END)", {
    timeout: 30_000,
  }, async () => {
    const home = await tempDir();
    const child = spawn(process.execPath, [join(ROOT, "src", "server", "main.ts")], {
      cwd: ROOT,
      env: {
        ...process.env,
        PRESIDENT_PORT: "0",
        PRESIDENT_STOP_ON_STDIN_END: "1",
        XDG_CONFIG_HOME: join(home, "config"),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    const url = await new Promise<string>((resolve, reject) => {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        const match = /running at (http:\/\/\S+)/.exec(stdout);
        if (match?.[1]) resolve(match[1]);
      });
      child.once("exit", () => reject(new Error(`the hub exited: ${stdout}${stderr}`)));
    });
    expect((await fetch(`${url}/api/queue-count`)).status).toBe(200);
    child.stdin.end();
    expect(await exited).toBe(0);
    expect(stderr).toBe("");
  });
});
