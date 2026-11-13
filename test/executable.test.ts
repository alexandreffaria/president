/**
 * Git comes from PATH, never from the folder it runs in (R1-4 of PR #31): on Windows libuv
 * looks in the child's cwd before PATH, and on Linux an empty or relative PATH entry means a
 * folder relative to the cwd.
 */
import { chmod, copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findExecutable } from "../src/server/executable.ts";
import { runGit } from "../src/server/git.ts";
import { tempDir } from "./helpers.ts";

const windows = process.platform === "win32";

/** A project folder with a "git" of its own: node, which answers `--version` with "v24...". */
async function projectWithItsOwnGit(): Promise<string> {
  const project = await tempDir();
  if (windows) await copyFile(process.execPath, join(project, "git.exe"));
  else await symlink(process.execPath, join(project, "git"));
  await mkdir(join(project, "bin"));
  if (windows) await copyFile(process.execPath, join(project, "bin", "git.exe"));
  else await symlink(process.execPath, join(project, "bin", "git"));
  return project;
}

describe("finding git", () => {
  it("finds an absolute path on PATH", () => {
    const git = findExecutable("git");
    expect(git).toBeDefined();
    expect(isAbsolute(git ?? "")).toBe(true);
    expect(git).toMatch(windows ? /[\\/]git\.(exe|com)$/i : /\/git$/);
  });

  it("never looks in the cwd or in a relative PATH entry", async () => {
    const project = await projectWithItsOwnGit();
    const real = dirname(findExecutable("git") ?? "");
    // Empty, "." and relative entries all mean a folder under the cwd.
    const path = ["", ".", "bin", real].join(delimiter);
    const key = windows
      ? (Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH")
      : "PATH";
    const found = findExecutable("git", { [key]: path });
    expect(found).toBeDefined();
    expect(dirname(found ?? "")).toBe(real);
    expect(found?.startsWith(project)).toBe(false);
    // And with no absolute entry at all, nothing.
    expect(findExecutable("git", { [key]: ["", ".", "bin"].join(delimiter) })).toBeUndefined();
  });

  it("never runs a git in the project folder", async () => {
    const project = await projectWithItsOwnGit();
    // On Linux PATH also says to look in the cwd (an empty entry and "."), as execvp would.
    const options = windows
      ? {}
      : { env: { PATH: ["", ".", "bin", process.env.PATH ?? ""].join(delimiter) } };
    const result = await runGit(project, ["--version"], options);
    expect(result).toMatchObject({ code: 0, timedOut: false });
    expect(result.stdout).toMatch(/^git version /);
  });

  it("looks again when the git it found is gone", async () => {
    const a = await tempDir();
    const b = await tempDir();
    const name = windows ? "git.exe" : "git";
    for (const dir of [a, b]) {
      if (windows) await copyFile(process.execPath, join(dir, name));
      else await symlink(process.execPath, join(dir, name));
    }
    const env = windows ? { Path: [a, b].join(delimiter) } : { PATH: [a, b].join(delimiter) };
    expect(findExecutable("git", env)).toBe(join(a, name));
    await rm(join(a, name));
    expect(findExecutable("git", env)).toBe(join(b, name));
  });

  // R2-2: a git that is there but not executable says so (EACCES), not "not installed".
  it.skipIf(windows)("runs a git that isn't executable, so it says EACCES", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "git"), "#!/bin/sh\necho hi\n");
    await chmod(join(dir, "git"), 0o644);
    expect(findExecutable("git", { PATH: dir })).toBe(join(dir, "git"));
    const result = await runGit(dir, ["--version"], { env: { PATH: dir } });
    expect(result.code).toBeNull();
    expect(result.stderr).toMatch(/EACCES/);
    expect(result.stderr).not.toMatch(/not installed/);
  });
});
