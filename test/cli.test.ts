import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_FORMAT_DOC, DEMO_SOURCE, run } from "../src/cli/main.ts";
import type { CardAction } from "../src/core/actions.ts";
import { actOnCard, findCard, undoLastAction } from "../src/server/cards.ts";
import type { Project } from "../src/server/registry.ts";
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

  it("lists a project whose folder or decisions/ is gone as missing (R5-21)", async () => {
    const kept = await copyDemoProject("a");
    const noCards = await copyDemoProject("b");
    const gone = await copyDemoProject("c");
    for (const dir of [kept, noCards, gone]) await cli("add", dir);
    await rm(join(noCards, "decisions"), { recursive: true });
    await rm(gone, { recursive: true });
    expect((await cli("list")).out.split("\n")).toEqual([
      `a\t${kept}`,
      `b\t${noCards}\t(decisions/ folder missing)`,
      `c\t${gone}\t(folder missing)`,
      "A project is its folder: if one moved, run president remove <name>, then president add <new path>.",
    ]);
    expect(JSON.parse((await cli("list", "--json")).out)).toEqual([
      { name: "a", path: kept },
      { name: "b", path: noCards, missing: "decisions/ folder" },
      { name: "c", path: gone, missing: "folder" },
    ]);
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

  it("names demos that start at once each their own way (R4-9)", async () => {
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
      'warning 0009-deps.md: depends_on "9999" is not a card in this project (line 14)',
    );
    expect(result.err).toContain("warning 0009-deps.md: depends_on lists itself (line 14)");
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
    // The card is its id, so a name with another slug finds it, and the token still decides.
    expect(wrongSlug).toMatchObject({
      code: 1,
      err: expect.stringMatching(/is now 0004-map-tiles\.md[\s\S]*changed since/),
    });
    const noCard = await cli("applied", join(demo, "decisions", "0042-nothing.md"), ...token);
    expect(noCard).toMatchObject({
      code: 1,
      err: expect.stringMatching(/0042-nothing\.md" does not exist/),
    });
    await writeFile(join(demo, "decisions", "0004-copy.md"), "x");
    const other = await cli("applied", join(demo, "decisions", "0004-copy.md"), ...token);
    expect(other.code).toBe(1);
  });

  it("runs a done line after the agent renamed the card (R5-11)", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    await human(demo, "0002", { type: "note", note: "Rename it if you like." });
    const shown = (await cli("pending", demo)).out;
    const renamed = join(demo, "decisions", "0002-error-shape.md");
    await rename(file, renamed);
    const done = await runDone(shown, file);
    expect(done.code).toBe(0);
    expect(done.err).toBe(
      "president: note: card 0002 is now 0002-error-shape.md (renamed since); using that file",
    );
    expect(done.out).toMatch(/^Marked the human's feedback on 0002-error-shape\.md as read/);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");
  });

  describe("update (R5-2)", () => {
    /** The agent's rewrite: the card as it read it, with new options and no needs_new_options. */
    const rewrite = (card: string) =>
      card
        .replace("id: throw\n    title: Throw typed errors", "id: either\n    title: Return Either")
        .replace(/^needs_new_options: true\n/m, "")
        .replace("option: result", "option: either")
        .replace("## Option throw", "## Option either");

    it("replaces the card with the agent's rewrite when the human changed nothing", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "neither", note: "both assume a server" });
      const shown = (await cli("pending", demo)).out;
      const mine = join(demo, "decisions", ".0002.new.md");
      const rewritten = rewrite(await readFile(file, "utf8"));
      await writeFile(mine, rewritten);
      expect(await cli("update", file, mine)).toEqual({
        code: 0,
        out: "Updated 0002-api-errors.md (and removed .0002.new.md).",
        err: "",
      });
      expect(await readFile(file, "utf8")).toBe(rewritten);
      expect(await readdir(join(demo, "decisions"))).not.toContain(".0002.new.md");
      // The done line pending printed still works: the feedback is what it showed.
      expect((await runDone(shown, file)).code).toBe(0);
      expect((await cli("pending", demo)).out).toBe("Nothing pending.");
    });

    it("refuses, and keeps the human's note, when it arrived after the agent read the card", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "neither", note: "both assume a server" });
      const shown = (await cli("pending", demo)).out;
      const read = await readFile(file, "utf8");
      await human(demo, "0002", { type: "note", note: "Actually two words is fine too." });
      const withNote = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, rewrite(read));
      const refused = await cli("update", file, mine);
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(
        /^president: 0002-api-errors\.md was not changed: what the human owns differs[\s\S]*Read the card again[\s\S]*\n {2}- feedback: the human added 1 entry since you read the card:\n {2}- {3}note \S+: Actually two words is fine too\./,
      );
      expect(await readFile(file, "utf8")).toBe(withNote);
      expect(await readFile(mine, "utf8")).toBe(rewrite(read));
      // The note is still unread, and the old done line can't mark it read.
      expect((await runDone(shown, file)).out).toMatch(/1 more note since/);
      expect((await cli("pending", demo)).out).toContain("Actually two words is fine too.");
      // Made again from the card as it is now, the rewrite goes through.
      await writeFile(mine, rewrite(await readFile(file, "utf8")));
      expect((await cli("update", file, mine)).code).toBe(0);
      expect(await readFile(file, "utf8")).toContain("Actually two words is fine too.");
    });

    it("refuses a version that changes the decision, or one that is broken", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      const before = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, before.replace("status: open", "status: deferred"));
      expect((await cli("update", file, mine)).err).toMatch(
        /- status: the card has "open", your version "deferred"/,
      );
      await human(demo, "0002", { type: "resolve", choice: "result" });
      const resolved = await readFile(file, "utf8");
      await writeFile(mine, before);
      const err = (await cli("update", file, mine)).err;
      expect(err).toMatch(/- status: the card has "resolved", your version "open"/);
      expect(err).toMatch(/- resolution: the card has a decision \("result"\), your version none/);
      await writeFile(mine, resolved.replace("kind: ab", "kind: maybe"));
      const broken = await cli("update", file, mine);
      expect(broken.code).toBe(1);
      expect(broken.err).toMatch(
        /broken {2}0002-api-errors\.md\n\s+- kind: Invalid option[\s\S]*was not changed/,
      );
      expect(await readFile(file, "utf8")).toBe(resolved);
      expect((await cli("update", file, file)).err).toMatch(/as a separate file/);
      expect((await cli("update", file)).err).toMatch(
        /usage: president update <card-file> <new-version-file>/,
      );
    });
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
      /Decided again: it was "protomaps" \("Cost and offline-friendliness matter most\. We can switch styles later\."\) before, applied at 2026-11-03T16:45:00Z\. Replace the earlier record/,
    );
    expect(again.out).not.toMatch(/New notes/);
    const json = JSON.parse((await cli("pending", demo, "--json")).out);
    expect(json.resolved_not_applied[0]).toMatchObject({
      previous_resolution: { choice: "protomaps" },
      previous_applied_at: "2026-11-03T16:45:00Z",
    });
    // A custom answer is shown too, so the agent knows which record to replace (R5-15).
    expect((await runDone(again.out, file)).code).toBe(0);
    await step({ type: "reopen" });
    await step({ type: "resolve", choice: "custom", note: "Self-host tiles.\nOn our own server." });
    await runDone((await cli("pending", demo)).out, file);
    await step({ type: "reopen" });
    await step({ type: "resolve", choice: "protomaps" });
    expect((await cli("pending", demo)).out).toContain(
      'Decided again: it was custom ("Self-host tiles.\\nOn our own server.") before, applied at',
    );
  });

  it("tells the agent to revert a decision the human took back (R5-10)", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const decided = await human(demo, "0002", { type: "resolve", choice: "result" });
    const shown = (await cli("pending", demo)).out;
    expect(shown).toMatch(/Resolved, not yet applied[\s\S]*-> result/);
    // The agent records the decision and does the work; meanwhile the human clicks Undo.
    await undoLastAction({ name: "demo", path: demo }, "0002", decided.revision);
    const refused = await runDone(shown, file);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(
      /it is now open[\s\S]*If the decision pending showed you is no longer the card's \(it was taken back, reopened or changed\), revert what you recorded in the docs and changed for it\./,
    );
    // However late the agent looks, pending still says so.
    const later = (await cli("pending", demo)).out;
    expect(later).toMatch(
      /New notes from the human[\s\S]*undo \S+: Took back the decision "result"[\s\S]*\n {4}The human took back this decision\. If you recorded it in the docs or changed code for it, revert that, then run the done line\./,
    );
    expect((await runDone(later, file)).code).toBe(0);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");
  });

  it("says to wait for a new decision after a reopen alone (R5-17)", async () => {
    const demo = await copyDemoProject();
    await human(demo, "0004", { type: "reopen", note: "Costs changed." });
    expect((await cli("pending", demo)).out).toContain(
      '    Reopened, not decided again yet: don\'t change the docs or code for it now. Run the done line; when the human decides again, pending says "Decided again".',
    );
  });

  it("counts only the entries seen marks as newly read (R5-16)", async () => {
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    await human(demo, "0002", { type: "note", note: "first" });
    await runDone((await cli("pending", demo)).out, file);
    await human(demo, "0002", { type: "note", note: "second" });
    const shown = (await cli("pending", demo)).out;
    expect((await runDone(shown, file)).out).toBe(
      "Marked the human's feedback on 0002-api-errors.md as read (1 new entry).",
    );
    expect((await runDone(shown, file)).out).toBe(
      "Nothing new to mark as read on 0002-api-errors.md; the feedback pending showed was already read.",
    );
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

  it("says on both streams when --name is ignored for a registered folder (R5-20)", async () => {
    const demo = await copyDemoProject();
    await cli("add", demo);
    const again = await cli("add", demo, "--name", "other");
    expect(again.code).toBe(0);
    expect(again.out).toBe(`Already registered: demo (${demo}), not as "other"`);
    expect(again.err).toMatch(/--name ignored: this folder is already registered as "demo"/);
  });

  it("finds the project from a subfolder and says when it isn't registered (R5-12)", async () => {
    const repo = await copyDemoProject("trips");
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "src", "ui"), { recursive: true });
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(join(repo, "src", "ui"));
    try {
      const unregistered = await cli("pending");
      expect(unregistered).toMatchObject({ code: 0, out: "Nothing pending." });
      expect(unregistered.err).toContain(`president: note: using the project at ${repo}`);
      expect(unregistered.err).toContain(
        `president: note: ${repo} is not registered with the hub, so the human doesn't see its cards. Register it: president add ${repo}`,
      );
      expect((await cli("validate")).out).toContain(`in ${join(repo, "decisions")}`);
      // add . from a subfolder registers the project, not the subfolder.
      const added = await cli("add", ".", "--create");
      expect(added.out).toBe(`Registered trips (${repo})`);
      expect(added.err).toMatch(
        /note: registering .*trips, the nearest folder above .*ui with a decisions\/ folder/,
      );
      expect((await readdir(join(repo, "src", "ui"))).includes("decisions")).toBe(false);
      const registered = await cli("pending");
      expect(registered.err).not.toMatch(/not registered/);
      expect((await cli("validate", join(repo, "decisions", "0002-api-errors.md"))).err).toBe("");
    } finally {
      cwd.mockRestore();
    }
  });

  it("registers a repository's root from a subfolder without decisions/ (R5-12)", async () => {
    const repo = join(await tempDir(), "shop");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, "src"));
    const added = await cli("add", join(repo, "src"), "--create");
    expect(added.out).toBe(`Registered shop (${repo})`);
    expect(added.err).toMatch(/note: registering .*shop, the root of the git repository/);
    // A part of a monorepo is its own project once it has decisions/.
    await mkdir(join(repo, "web", "decisions"), { recursive: true });
    expect((await cli("add", join(repo, "web"), "--name", "shop-web")).out).toBe(
      `Registered shop-web (${join(repo, "web")})`,
    );
  });

  it("says where to find or create decisions/ when there is none (R5-12)", async () => {
    const repo = join(await tempDir(), "app");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, "src"));
    for (const command of ["pending", "validate"]) {
      const result = await cli(command, join(repo, "src"));
      expect(result.code).toBe(1);
      expect(result.err).toBe(
        `president: there is no decisions/ folder in ${join(repo, "src")} or its parents (up to the repository root, ${repo}). Run this in the project's folder, or create one and register the project: president add ${repo} --create`,
      );
    }
    const loose = await tempDir();
    expect((await cli("pending", loose)).err).toBe(
      `president: there is no decisions/ folder in ${loose}. Run this in the project's folder, or create one and register the project: president add ${loose} --create`,
    );
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
    await mkdir(join(configHome, "president", "projects"), { recursive: true });
    await writeFile(join(configHome, "president", "projects", "bad name.json"), "{}");
    const result = await cli("list");
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^president: .*"bad name" is not a valid project name/);
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
  // end up registered, under its own name (R3-2, R3-13), with no lock (R5-3): each name is
  // claimed by creating its file exclusively. Separate processes, so these start Node many
  // times (see the timeout note below); not more than 12 at once, so that four suites run
  // side by side don't starve each other's timed tests.
  const president = (...args: string[]) =>
    promisify(execFile)(process.execPath, [BIN, ...args], { timeout: 18_000 });

  it("registers every project when many `add`s run at once", { timeout: 20_000 }, async () => {
    const folders = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const dir = join(await tempDir(), "app");
        await mkdir(dir);
        return dir;
      }),
    );
    const shared = await copyDemoProject("shared");
    const results = await Promise.all([
      ...folders.map((dir) => president("add", dir, "--create")),
      // Two agents of one project at once register it once.
      president("add", shared),
      president("add", shared),
    ]);
    for (const { stdout } of results.slice(0, 10)) {
      expect(stdout).toMatch(/^Registered app(-\d+)? /);
    }
    for (const { stdout } of results.slice(10)) {
      expect(stdout).toMatch(/^(Registered|Already registered:) shared /);
    }
    const listed = JSON.parse((await cli("list", "--json")).out) as Project[];
    expect(listed.map((p) => p.path).sort()).toEqual([...folders, shared].sort());
    expect(listed.map((p) => p.name)).toEqual([
      "app",
      ...Array.from({ length: 9 }, (_, i) => `app-${i + 2}`),
      "shared",
    ]);
    expect(await readdir(join(configHome, "president", "projects"))).toHaveLength(11);
  });

  it("names every demo when many `demo`s run at once", { timeout: 20_000 }, async () => {
    const scratch = await tempDir();
    const demos = Array.from({ length: 5 }, (_, i) => join(scratch, `d${i}`));
    const results = await Promise.all(demos.map((dir) => president("demo", dir)));
    const listed = JSON.parse((await cli("list", "--json")).out) as Project[];
    expect(listed.map((p) => p.path).sort()).toEqual(demos.sort());
    const names = ["demo", ...Array.from({ length: 4 }, (_, i) => `demo-${i + 2}`)];
    expect(listed.map((p) => p.name)).toEqual(names);
    // Each demo printed the name it got.
    const printed = results.map((r) => /registered it as "([^"]+)"/.exec(r.stdout)?.[1]);
    expect(printed.sort()).toEqual([...names].sort());
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

  // Before 24.9 the server's shouldUpgradeCallback is ignored without a word (R6-14), so
  // every entry point refuses an older Node: the CLI, and the hub as `npm start` and
  // `npm run dev` run it.
  it("refuses to start on Node before 24.9", { timeout: 10_000 }, async () => {
    const olderNode = `data:text/javascript,Object.defineProperty(process.versions,"node",{value:"24.8.0"})`;
    const mainTs = join(import.meta.dirname, "..", "src", "server", "main.ts");
    for (const entry of [BIN, mainTs]) {
      const result = await promisify(execFile)(process.execPath, ["--import", olderNode, entry], {
        timeout: 9000,
      }).catch((error: { code: number; stderr: string }) => error);
      expect(result).toMatchObject({
        code: 1,
        stderr: "president needs Node 24.9 or newer (you have 24.8.0).\n",
      });
    }
  });
});
