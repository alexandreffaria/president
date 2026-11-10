import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/main.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

const BIN = join(import.meta.dirname, "..", "bin", "president.js");

async function cli(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, { log: (l) => stdout.push(l), error: (l) => stderr.push(l) });
  return { code, out: stdout.join("\n"), err: stderr.join("\n") };
}

beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await tempDir();
});

describe("president CLI", () => {
  it("adds, lists and removes projects", async () => {
    const demo = await copyDemoProject();
    expect(await cli("add", demo)).toMatchObject({ code: 0, out: `Registered demo (${demo})` });
    expect(await cli("add", demo)).toMatchObject({
      code: 0,
      out: `Already registered: demo (${demo})`,
    });
    expect((await cli("list")).out).toBe(`demo\t${demo}`);
    expect(JSON.parse((await cli("list", "--json")).out)).toEqual([{ name: "demo", path: demo }]);
    expect((await cli("remove", "demo")).code).toBe(0);
    expect((await cli("list")).out).toMatch(/No projects registered/);
  });

  it("needs --create for a folder without decisions/", async () => {
    const dir = await tempDir();
    const first = await cli("add", dir);
    expect(first.code).toBe(1);
    expect(first.err).toMatch(/has no decisions\/ folder/);
    expect((await cli("add", dir, "--create", "--name", "fresh")).out).toMatch(/Registered fresh/);
  });

  it("validates cards and fails on broken ones", async () => {
    const demo = await copyDemoProject();
    expect((await cli("validate", demo)).code).toBe(0);
    await writeFile(
      join(demo, "decisions", "0009-bad.md"),
      cardText({ id: '"0009"', status: "maybe" }),
    );
    const result = await cli("validate", join(demo, "decisions"));
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/broken {2}0009-bad\.md\n\s+- status: Invalid option/);
    expect(result.out).toMatch(/4 valid, 1 broken/);
  });

  it("lists pending work and marks cards applied", async () => {
    const demo = await copyDemoProject();
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");

    const file = join(demo, "decisions", "0004-map-tiles.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/^applied_at:.*\n/m, ""));
    const pending = await cli("pending", demo, "--json");
    expect(JSON.parse(pending.out).resolved_not_applied).toMatchObject([
      { id: "0004", path: file, resolution: { choice: "protomaps" } },
    ]);
    expect((await cli("pending", demo)).out).toMatch(/Resolved, not yet applied/);

    const applied = await cli("applied", file);
    expect(applied).toMatchObject({ code: 0 });
    expect(await readFile(file, "utf8")).toMatch(/^applied_at: \d{4}-/m);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");

    const again = await cli("applied", join(demo, "decisions", "0002-api-errors.md"));
    expect(again).toMatchObject({ code: 1 });
    expect(again.err).toMatch(/cannot mark a card as applied while it is open/);
  });

  it("explains unknown commands and bad arguments", async () => {
    expect((await cli("frobnicate")).code).toBe(2);
    expect((await cli("add")).err).toMatch(/usage: president add <path>/);
    expect((await cli("list", "--bogus")).code).toBe(1);
    expect((await cli("help")).out).toMatch(/president add <path>/);
  });

  it("runs through the bin script", async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [BIN, "help"]);
    expect(stdout).toMatch(/Usage:/);
  });
});
