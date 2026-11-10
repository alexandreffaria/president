import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfigDir, Registry, suggestName } from "../src/server/registry.ts";
import { copyDemoProject, tempDir } from "./helpers.ts";

async function registry() {
  return new Registry(join(await tempDir(), "config"));
}

describe("defaultConfigDir", () => {
  it("uses XDG_CONFIG_HOME when it is absolute", () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: "/x/config" })).toBe("/x/config/president");
  });
  it("falls back to ~/.config", () => {
    expect(defaultConfigDir({})).toMatch(/\.config\/president$/);
    expect(defaultConfigDir({ XDG_CONFIG_HOME: "relative" })).toMatch(/\.config\/president$/);
  });
});

describe("Registry", () => {
  it("starts empty and stores projects as JSON", async () => {
    const reg = await registry();
    expect(await reg.list()).toEqual([]);
    const demo = await copyDemoProject();
    const { project, alreadyRegistered } = await reg.add({ path: demo });
    expect(project).toEqual({ name: "demo", path: demo });
    expect(alreadyRegistered).toBe(false);
    expect(JSON.parse(await readFile(reg.file, "utf8"))).toEqual({ projects: [project] });
  });

  it("is idempotent for the same folder, even through a symlink", async () => {
    const reg = await registry();
    const demo = await copyDemoProject();
    await reg.add({ path: demo, name: "trail" });
    const link = join(await tempDir(), "link");
    await symlink(demo, link);
    const again = await reg.add({ path: link });
    expect(again).toEqual({ project: { name: "trail", path: demo }, alreadyRegistered: true });
    expect(await reg.list()).toHaveLength(1);
  });

  it("rejects relative, missing and non-directory paths", async () => {
    const reg = await registry();
    await expect(reg.add({ path: "relative/path" })).rejects.toThrow(/not an absolute path/);
    await expect(reg.add({ path: "/does/not/exist" })).rejects.toThrow(/does not exist/);
    const file = join(await tempDir(), "file.txt");
    await writeFile(file, "x");
    await expect(reg.add({ path: file })).rejects.toThrow(/not a directory/);
  });

  it("creates decisions/ only when asked", async () => {
    const reg = await registry();
    const dir = await tempDir();
    await expect(reg.add({ path: dir })).rejects.toThrow(/has no decisions\/ folder/);
    expect(await reg.list()).toEqual([]);
    await reg.add({ path: dir, createDecisions: true });
    expect((await stat(join(dir, "decisions"))).isDirectory()).toBe(true);
  });

  it("rejects duplicate and invalid names", async () => {
    const reg = await registry();
    const a = await copyDemoProject();
    const b = await copyDemoProject();
    await reg.add({ path: a });
    await expect(reg.add({ path: b })).rejects.toThrow(/already registered; choose another name/);
    await expect(reg.add({ path: b, name: "../evil" })).rejects.toThrow(/not a valid project name/);
    await reg.add({ path: b, name: "demo-2" });
    expect((await reg.list()).map((p) => p.name)).toEqual(["demo", "demo-2"]);
  });

  it("removes by name or path without touching files", async () => {
    const reg = await registry();
    const demo = await copyDemoProject();
    await reg.add({ path: demo });
    await reg.remove(demo);
    expect(await reg.list()).toEqual([]);
    await reg.add({ path: demo });
    await reg.remove("demo");
    expect(await reg.list()).toEqual([]);
    await expect(reg.remove("demo")).rejects.toThrow(/no project named "demo"/);
    expect((await stat(join(demo, "decisions", "0001-offline-storage.md"))).isFile()).toBe(true);
  });

  it("serializes concurrent adds", async () => {
    const reg = await registry();
    const dirs = await Promise.all([1, 2, 3, 4].map(() => copyDemoProject()));
    await Promise.all(dirs.map((path, i) => reg.add({ path, name: `p${i}` })));
    expect((await reg.list()).map((p) => p.name).sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("explains a corrupt registry instead of overwriting it", async () => {
    const reg = await registry();
    await mkdir(join(reg.file, ".."), { recursive: true });
    await writeFile(reg.file, "{ not json");
    await expect(reg.list()).rejects.toThrow(/is not valid JSON/);
    await writeFile(reg.file, JSON.stringify({ projects: [{ name: "x", path: "rel" }] }));
    await expect(reg.list()).rejects.toThrow(/projects\[0\]\.path: must be an absolute path/);
  });
});

describe("suggestName", () => {
  it("derives a safe name from the folder", () => {
    expect(suggestName("/home/me/My Project!")).toBe("My-Project-");
    expect(suggestName("/home/me/.hidden")).toBe("hidden");
    expect(suggestName("/")).toBe("project");
  });
});
