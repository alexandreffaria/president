import { mkdir, readdir, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createFileExclusive, STALE_TEMP_MS } from "../src/server/fs-utils.ts";
import { defaultConfigDir, Registry, suggestName } from "../src/server/registry.ts";
import { copyDemoProject, tempDir } from "./helpers.ts";

/**
 * Runs once just before the next entry file is created in the registry folder `dir`: another
 * `add` getting there first. Only there: an `add` of another test still running (one that
 * timed out on a busy machine) must not take it.
 */
const race = vi.hoisted(() => ({
  before: undefined as { dir: string; run: () => Promise<void> } | undefined,
}));

vi.mock("../src/server/fs-utils.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/fs-utils.ts")>();
  const { dirname } = await import("node:path");
  return {
    ...real,
    createFileExclusive: async (path: string, content: string) => {
      const before = race.before;
      if (before?.dir === dirname(path)) {
        race.before = undefined;
        await before.run();
      }
      return real.createFileExclusive(path, content);
    },
  };
});

async function registry() {
  return new Registry(join(await tempDir(), "config"));
}

describe("defaultConfigDir", () => {
  it("uses XDG_CONFIG_HOME when it is absolute", () => {
    expect(defaultConfigDir({ XDG_CONFIG_HOME: "/x/config" })).toBe(join("/x/config", "president"));
  });
  it("falls back to ~/.config", () => {
    expect(defaultConfigDir({})).toMatch(/\.config[\\/]president$/);
    expect(defaultConfigDir({ XDG_CONFIG_HOME: "relative" })).toMatch(/\.config[\\/]president$/);
  });
});

describe("Registry", () => {
  it("starts empty and stores each project in its own file", async () => {
    const reg = await registry();
    expect(await reg.list()).toEqual([]);
    const demo = await copyDemoProject();
    const { project, alreadyRegistered } = await reg.add({ path: demo });
    expect(project).toEqual({ name: "demo", path: demo });
    expect(alreadyRegistered).toBe(false);
    expect(await readdir(reg.dir)).toEqual(["demo.json"]);
    expect(JSON.parse(await readFile(join(reg.dir, "demo.json"), "utf8"))).toEqual({ path: demo });
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

  // A relative target is named as resolved from the folder that holds the link (R9-1, R10-3).
  it("refuses a decisions link to nothing, with or without create", async () => {
    const reg = await registry();
    const dir = await tempDir();
    await symlink("gone", join(dir, "decisions"));
    const refused = `"${join(dir, "decisions")}" is a link to ${join(dir, "gone")}, which doesn't exist`;
    await expect(reg.add({ path: dir })).rejects.toThrow(refused);
    await expect(reg.add({ path: dir, createDecisions: true })).rejects.toThrow(refused);
    expect(await reg.list()).toEqual([]);
  });

  it("rejects duplicate and invalid names", async () => {
    const reg = await registry();
    const a = await copyDemoProject();
    const b = await copyDemoProject();
    await reg.add({ path: a });
    await expect(reg.add({ path: b, name: "demo" })).rejects.toThrow(
      /already registered; choose another name \(CLI: --name <name>\)/,
    );
    await expect(reg.add({ path: b, name: "../evil" })).rejects.toThrow(/not a valid project name/);
    await reg.add({ path: b, name: "other" });
    expect((await reg.list()).map((p) => p.name)).toEqual(["demo", "other"]);
  });

  it("names a folder whose name is taken with -2, -3... (R3-13)", async () => {
    const reg = await registry();
    const added = [];
    for (let i = 0; i < 3; i++) added.push(await reg.add({ path: await copyDemoProject("app") }));
    expect(added.map((r) => [r.project.name, r.renamedFrom])).toEqual([
      ["app", undefined],
      ["app-2", "app"],
      ["app-3", "app"],
    ]);
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

  it("registers every one of many concurrent adds", async () => {
    const reg = await registry();
    const dirs = await Promise.all([1, 2, 3, 4].map(() => copyDemoProject()));
    await Promise.all(dirs.map((path, i) => reg.add({ path, name: `p${i}` })));
    expect((await reg.list()).map((p) => p.name).sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("explains a corrupt entry instead of overwriting it (R6-13)", async () => {
    const reg = await registry();
    await mkdir(reg.dir, { recursive: true });
    const file = join(reg.dir, "x.json");
    await writeFile(file, "{ not json");
    await expect(reg.list()).rejects.toThrow(/x\.json is not valid JSON/);
    await writeFile(file, JSON.stringify({ path: "rel" }));
    await expect(reg.list()).rejects.toThrow(
      /x\.json is invalid: path: must be an absolute path\. Fix or delete this file; it registers one project\.$/,
    );
    await writeFile(join(reg.dir, "-bad.json"), JSON.stringify({ path: "/" }));
    await expect(reg.list()).rejects.toThrow(/"-bad" is not a valid project name/);
    expect(await readFile(file, "utf8")).toBe(JSON.stringify({ path: "rel" }));
  });

  it("ignores temp files and removes ones left by a crash", async () => {
    const reg = await registry();
    await mkdir(reg.dir, { recursive: true });
    const fresh = join(reg.dir, ".app.json.123.abcd.tmp");
    const stale = join(reg.dir, ".web.json.456.ef01.tmp");
    await writeFile(fresh, "{");
    await writeFile(stale, "{");
    const old = new Date(Date.now() - STALE_TEMP_MS - 1000);
    await utimes(stale, old, old);
    expect(await reg.list()).toEqual([]);
    await reg.add({ path: await copyDemoProject() });
    expect((await readdir(reg.dir)).sort()).toEqual([".app.json.123.abcd.tmp", "demo.json"]);
  });

  // The entries are written directly, in no particular order: 11 adds, each copying a
  // project and syncing its entry to disk, took over 5 s on a busy machine. How adds pick
  // "-2", "-3"... is tested above (R3-13).
  it("orders projects by name, -2 before -10", async () => {
    const reg = await registry();
    await mkdir(reg.dir, { recursive: true });
    const root = await tempDir();
    const names = ["app", ...Array.from({ length: 10 }, (_, i) => `app-${i + 2}`)];
    for (const name of [...names].sort().reverse()) {
      await mkdir(join(root, name));
      await writeFile(join(reg.dir, `${name}.json`), JSON.stringify({ path: join(root, name) }));
    }
    expect((await reg.list()).map((p) => p.name)).toEqual(names);
  });

  it("names the same folder once when it is added under two names at once", async () => {
    const reg = await registry();
    const demo = await copyDemoProject();
    // What two racing `add`s can leave before either sees the other.
    await mkdir(reg.dir, { recursive: true });
    await writeFile(join(reg.dir, "zeta.json"), JSON.stringify({ path: demo }));
    await writeFile(join(reg.dir, "alpha.json"), JSON.stringify({ path: demo }));
    expect(await reg.list()).toEqual([{ name: "alpha", path: demo }]);
    expect(await reg.add({ path: demo })).toEqual({
      project: { name: "alpha", path: demo },
      alreadyRegistered: true,
    });
    // remove takes every file of the folder, under either name.
    await reg.remove("zeta");
    expect(await readdir(reg.dir)).toEqual([]);
  });

  it("settles adds of one folder that race: one entry, the others give way", async () => {
    const reg = await registry();
    const demo = await copyDemoProject();
    const again = () => new Registry(join(reg.dir, ".."));
    // The usual case, every agent of a project at once: all of them agree on the name.
    const same = await Promise.all(Array.from({ length: 6 }, () => again().add({ path: demo })));
    expect(new Set(same.map((r) => r.project.name))).toEqual(new Set(["demo"]));
    expect(same.filter((r) => !r.alreadyRegistered)).toHaveLength(1);
    expect(await readdir(reg.dir)).toEqual(["demo.json"]);
    // With different names given at once, the folder still ends up registered once, under
    // the name that sorts first (an add that ran before it existed may have printed its own).
    await reg.remove("demo");
    await Promise.all(["c", "a", "b"].map((name) => again().add({ path: demo, name })));
    const listed = await reg.list();
    expect(listed).toEqual([{ name: expect.stringMatching(/^[abc]$/), path: demo }]);
    expect(await readdir(reg.dir)).toEqual([`${listed[0]?.name}.json`]);
  });

  // Two `add`s of one folder under two names, each creating its file before it sees the
  // other's: whichever runs second removes the duplicate, the winner or the loser (R6-15).
  it("removes its own entry when a twin that sorts first appeared meanwhile", async () => {
    const reg = await registry();
    const demo = await copyDemoProject();
    race.before = {
      dir: reg.dir,
      run: () => writeFile(join(reg.dir, "alpha.json"), JSON.stringify({ path: demo })),
    };
    expect(await reg.add({ path: demo, name: "zeta" })).toEqual({
      project: { name: "alpha", path: demo },
      alreadyRegistered: true,
    });
    expect(await readdir(reg.dir)).toEqual(["alpha.json"]);
  });

  it("removes a twin that sorts after it when it appeared meanwhile", async () => {
    const reg = await registry();
    const demo = await copyDemoProject();
    race.before = {
      dir: reg.dir,
      run: () => writeFile(join(reg.dir, "zeta.json"), JSON.stringify({ path: demo })),
    };
    expect(await reg.add({ path: demo, name: "alpha" })).toEqual({
      project: { name: "alpha", path: demo },
      alreadyRegistered: false,
    });
    expect(await readdir(reg.dir)).toEqual(["alpha.json"]);
  });

  it("creates an entry exclusively, whole or not at all", async () => {
    const dir = await tempDir();
    const file = join(dir, "app.json");
    const created = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createFileExclusive(file, `{"n":${i}}`)),
    );
    expect(created.filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ n: created.indexOf(true) });
    expect(await readdir(dir)).toEqual(["app.json"]);
  });

  it("moves an old projects.json into one file per project, once", async () => {
    const reg = await registry();
    const [a, b] = [await copyDemoProject("a"), await copyDemoProject("b")];
    await mkdir(join(reg.dir, ".."), { recursive: true });
    await writeFile(
      reg.legacyFile,
      JSON.stringify({
        projects: [
          { name: "first", path: a },
          { name: "second", path: b },
        ],
      }),
    );
    // Two processes that start at once both migrate; neither loses or doubles a project.
    const [one, two] = await Promise.all([reg.list(), new Registry(join(reg.dir, "..")).list()]);
    const expected = [
      { name: "first", path: a },
      { name: "second", path: b },
    ];
    expect(one).toEqual(expected);
    expect(two).toEqual(expected);
    expect((await readdir(join(reg.dir, ".."))).sort()).toEqual([
      "projects",
      "projects.json.migrated",
    ]);
    await reg.remove("first");
    expect(await new Registry(join(reg.dir, "..")).list()).toEqual([expected[1]]);
  });

  it("explains an old projects.json it can't read instead of dropping it (R6-13)", async () => {
    const reg = await registry();
    await mkdir(join(reg.dir, ".."), { recursive: true });
    await writeFile(reg.legacyFile, JSON.stringify({ projects: [{ name: "x", path: "rel" }] }));
    await expect(reg.list()).rejects.toThrow(
      /projects\.json is invalid: projects\[0\]\.path: must be an absolute path\. Fix it; president moves it into projects\/ once it can read it\.$/,
    );
    expect(await readdir(join(reg.dir, ".."))).toEqual(["projects.json"]);
  });
});

describe("suggestName", () => {
  it("derives a safe name from the folder", () => {
    expect(suggestName("/home/me/My Project!")).toBe("My-Project-");
    expect(suggestName("/home/me/.hidden")).toBe("hidden");
    expect(suggestName("/")).toBe("project");
  });
});
