import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_FORMAT_DOC, run } from "../src/cli/main.ts";
import type { CardAction } from "../src/core/actions.ts";
import { actOnCard, findCard } from "../src/server/cards.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

const BIN = join(import.meta.dirname, "..", "bin", "president.js");

async function cli(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, { log: (l) => stdout.push(l), error: (l) => stderr.push(l) });
  return { code, out: stdout.join("\n"), err: stderr.join("\n") };
}

/** Runs the `done:` command that `president pending` printed for a card file. */
async function runDone(pendingOut: string, file: string) {
  const line = pendingOut
    .split("\n")
    .find((l) => l.trim().startsWith(`done: president `) && l.includes(file));
  if (!line) throw new Error(`no done command for ${file} in:\n${pendingOut}`);
  const [, ...args] = line
    .trim()
    .replace(/^done: /, "")
    .split(" ");
  return cli(...args);
}

/** Acts on a card the way the UI does (with the revision it has now). */
async function human(demo: string, id: string, action: CardAction) {
  const project = { name: "demo", path: demo };
  const found = await findCard(project, id);
  if (!found.ok) throw new Error("broken");
  return actOnCard(project, id, action, { revision: found.card.revision });
}

let configHome: string;
beforeEach(async () => {
  configHome = await tempDir();
  vi.stubEnv("XDG_CONFIG_HOME", configHome);
});
afterEach(() => {
  vi.unstubAllEnvs();
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
    expect(result.out).toContain(`Format: ${CARD_FORMAT_DOC}`);
  });

  it("points at the card format spec by absolute path", async () => {
    expect(CARD_FORMAT_DOC).toMatch(/^\/.*\/docs\/card-format\.md$/);
    expect(await readFile(CARD_FORMAT_DOC, "utf8")).toMatch(/^# Decision card format/);
  });

  it("validates a single card file", async () => {
    const demo = await copyDemoProject();
    const good = await cli("validate", join(demo, "decisions", "0002-api-errors.md"));
    expect(good).toMatchObject({ code: 0 });
    expect(good.out).toMatch(/^ok {6}0002-api-errors\.md/);
    const bad = join(demo, "decisions", "0009-bad.md");
    await writeFile(bad, cardText({ id: '"0009"', status: "maybe" }));
    const result = await cli("validate", bad);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/broken {2}0009-bad\.md\n\s+- status: Invalid option/);
    expect(result.out).not.toMatch(/0002/);
    // Outside a decisions/ folder the file is checked on its own.
    const loose = join(await tempDir(), "0001-loose.md");
    await writeFile(loose, cardText());
    expect(await cli("validate", loose)).toMatchObject({ code: 0 });
    expect((await cli("validate", join(demo, "decisions", "README.md"))).code).toBe(1);
    const missing = join(demo, "decisions", "0099-missing.md");
    expect(await cli("validate", missing)).toMatchObject({
      code: 1,
      err: `president: "${missing}" does not exist`,
    });
  });

  it("warns about depends_on ids that are not cards", async () => {
    const demo = await copyDemoProject();
    await writeFile(
      join(demo, "decisions", "0009-deps.md"),
      cardText({ id: '"0009"', depends_on: '["0002", "9999", "0009"]' }),
    );
    const result = await cli("validate", demo);
    expect(result.code).toBe(0);
    expect(result.err).toContain(
      'warning 0009-deps.md: depends_on "9999" is not a card in this project',
    );
    expect(result.err).toContain("warning 0009-deps.md: depends_on lists itself");
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

    const listed = (await cli("pending", demo)).out;
    const token = JSON.parse(pending.out).resolved_not_applied[0].token;
    expect(listed).toContain(`done: president applied ${file} --token ${token}`);
    const applied = await runDone(listed, file);
    expect(applied).toMatchObject({ code: 0 });
    const text = await readFile(file, "utf8");
    expect(text).toMatch(/^applied_at: \d{4}-/m);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");

    // Applying twice changes nothing.
    const twice = await cli("applied", file, "--token", token);
    expect(twice).toMatchObject({ code: 0, out: expect.stringMatching(/already applied at/) });
    expect(await readFile(file, "utf8")).toBe(text);

    const openFile = join(demo, "decisions", "0002-api-errors.md");
    const open = await cli("applied", openFile, "--token", "0-aaaaaaaaaaa");
    expect(open).toMatchObject({ code: 1 });
    expect(open.err).toMatch(/is now open/);
  });

  it("only marks the card file it was given", async () => {
    const demo = await copyDemoProject();
    const token = ["--token", "0-aaaaaaaaaaa"];
    const wrongSlug = await cli("applied", join(demo, "decisions", "0004-other-slug.md"), ...token);
    expect(wrongSlug).toMatchObject({ code: 1, err: expect.stringMatching(/does not exist/) });
    await writeFile(join(demo, "decisions", "0004-copy.md"), "x");
    const other = await cli("applied", join(demo, "decisions", "0004-copy.md"), ...token);
    expect(other.code).toBe(1);
  });

  it("lists new notes from the human until an agent marks them seen", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text.replace(
        "depends_on: []",
        "depends_on: []\nfeedback:\n  - at: 2026-11-10T09:00:00Z\n    type: note\n    note: Ask Sam about retries.",
      ),
    );
    const listed = await cli("pending", demo);
    expect(listed.out).toMatch(/New notes from the human/);
    expect(listed.out).toContain("note 2026-11-10T09:00:00Z: Ask Sam about retries.");
    const json = JSON.parse((await cli("pending", demo, "--json")).out);
    expect(json.new_notes).toMatchObject([
      { id: "0002", status: "open", new_notes: [{ note: "Ask Sam about retries." }] },
    ]);

    expect(await runDone(listed.out, file)).toMatchObject({ code: 0 });
    expect(await readFile(file, "utf8")).toMatch(/^seen_at: 2026-11-10T09:00:00Z$/m);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");
  });

  it("flags a card that was reopened and decided again", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0004-map-tiles.md");
    const { actOnCard, findCard } = await import("../src/server/cards.ts");
    const project = { name: "demo", path: demo };
    const step = async (action: Parameters<typeof actOnCard>[2]) => {
      const found = await findCard(project, "0004");
      if (!found.ok) throw new Error("broken");
      await actOnCard(project, "0004", action, { revision: found.card.revision });
    };
    await step({ type: "reopen", note: "Costs changed." });
    const reopened = await cli("pending", demo);
    expect(reopened.out).toMatch(/New notes from the human/);
    expect(reopened.out).toMatch(/reopen .*Reopened; it was resolved as "protomaps"/);
    await step({ type: "resolve", choice: "maptiler" });
    const again = await cli("pending", demo);
    expect(again.out).toContain(file);
    expect(again.out).toMatch(
      /Decided again: it was "protomaps" before, applied at 2026-11-03T16:45:00Z\. Replace the earlier record/,
    );
    expect(again.out).not.toMatch(/New notes/);
    const json = JSON.parse((await cli("pending", demo, "--json")).out);
    expect(json.resolved_not_applied[0]).toMatchObject({
      previous_resolution: { choice: "protomaps" },
      previous_applied_at: "2026-11-03T16:45:00Z",
    });
  });

  it("requires the token that pending printed", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const result = await cli("seen", file);
    expect(result).toMatchObject({ code: 1 });
    expect(result.err).toMatch(/--token is required: run `president pending`/);
  });

  it("never marks a note as read that pending didn't show (R2-1)", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    await human(demo, "0002", { type: "note", note: "first note" });
    const shown = (await cli("pending", demo)).out;
    expect(shown).toContain("first note");
    // The human adds a note while the agent is working on the first one.
    await human(demo, "0002", { type: "note", note: "SECOND note, never shown" });
    const done = await runDone(shown, file);
    expect(done).toMatchObject({ code: 0 });
    expect(done.out).toMatch(/added 1 more note since you ran `president pending`/);
    const after = await cli("pending", demo);
    expect(after.out).toContain("SECOND note, never shown");
    expect(after.out).not.toContain("first note");
  });

  it("refuses to mark a decision applied when the human changed it (R2-2)", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    await human(demo, "0002", { type: "resolve", choice: "throw" });
    const shown = (await cli("pending", demo)).out;
    expect(shown).toContain("-> throw");
    // While the agent applies "throw", the human reopens the card and picks "result".
    await human(demo, "0002", { type: "reopen" });
    await human(demo, "0002", { type: "resolve", choice: "result" });
    const before = await readFile(file, "utf8");
    const refused = await runDone(shown, file);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/now resolved as "result".*Run `president pending` again/s);
    expect(await readFile(file, "utf8")).toBe(before);
    const again = await cli("pending", demo);
    expect(again.out).toMatch(/-> result/);
    expect((await runDone(again.out, file)).code).toBe(0);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");
  });

  it("shows every unread note, whatever section the card is in (R2-4)", async () => {
    const demo = await copyDemoProject();
    await human(demo, "0002", { type: "neither", note: "both assume a server" });
    await human(demo, "0002", { type: "note", note: "ALSO: look at how Linear does it" });
    const rejected = (await cli("pending", demo)).out;
    expect(rejected).toContain("both assume a server");
    expect(rejected).toContain("ALSO: look at how Linear does it");
    expect(rejected).toMatch(/remove `needs_new_options`/);

    const other = await copyDemoProject();
    await human(other, "0002", { type: "note", note: "ALSO rename the error type to ApiFailure" });
    await human(other, "0002", { type: "resolve", choice: "result" });
    const text = (await cli("pending", other)).out;
    expect(text).toMatch(/-> result/);
    expect(text).toContain("ApiFailure");
    const json = JSON.parse((await cli("pending", other, "--json")).out);
    expect(json.resolved_not_applied[0].new_notes).toMatchObject([
      { note: "ALSO rename the error type to ApiFailure" },
    ]);
    // Applying marks the note read too.
    expect((await runDone(text, join(other, "decisions", "0002-api-errors.md"))).code).toBe(0);
    expect((await cli("pending", other)).out).toBe("Nothing pending.");
  });

  it("warns when seen leaves needs_new_options set (R2-16)", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    await human(demo, "0002", { type: "neither", note: "both bad" });
    const shown = (await cli("pending", demo)).out;
    const done = await runDone(shown, file);
    expect(done.code).toBe(0);
    expect(done.err).toMatch(/needs_new_options is still set/);
    const still = (await cli("pending", demo)).out;
    expect(still).toMatch(/needs_new_options` is still set/);
    expect(still).toContain("both bad");
  });

  it("warns when --name is ignored for a registered folder", async () => {
    const demo = await copyDemoProject();
    await cli("add", demo);
    const again = await cli("add", demo, "--name", "other");
    expect(again.code).toBe(0);
    expect(again.err).toMatch(/--name ignored: this folder is already registered as "demo"/);
  });

  it("treats . and .. as paths when removing", async () => {
    const demo = await copyDemoProject();
    await cli("add", demo);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(join(demo, "decisions"));
    try {
      expect(await cli("remove", "..")).toMatchObject({
        code: 0,
        out: expect.stringMatching(/^Removed demo/),
      });
      expect(await cli("remove", "..")).toMatchObject({
        code: 1,
        err: `president: no project at "${demo}"`,
      });
    } finally {
      cwd.mockRestore();
    }
  });

  it("explains an invalid registry instead of crashing", async () => {
    await mkdir(join(configHome, "president"), { recursive: true });
    await writeFile(
      join(configHome, "president", "projects.json"),
      JSON.stringify({ projects: [{ name: "bad name", path: "/tmp" }] }),
    );
    const result = await cli("list");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^president: .*projects\.json is invalid: projects\[0\]\.name/);
  });

  it.skipIf(process.getuid?.() === 0)("explains a folder it may not create", async () => {
    const dir = await tempDir();
    await chmod(dir, 0o500);
    try {
      const result = await cli("add", dir, "--create");
      expect(result.code).toBe(1);
      expect(result.err).toBe(
        `president: cannot create ${join(dir, "decisions")}: permission denied`,
      );
    } finally {
      await chmod(dir, 0o700);
    }
  });

  it("says when the port is busy instead of printing a stack trace", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const address = blocker.address();
    vi.stubEnv("PRESIDENT_PORT", String(typeof address === "object" && address?.port));
    try {
      const result = await cli("serve");
      expect(result.code).toBe(1);
      expect(result.err).toMatch(/^president: the port is already in use/);
    } finally {
      blocker.close();
    }
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
