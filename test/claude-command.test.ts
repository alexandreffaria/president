/**
 * `claude` comes from an absolute PATH folder, never from the card's project folder the run
 * starts in, and on Windows also from npm's claude.cmd, read rather than run
 * (src/server/chat/claude-command.ts). A run is stopped with everything it started, on Linux
 * by its process group and on Windows by taskkill /T.
 */
import { copyFile, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLAUDE_NOT_FOUND, resolveClaude, shimTarget } from "../src/server/chat/claude-command.ts";
import { runClaude } from "../src/server/chat/runner.ts";
import { nodeShim, nodeShimV9, programShim } from "./cmd-shim.ts";
import { tempDir, until } from "./helpers.ts";

const windows = process.platform === "win32";
/** The folder test/setup.ts put the stand-in in (`claude`, or claude.cmd on Windows). */
const STAND_IN = join(process.env.XDG_STATE_HOME ?? "", "bin");
const FAKE = join(import.meta.dirname, "fake-claude.mjs");

/** An environment whose PATH is `dirs` (the key Windows has, often "Path"). */
function withPath(dirs: string[], base: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const key = windows
    ? (Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH")
    : "PATH";
  const env = { ...base };
  for (const k of Object.keys(env)) if (k.toUpperCase() === "PATH") delete env[k];
  env[key] = dirs.join(delimiter);
  return env;
}

/**
 * A project folder with a `claude` and a `node` of its own, at its root and in bin/, that
 * leave a mark when they run: on Windows a claude.exe (Node, which can't take the run's
 * flags) and a claude.cmd; on Linux shell scripts.
 */
async function projectWithItsOwnClaude(): Promise<{
  project: string;
  ran: () => Promise<boolean>;
}> {
  const project = await tempDir();
  const mark = join(project, "ran");
  for (const dir of [project, join(project, "bin")]) {
    await mkdir(dir, { recursive: true });
    if (windows) {
      await copyFile(process.execPath, join(dir, "claude.exe"));
      await writeFile(join(dir, "claude.cmd"), `@echo ran> "${mark}"\r\n`);
    } else {
      for (const name of ["claude", "node"]) {
        await writeFile(join(dir, name), `#!/bin/sh\necho ran > '${mark}'\n`, { mode: 0o755 });
      }
    }
  }
  return {
    project,
    ran: () =>
      readFile(mark).then(
        () => true,
        () => false,
      ),
  };
}

function run(
  cwd: string,
  env: NodeJS.ProcessEnv,
  extra: Partial<Parameters<typeof runClaude>[0]> = {},
) {
  return runClaude({
    bin: "claude",
    cwd,
    session: { oneOff: true },
    message: "Hello",
    env,
    ...extra,
  });
}

describe("finding claude", () => {
  it("never runs a claude in the project folder", async () => {
    const { project, ran } = await projectWithItsOwnClaude();
    // The run starts in the project folder; on Windows libuv would look there first.
    const result = await run(project, withPath([STAND_IN], process.env));
    expect(result).toMatchObject({ ok: true, text: "Echo: Hello" });
    expect(await ran()).toBe(false);
  });

  it("skips empty and relative PATH entries", async () => {
    const { project, ran } = await projectWithItsOwnClaude();
    // "", "." and "bin" all mean a folder in the project, the run's cwd.
    const relative = ["", ".", "bin"];
    expect(resolveClaude("claude", withPath(relative))).toEqual({
      error: CLAUDE_NOT_FOUND,
    });
    const result = await run(project, withPath(relative, process.env));
    expect(result).toMatchObject({
      ok: false,
      started: false,
      error: CLAUDE_NOT_FOUND,
    });
    expect(await ran()).toBe(false);
    // With an absolute entry after them, that one.
    const found = await run(project, withPath([...relative, STAND_IN], process.env));
    expect(found).toMatchObject({ ok: true, text: "Echo: Hello" });
    expect(await ran()).toBe(false);
  });

  it("says Claude Code isn't installed when no PATH folder has it", async () => {
    const empty = await tempDir();
    expect(resolveClaude("claude", withPath([empty]))).toEqual({
      error: CLAUDE_NOT_FOUND,
    });
    const result = await run(await tempDir(), withPath([empty], process.env));
    expect(result).toMatchObject({
      ok: false,
      started: false,
      error: CLAUDE_NOT_FOUND,
    });
    expect(result.error).toMatch(/couldn't find the `claude` command/);
  });

  it("runs a script given by its path with Node", () => {
    expect(resolveClaude(FAKE)).toEqual({
      file: process.execPath,
      args: [FAKE],
    });
  });

  it.skipIf(windows)(
    "runs a claude linked to a Node script with president's own Node",
    async () => {
      // npm's install on Linux and macOS: `claude` is a link to the package's cli.js.
      const npm = await tempDir();
      const pkg = join(npm, "lib", "node_modules", "@anthropic-ai", "claude-code");
      await mkdir(pkg, { recursive: true });
      await writeFile(join(pkg, "package.json"), JSON.stringify({ type: "module" }));
      await copyFile(FAKE, join(pkg, "cli.js"));
      await mkdir(join(npm, "bin"));
      await symlink(join(pkg, "cli.js"), join(npm, "bin", "claude"));
      expect(resolveClaude("claude", withPath([join(npm, "bin")]))).toEqual({
        file: process.execPath,
        args: [await realpath(join(pkg, "cli.js"))],
      });
      // Its `#!/usr/bin/env node` would find the project's own node through "" or ".".
      const { project, ran } = await projectWithItsOwnClaude();
      const result = await run(project, withPath(["", ".", "bin", join(npm, "bin")], process.env));
      expect(result).toMatchObject({ ok: true, text: "Echo: Hello" });
      expect(await ran()).toBe(false);
      // And a script without an extension, by its `#!` line.
      const plain = await tempDir();
      await writeFile(join(plain, "claude"), "#!/usr/bin/env node\n", { mode: 0o755 });
      expect(resolveClaude("claude", withPath([plain]))).toEqual({
        file: process.execPath,
        args: [await realpath(join(plain, "claude"))],
      });
    },
  );

  it("gives the run a PATH of its absolute entries only", async () => {
    const fake = await tempDir();
    const env = withPath(["", ".", "bin", STAND_IN], { ...process.env, FAKE_CLAUDE_DIR: fake });
    const result = await run(await tempDir(), env, { bin: FAKE });
    expect(result).toMatchObject({ ok: true });
    const [call] = (await readFile(join(fake, "calls.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { path?: string });
    expect(call?.path).toBe(STAND_IN);
  });

  it.runIf(windows)("prefers claude.exe to claude.cmd, wherever each is on PATH", async () => {
    const first = await tempDir();
    const second = await tempDir();
    await writeFile(join(first, "claude.cmd"), programShim("claude-other.exe"));
    await copyFile(process.execPath, join(first, "claude-other.exe"));
    await copyFile(process.execPath, join(second, "claude.exe"));
    expect(resolveClaude("claude", withPath([first, second]))).toEqual({
      file: join(second, "claude.exe"),
      args: [],
    });
    // And in the same folder (a new one: what was found for that PATH is remembered).
    const both = await tempDir();
    await writeFile(join(both, "claude.cmd"), programShim("claude-other.exe"));
    await copyFile(process.execPath, join(both, "claude-other.exe"));
    await copyFile(process.execPath, join(both, "claude.exe"));
    expect(resolveClaude("claude", withPath([both]))).toEqual({
      file: join(both, "claude.exe"),
      args: [],
    });
  });

  it.runIf(windows)("runs the script npm's claude.cmd starts with Node", async () => {
    const npm = await tempDir();
    const pkg = join(npm, "node_modules", "@anthropic-ai", "claude-code");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "cli.js"), "#!/usr/bin/env node\n");
    await writeFile(
      join(npm, "claude.cmd"),
      nodeShim("node_modules\\@anthropic-ai\\claude-code\\cli.js"),
    );
    expect(resolveClaude("claude", withPath([npm]))).toEqual({
      file: process.execPath,
      args: [join(pkg, "cli.js")],
    });
    // The stand-in is installed this way, and answers.
    const result = await run(await tempDir(), withPath([STAND_IN], process.env));
    expect(result).toMatchObject({ ok: true, text: "Echo: Hello" });
  });

  it.runIf(windows)("runs the program npm's claude.cmd starts", async () => {
    const npm = await tempDir();
    const bin = join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin");
    await mkdir(bin, { recursive: true });
    await copyFile(process.execPath, join(bin, "claude.exe"));
    await writeFile(
      join(npm, "claude.cmd"),
      programShim("node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"),
    );
    expect(resolveClaude("claude", withPath([npm]))).toEqual({
      file: join(bin, "claude.exe"),
      args: [],
    });
  });

  it.runIf(windows)("says so when a claude.cmd starts nothing it knows", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "claude.cmd"), "@echo off\r\nsomething-else %*\r\n");
    const result = resolveClaude("claude", withPath([dir]));
    expect(result).toEqual({
      error: expect.stringMatching(/found .*claude\.cmd but can't tell/),
    });
  });
});

describe("reading npm's shim", () => {
  it("finds the script of a Node package, not Node", async () => {
    const npm = await tempDir();
    const pkg = join(npm, "node_modules", "@anthropic-ai", "claude-code");
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "cli.js"), "");
    // Even with a node.exe next to the shim, as npm's own folder has.
    await copyFile(process.execPath, join(npm, "node.exe"));
    // As npm 11 (cmd-shim 7) and npm 12 (cmd-shim 9) write it.
    for (const shim of [nodeShim, nodeShimV9]) {
      await writeFile(
        join(npm, "claude.cmd"),
        shim("node_modules\\@anthropic-ai\\claude-code\\cli.js"),
      );
      expect(shimTarget(join(npm, "claude.cmd"))).toBe(join(pkg, "cli.js"));
    }
  });

  it("finds the program of today's package", async () => {
    const npm = await tempDir();
    const bin = join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "claude.exe"), "");
    await writeFile(
      join(npm, "claude.cmd"),
      programShim("node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"),
    );
    expect(shimTarget(join(npm, "claude.cmd"))).toBe(join(bin, "claude.exe"));
  });

  it('reads the "%~dp0\\..." form of pnpm and older npm', async () => {
    const root = await tempDir();
    const shims = join(root, "shims");
    const pkg = join(root, "global", "node_modules", "@anthropic-ai", "claude-code");
    await mkdir(shims);
    await mkdir(pkg, { recursive: true });
    await writeFile(join(pkg, "cli.js"), "");
    await writeFile(
      join(shims, "claude.cmd"),
      [
        "@SETLOCAL",
        '@SET "NODE_PATH=%~dp0\\..\\global\\node_modules"',
        '@IF EXIST "%~dp0\\node.exe" (',
        '  "%~dp0\\node.exe"  "%~dp0\\..\\global\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
        ") ELSE (",
        "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
        '  node  "%~dp0\\..\\global\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
        ")",
      ].join("\r\n"),
    );
    expect(shimTarget(join(shims, "claude.cmd"))).toBe(join(pkg, "cli.js"));
  });

  it("falls back on the bin of the package next to the shim", async () => {
    const npm = await tempDir();
    const pkg = join(npm, "node_modules", "@anthropic-ai", "claude-code");
    await mkdir(join(pkg, "bin"), { recursive: true });
    await writeFile(join(pkg, "bin", "claude.exe"), "");
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ bin: { claude: "bin/claude.exe" } }),
    );
    await writeFile(join(npm, "claude.cmd"), "@echo off\r\nsomething-else %*\r\n");
    expect(shimTarget(join(npm, "claude.cmd"))).toBe(join(pkg, "bin", "claude.exe"));
  });

  it("finds nothing when the shim's target is missing or not a program", async () => {
    const npm = await tempDir();
    await writeFile(join(npm, "claude.cmd"), programShim("node_modules\\gone\\claude.exe"));
    expect(shimTarget(join(npm, "claude.cmd"))).toBeUndefined();
    await writeFile(join(npm, "other.sh"), "");
    await writeFile(join(npm, "claude.cmd"), programShim("other.sh"));
    expect(shimTarget(join(npm, "claude.cmd"))).toBeUndefined();
    expect(shimTarget(join(npm, "no-such.cmd"))).toBeUndefined();
  });
});

describe("stopping a run", () => {
  /** A run that started a process of its own and then hangs; its fake folder. */
  async function hangingRun() {
    const fake = await tempDir();
    await writeFile(
      join(fake, "script.json"),
      JSON.stringify([{ grandchild: true, delayMs: 60_000 }]),
    );
    const env = { ...process.env, FAKE_CLAUDE_DIR: fake };
    const pid = async () => {
      await until(
        () => readFile(join(fake, "grandchild.pid"), "utf8").then(Boolean, () => false),
        "the run to start its own process",
        { timeoutMs: 15_000 },
      );
      return Number(await readFile(join(fake, "grandchild.pid"), "utf8"));
    };
    return { env, pid };
  }

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("stops a run that takes too long, with what it started", { timeout: 30_000 }, async () => {
    const { env, pid } = await hangingRun();
    const started = Date.now();
    const result = await run(await tempDir(), env, {
      bin: FAKE,
      timeoutMs: 1500,
    });
    // Ending at all means the process holding its output open was stopped too.
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/took longer/),
    });
    expect(Date.now() - started).toBeLessThan(20_000);
    const grandchild = await pid();
    await until(() => !alive(grandchild), "the process the run started to stop", {
      timeoutMs: 15_000,
    });
  });

  it("stops a run that ended but left a process holding its output", {
    timeout: 30_000,
  }, async () => {
    const fake = await tempDir();
    await writeFile(
      join(fake, "script.json"),
      JSON.stringify([{ grandchild: true, exitEarly: true }]),
    );
    const env = { ...process.env, FAKE_CLAUDE_DIR: fake };
    let grandchild: number | undefined;
    try {
      const started = Date.now();
      const result = await run(await tempDir(), env, { bin: FAKE, timeoutMs: 1500 });
      grandchild = Number(await readFile(join(fake, "grandchild.pid"), "utf8"));
      expect({ ...result, ms: Date.now() - started, alive: alive(grandchild) }).toMatchObject({
        ok: false,
        error: expect.stringMatching(/took longer/),
      });
    } finally {
      // On Windows the process is left running once the run's own has exited: no tree to find.
      grandchild ??= Number(await readFile(join(fake, "grandchild.pid"), "utf8").catch(() => 0));
      if (grandchild && alive(grandchild)) process.kill(grandchild);
    }
  });

  it("stops a run when president shuts down, with what it started", {
    timeout: 30_000,
  }, async () => {
    const { env, pid } = await hangingRun();
    const controller = new AbortController();
    const result = run(await tempDir(), env, {
      bin: FAKE,
      signal: controller.signal,
    });
    const grandchild = await pid();
    controller.abort();
    expect(await result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/shutting down/),
    });
    await until(() => !alive(grandchild), "the process the run started to stop", {
      timeoutMs: 15_000,
    });
  });
});
