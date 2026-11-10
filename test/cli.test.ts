import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_FORMAT_DOC, DEMO_SOURCE, run } from "../src/cli/main.ts";
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

/**
 * Runs the `done:` command that `president pending` printed for a card file, the way an
 * agent does: the line goes through a real shell, where `president` is a function that
 * hands the words the shell made of it to the CLI.
 */
async function runDone(pendingOut: string, file: string) {
  const line = pendingOut
    .split("\n")
    .find((l) => l.trim().startsWith(`done: president `) && l.includes(basename(file)));
  if (!line) throw new Error(`no done command for ${file} in:\n${pendingOut}`);
  const script = `president() { printf '%s\\0' "$@"; }\n${line.trim().replace(/^done: /, "")}`;
  const { stdout } = await promisify(execFile)("sh", ["-c", script]);
  return cli(...stdout.split("\0").slice(0, -1));
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

  it("tries the demo on a copy, never on the tracked example", async () => {
    const scratch = await tempDir();
    vi.stubEnv("TMPDIR", scratch);
    const first = await cli("demo");
    expect(first).toMatchObject({ code: 0 });
    const copy = /to (\S+) and registered it as "demo"/.exec(first.out)?.[1] ?? "";
    expect(copy.startsWith(scratch)).toBe(true);
    expect(await readFile(join(copy, "decisions", "0002-api-errors.md"), "utf8")).toBe(
      await readFile(join(DEMO_SOURCE, "decisions", "0002-api-errors.md"), "utf8"),
    );
    // A second demo gets its own name; a folder with files in it is refused.
    const second = join(scratch, "mine");
    expect((await cli("demo", second)).out).toMatch(/registered it as "demo-2"/);
    expect(await cli("demo", second)).toMatchObject({
      code: 1,
      err: expect.stringMatching(/is not empty/),
    });
    expect((await cli("list")).out.split("\n")).toEqual([`demo\t${copy}`, `demo-2\t${second}`]);

    const tracked = await cli("add", DEMO_SOURCE, "--name", "tracked");
    expect(tracked.err).toMatch(/warning: this is president's own sample folder.*president demo/);
  });

  it("names demos under the registry lock when several start at once (R4-9)", async () => {
    const scratch = await tempDir();
    const dirs = ["d0", "d1", "d2", "d3"].map((d) => join(scratch, d));
    const results = await Promise.all(dirs.map((dir) => cli("demo", dir)));
    expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0]);
    const listed = JSON.parse((await cli("list", "--json")).out) as { name: string }[];
    expect(listed.map((p) => p.name).sort()).toEqual(["demo", "demo-2", "demo-3", "demo-4"]);
  });

  it("removes the demo copy when it can't be registered (R4-9)", async () => {
    const scratch = await tempDir();
    expect((await cli("demo", join(scratch, "first"))).code).toBe(0);
    const taken = await cli("demo", join(scratch, "second"), "--name", "demo");
    expect(taken).toMatchObject({ code: 1, err: expect.stringMatching(/already registered/) });
    await mkdir(join(scratch, "empty"));
    expect((await cli("demo", join(scratch, "empty"), "--name", "demo")).code).toBe(1);
    // A folder the demo made is gone; one that was there (empty) is left empty.
    expect((await readdir(scratch)).sort()).toEqual(["empty", "first"]);
    expect(await readdir(join(scratch, "empty"))).toEqual([]);
    vi.stubEnv("TMPDIR", join(scratch, "tmp"));
    await mkdir(join(scratch, "tmp"));
    expect((await cli("demo", "--name", "demo")).code).toBe(1);
    expect(await readdir(join(scratch, "tmp"))).toEqual([]);
    // A file in the way is refused and left alone.
    await writeFile(join(scratch, "notes.txt"), "mine");
    expect((await cli("demo", join(scratch, "notes.txt"))).err).toMatch(/is not a folder/);
    expect(await readFile(join(scratch, "notes.txt"), "utf8")).toBe("mine");
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

  it("prints a done line a shell runs as is, whatever the folder is called (R3-1)", async () => {
    // A space, a quote and characters a shell would expand or act on.
    const demo = await copyDemoProject("My Projects, Sam's $HOME `x`; app");
    const file = join(demo, "decisions", "0002-api-errors.md");
    await human(demo, "0002", { type: "note", note: "a note" });
    const shown = (await cli("pending", demo)).out;
    expect(shown).toContain(`done: president seen '${file.replaceAll("'", "'\\''")}' --token `);
    expect(await runDone(shown, file)).toMatchObject({ code: 0 });
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");
  });

  it("indents every line of a multi-line note under its card (R3-10)", async () => {
    const demo = await copyDemoProject();
    await human(demo, "0002", { type: "note", note: "First paragraph.\n\nSecond:\n- item one" });
    await human(demo, "0002", { type: "resolve", choice: "result", note: "Because\nof retries." });
    const lines = (await cli("pending", demo)).out.split("\n");
    const start = lines.findIndex((l) => l.includes("0002-api-errors.md"));
    expect(lines.slice(start + 1, start + 8)).toEqual([
      expect.stringMatching(/ -> result \(Because$/),
      "      of retries.)",
      expect.stringMatching(/^ {4}note \S+: First paragraph\.$/),
      "",
      "      Second:",
      "      - item one",
      expect.stringMatching(/^ {4}done: president applied /),
    ]);
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

  it("names a second folder with a taken name -2 and says how to choose (R3-13)", async () => {
    await cli("add", await copyDemoProject("app"));
    const second = await copyDemoProject("app");
    const added = await cli("add", second);
    expect(added).toMatchObject({ code: 0 });
    expect(added.out).toBe(
      `Registered app-2 (${second})\nAnother project is already named "app", so this one is "app-2". To choose its name: president remove app-2, then president add <path> --name <name>.`,
    );
    const taken = await cli("add", await copyDemoProject("web"), "--name", "app");
    expect(taken).toMatchObject({ code: 1, err: expect.stringMatching(/--name <name>/) });
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

  // Agents that start together each run `president add . --create`: every one of them must
  // end up registered, under its own name (R3-2, R3-13). Separate processes, so this starts
  // Node several times (see the timeout note below).
  it("registers every project when many `add`s run at once", { timeout: 20_000 }, async () => {
    const folders = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const dir = join(await tempDir(), "app");
        await mkdir(dir);
        return dir;
      }),
    );
    const results = await Promise.all(
      folders.map((dir) =>
        promisify(execFile)(process.execPath, [BIN, "add", dir, "--create"], { timeout: 18_000 }),
      ),
    );
    for (const { stdout } of results) expect(stdout).toMatch(/^Registered app(-\d+)? /);
    const listed = JSON.parse((await cli("list", "--json")).out) as {
      name: string;
      path: string;
    }[];
    expect(listed.map((p) => p.path).sort()).toEqual([...folders].sort());
    expect(listed.map((p) => p.name).sort()).toEqual(
      ["app", ...Array.from({ length: 9 }, (_, i) => `app-${i + 2}`)].sort(),
    );
  });

  // Like the test above, this starts a process. Its time is Node's own start-up, which doesn't
  // depend on our code but on how busy the machine is: on a loaded CI runner, or with
  // several suites at once, it can take many times the ~0.15 s it takes alone, so it gets
  // its own timeout instead of the 5 s meant for in-process tests.
  it("runs through the bin script", { timeout: 10_000 }, async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [BIN, "help"], {
      timeout: 9000,
    });
    expect(stdout).toMatch(/Usage:/);
  });
});
