import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_FORMAT_DOC, DEMO_SOURCE, run } from "../src/cli/main.ts";
import { linkedWorktree } from "../src/cli/worktree.ts";
import type { CardAction } from "../src/core/actions.ts";
import { MAX_CARD_BYTES } from "../src/core/card-file.ts";
import { actOnCard, findCard, undoLastAction } from "../src/server/cards.ts";
import type { Project } from "../src/server/registry.ts";
import { cardText, copyDemoProject, sizedCard, tempDir } from "./helpers.ts";

const BIN = join(import.meta.dirname, "..", "bin", "president.js");

/** Runs once, when `parseCard` is given `text`: a moment in the middle of an update. */
const parsing = vi.hoisted(() => ({ text: "", during: undefined as (() => void) | undefined }));

vi.mock("../src/core/card-file.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/card-file.ts")>();
  return {
    ...real,
    parseCard: (text: string, fileName: string) => {
      const during = parsing.during;
      if (during && text === parsing.text) {
        parsing.during = undefined;
        during();
      }
      return real.parseCard(text, fileName);
    },
  };
});

/** Once, when set: drops this card file from what `loadProjectCards` found (gone meanwhile). */
const loading = vi.hoisted(() => ({ drop: undefined as string | undefined }));

vi.mock("../src/server/cards.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/cards.ts")>();
  return {
    ...real,
    loadProjectCards: async (...args: Parameters<typeof real.loadProjectCards>) => {
      const result = await real.loadProjectCards(...args);
      const drop = loading.drop;
      loading.drop = undefined;
      return drop === undefined
        ? result
        : { ...result, cards: result.cards.filter((c) => c.fileName !== drop) };
    },
  };
});

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

// The CLI loads its commands, and `serve` the server, on first use. Loading means vite
// transforming them and what they import: on a busy machine that took over 5 s, which the
// test that happened to come first paid for out of its 5 s. Done here, outside any test.
beforeAll(async () => {
  await import("../src/cli/commands.ts");
  await import("../src/server/server.ts");
}, 60_000);

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

  // --create can't help when decisions is a file, so add doesn't suggest it (R8-4).
  it("says decisions is not a folder when it is a file, with or without --create", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "decisions"), "notes");
    const refused = `president: "${join(dir, "decisions")}" exists but is not a directory`;
    expect(await cli("add", dir)).toEqual({ code: 1, out: "", err: refused });
    expect(await cli("add", dir, "--create")).toEqual({ code: 1, out: "", err: refused });
    const notFolder = `president: "${join(dir, "decisions")}" is not a folder`;
    expect(await cli("pending", dir)).toEqual({ code: 1, out: "", err: notFolder });
  });

  // A decisions link to a folder that isn't there (not mounted, not checked out) (R9-1).
  it("says decisions is a link to nothing, and --create doesn't pretend to make it", async () => {
    const dir = await tempDir();
    const decisions = join(dir, "decisions");
    await symlink(join(dir, "gone"), decisions);
    const refused = `president: "${decisions}" is a link to ${join(dir, "gone")}, which doesn't exist`;
    expect(await cli("add", dir)).toEqual({ code: 1, out: "", err: refused });
    expect(await cli("add", dir, "--create")).toEqual({ code: 1, out: "", err: refused });
    expect(await cli("list", "--json")).toMatchObject({ code: 0, out: "[]" });
    const notFolder = `president: "${decisions}" is not a folder`;
    expect(await cli("pending", dir)).toEqual({ code: 1, out: "", err: notFolder });
  });

  // A path through a file or a loop of links is one line, not a stack trace (R10-1, R10-2),
  // and validate says the same, not "does not exist" (R11-3).
  it("says a path goes through a file or a link loop, in one line", async () => {
    const scratch = await tempDir();
    await writeFile(join(scratch, "file.txt"), "notes");
    const throughFile = join(scratch, "file.txt", "x");
    const loop = join(scratch, "loop");
    await symlink("loop", loop);
    const notFolder = (path: string) =>
      `president: cannot open ${path}: a part of the path is a file, not a folder`;
    const looped = (path: string) =>
      `president: cannot open ${path}: the path goes through a loop of links`;
    for (const command of ["pending", "add", "validate"]) {
      expect(await cli(command, throughFile)).toEqual({
        code: 1,
        out: "",
        err: notFolder(throughFile),
      });
      expect(await cli(command, loop)).toEqual({ code: 1, out: "", err: looped(loop) });
    }
    // decisions -> decisions: add explains it (with or without --create), pending says what it is.
    const dir = join(scratch, "project");
    const decisions = join(dir, "decisions");
    await mkdir(dir);
    await symlink("decisions", decisions);
    expect(await cli("add", dir)).toEqual({ code: 1, out: "", err: looped(decisions) });
    expect(await cli("add", dir, "--create")).toEqual({ code: 1, out: "", err: looped(decisions) });
    expect(await cli("list", "--json")).toMatchObject({ code: 0, out: "[]" });
    const notAFolder = `president: "${decisions}" is not a folder`;
    expect(await cli("pending", dir)).toEqual({ code: 1, out: "", err: notAFolder });
  });

  it("validates cards and fails on broken ones", async () => {
    const demo = await copyDemoProject();
    expect((await cli("validate", demo)).code).toBe(0);
    await writeFile(
      join(demo, "decisions", "0009-bad.md"),
      cardText({ id: '"0009"', status: "maybe" }),
    );
    const result = await cli("validate", demo);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/broken {2}0009-bad\.md\n\s+- status: Invalid option/);
    expect(result.out).toMatch(/4 valid, 1 broken/);
    expect(result.out).toContain(`Format: ${CARD_FORMAT_DOC}`);
  });

  // As the hub measures the file on disk, rounded up (R7-10).
  it("takes a card file of exactly the size limit and refuses one byte more", async () => {
    const demo = await copyDemoProject();
    await writeFile(
      join(demo, "decisions", "0009-at-limit.md"),
      sizedCard(MAX_CARD_BYTES).replace('id: "0001"', 'id: "0009"'),
    );
    await writeFile(
      join(demo, "decisions", "0010-over.md"),
      sizedCard(MAX_CARD_BYTES + 1).replace('id: "0001"', 'id: "0010"'),
    );
    await cli("add", demo);
    const result = await cli("validate", demo);
    expect(result.out).toContain("ok      0009-at-limit.md");
    expect(result.err).toBe(
      "broken  0010-over.md\n          - the file is 1025 kB; cards must be at most 1024 kB",
    );
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
        out: `Updated 0002-api-errors.md. Remove ${mine} once you no longer need it.`,
        err: "",
      });
      expect(await readFile(file, "utf8")).toBe(rewritten);
      // The agent's file is the agent's to remove (R6-9).
      expect(await readFile(mine, "utf8")).toBe(rewritten);
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
        /^president: 0002-api-errors\.md was not changed: what the human owns differs[\s\S]*Read the card again[\s\S]*\n {2}- feedback: the human added 1 entry since you read the card:\n {2}- note \S+: Actually two words is fine too\.$/,
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

    // The skill tells the two refusals apart by their words, not by what the human did: a
    // decision made and taken back meanwhile gets the "read it again" one (R8-2).
    it("says the card changed after a decision made and undone, as the skill expects", async () => {
      const skill = (
        await readFile(
          join(import.meta.dirname, "..", "skills", "decision-cards", "SKILL.md"),
          "utf8",
        )
      ).replace(/\s+/g, " ");
      const again = 'If it says "the card changed since you read it"';
      const dontRewrite = `If it says "its decision changed", don't write your version again`;
      expect(skill).toContain(again);
      expect(skill).toContain(dontRewrite);
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "neither", note: "both assume a server" });
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, rewrite(await readFile(file, "utf8")));
      const decided = await human(demo, "0002", { type: "resolve", choice: "throw" });
      await undoLastAction({ name: "demo", path: demo }, "0002", decided.revision);
      const refused = await cli("update", file, mine);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("the card changed since you read it");
      expect(refused.err).not.toContain("its decision changed");
      expect(refused.err).toMatch(/- undo \S+: Took back the decision "throw"\./);
      await writeFile(mine, rewrite(await readFile(file, "utf8")));
      expect((await cli("update", file, mine)).code).toBe(0);
    });

    it("refuses a version that changes the status, or one that is broken", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      const before = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, before.replace("status: open", "status: deferred"));
      expect((await cli("update", file, mine)).err).toBe(
        [
          "president: 0002-api-errors.md was not changed: what the human owns differs between the card and your version, so the card changed since you read it. Read the card again, make your changes to it as it is now (keep status, resolution, feedback, applied_at, seen_at exactly as they are), and run president update again:",
          '  - status: the card has "open", your version "deferred"',
        ].join("\n"),
      );
      // A decision is never the agent's to write.
      await writeFile(
        mine,
        before.replace(
          "status: open\n",
          "status: resolved\nresolution:\n  choice: result\n  resolved_at: 2026-11-10T10:00:00Z\n",
        ),
      );
      expect((await cli("update", file, mine)).err).toBe(
        [
          "president: 0002-api-errors.md was not changed: its decision changed since you read it (the human took back a decision), or your version changes it, so don't rewrite it: run `president pending` and handle the card as it shows it (for a decided card, apply the decision).",
          '  - status: the card has "open", your version "resolved"',
          '  - resolution: the card has none, your version a decision ("result")',
        ].join("\n"),
      );
      // Problems are labeled with the agent's file: their line numbers are its (R6-7).
      await writeFile(mine, before.replace("kind: ab", "kind: maybe"));
      const broken = await cli("update", file, mine);
      expect(broken.code).toBe(1);
      expect(broken.err).toMatch(
        new RegExp(`^broken  ${mine}\\n\\s+- kind: Invalid option[\\s\\S]*was not changed`),
      );
      expect(await readFile(file, "utf8")).toBe(before);
      expect((await cli("update", file, file)).err).toMatch(/as a separate file/);
      expect((await cli("update", file)).err).toMatch(
        /usage: president update <card-file> <new-version-file>/,
      );
    });

    it("warns when the agent's version keeps needs_new_options (R7-12)", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "neither", note: "both assume a server" });
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(
        mine,
        (await readFile(file, "utf8")).replace("## Option throw", "## Option throw\n\nMore."),
      );
      expect(await cli("update", file, mine)).toMatchObject({
        code: 0,
        err: "president: warning: needs_new_options is still set. Remove it once the options are rewritten, or the card stays out of the human's queue.",
      });
    });

    // A deferral is not a decision: the rewrite is made again from the card as it is (R7-5).
    it("asks for the rewrite again when the human deferred the card meanwhile", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "neither", note: "Show me something lighter." });
      const rewrite = (text: string) =>
        text
          .replace("needs_new_options: true\n", "")
          .replace("title: Return a result object", "title: Return a tiny tuple");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, rewrite(await readFile(file, "utf8")));
      await human(demo, "0002", { type: "defer", note: "Later." });
      const deferred = await readFile(file, "utf8");
      const refused = await cli("update", file, mine);
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(
        /^president: 0002-api-errors\.md was not changed: what the human owns differs[\s\S]*Read the card again[\s\S]*\n {2}- status: the card has "deferred", your version "open"$/,
      );
      expect(await readFile(file, "utf8")).toBe(deferred);
      await writeFile(mine, rewrite(deferred));
      expect((await cli("update", file, mine)).code).toBe(0);
      expect(await readFile(file, "utf8")).toContain("title: Return a tiny tuple");
    });

    // The decision is about the options and text the human saw (R6-1).
    it("never rewrites a decided card, even when the agent read it decided", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "neither", note: "both assume a server" });
      const read = await readFile(file, "utf8");
      // The human decides while the agent rewrites the options.
      await human(demo, "0002", { type: "resolve", choice: "result", note: "Fine." });
      const decided = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      const refusal =
        "president: 0002-api-errors.md was not changed: the human decided it, and the decision is about the card as they saw it, so don't rewrite it: run `president pending` and handle the card as it shows it (for a decided card, apply the decision).";
      await writeFile(
        mine,
        read.replace("title: Return a result object", "title: Return a REWRITTEN object"),
      );
      expect(await cli("update", file, mine)).toMatchObject({ code: 1, err: refusal });
      // Made again from the card as it is now, it is refused all the same.
      await writeFile(
        mine,
        decided.replace("title: Return a result object", "title: Return a REWRITTEN object"),
      );
      expect(await cli("update", file, mine)).toMatchObject({ code: 1, err: refusal });
      expect(await readFile(file, "utf8")).toBe(decided);
    });

    // The human took a note back after the agent read the card (R6-6).
    it("says which entries the human took back since the agent read the card", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      const noted = await human(demo, "0002", { type: "note", note: "Use\nthe retry budget." });
      const read = await readFile(file, "utf8");
      await undoLastAction({ name: "demo", path: demo }, "0002", noted.revision);
      const now = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(
        mine,
        read.replace("## Option throw", "## Option throw\n\nRetries: see below."),
      );
      const refused = await cli("update", file, mine);
      expect(refused.code).toBe(1);
      expect(refused.err).toMatch(
        /\n {2}- feedback: the human took back 1 entry since you read the card; drop it from your version, and undo anything you changed for it:\n {2}- note \S+: Use\n {4}the retry budget\.$/,
      );
      expect(await readFile(file, "utf8")).toBe(now);
    });

    it("refuses a version whose feedback entries the agent changed", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "note", note: "Ask Sam." });
      const read = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, read.replace("note: Ask Sam.", "note: Ask Sam about retries."));
      expect((await cli("update", file, mine)).err).toMatch(
        /\n {2}- feedback: your version's entries are not the card's; copy them unchanged$/,
      );
      expect(await readFile(file, "utf8")).toBe(read);
    });

    // A version made before the done line ran would mark the note unread again (R6-15).
    it("refuses a version read before the agent marked the feedback read", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      await human(demo, "0002", { type: "note", note: "Ask Sam." });
      const shown = (await cli("pending", demo)).out;
      const read = await readFile(file, "utf8");
      expect((await runDone(shown, file)).code).toBe(0);
      const seen = await readFile(file, "utf8");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(mine, read.replace("## Option throw", "## Option throw\n\nAsked Sam."));
      expect((await cli("update", file, mine)).err).toMatch(
        /\n {2}- seen_at: the card has "[^"]+", your version none$/,
      );
      expect(await readFile(file, "utf8")).toBe(seen);
    });

    // update runs the checks validate runs across the project (R6-7).
    it("warns about a depends_on that names no card, as validate does", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      const mine = join(demo, "decisions", ".0002.new.md");
      const before = await readFile(file, "utf8");
      await writeFile(mine, before.replace("depends_on: []", 'depends_on: ["0099"]'));
      const result = await cli("update", file, mine);
      expect(result.code).toBe(0);
      expect(result.err).toBe(
        'warning 0002-api-errors.md: depends_on "0099" is not a card in this project (line 10)',
      );
    });

    // president never writes a broken card, so the agent fixes it by hand (R6-10).
    // The hub may write the card while the agent's version is checked (R6-15).
    it("leaves the card alone when the hub writes it during the update", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      const mine = join(demo, "decisions", ".0002.new.md");
      const before = await readFile(file, "utf8");
      parsing.text = before.replace("## Option throw", "## Option throw\n\nRewritten.");
      await writeFile(mine, parsing.text);
      const human = `${before}\nThe human's edit.\n`;
      parsing.during = () => writeFileSync(file, human);
      expect(await cli("update", file, mine)).toEqual({
        code: 1,
        out: "",
        err: "president: 0002-api-errors.md changed while updating it; run president update again",
      });
      expect(parsing.during).toBeUndefined();
      expect(await readFile(file, "utf8")).toBe(human);
    });

    it("says to fix a broken card by editing it directly", async () => {
      const demo = await copyDemoProject();
      const file = join(demo, "decisions", "0002-api-errors.md");
      const mine = join(demo, "decisions", ".0002.new.md");
      await writeFile(file, (await readFile(file, "utf8")).replace("kind: ab", "kind: maybe"));
      await writeFile(mine, "anything");
      expect((await cli("update", file, mine)).err).toMatch(
        /^president: 0002-api-errors\.md is broken\. Fix it by editing the file directly \(president doesn't write broken cards, so this is the one case to edit a card yourself\), then run this again\n {2}- kind: Invalid option/,
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
      /New notes from the human[\s\S]*undo \S+: Took back the decision "result"[\s\S]*\n {4}The human took back the earlier decision "result"\. If you recorded it in the docs or changed code for it, revert that, then run the done line\./,
    );
    expect((await runDone(later, file)).code).toBe(0);
    expect((await cli("pending", demo)).out).toBe("Nothing pending.");
  });

  // "This decision" read as the new one, shown just above (R6-3).
  it("names the decision taken back when the card was decided again since", async () => {
    const demo = await copyDemoProject();
    const decided = await human(demo, "0002", { type: "resolve", choice: "throw" });
    await undoLastAction({ name: "demo", path: demo }, "0002", decided.revision);
    await human(demo, "0002", { type: "resolve", choice: "result", note: "Go with results." });
    const out = (await cli("pending", demo)).out;
    expect(out).toMatch(/Resolved, not yet applied[\s\S]*-> result \(Go with results\.\)/);
    expect(out).toContain(
      '    The human took back the earlier decision "throw". If you recorded it in the docs or changed code for it, revert that, then apply the current decision, "result", as usual, then run the done line.',
    );
  });

  // A custom answer is its text: the hint says it, not only "custom" (R8-3).
  it("names a custom current decision with its text in the undo hint", async () => {
    const demo = await copyDemoProject();
    const welcome = { type: "resolve", choice: "custom", note: "Welcome aboard." } as const;
    const decided = await human(demo, "0003", welcome);
    await undoLastAction({ name: "demo", path: demo }, "0003", decided.revision);
    await human(demo, "0003", { type: "resolve", choice: "custom", note: "Plan your first trip." });
    expect((await cli("pending", demo)).out).toContain(
      '    The human took back the earlier decision custom ("Welcome aboard."). If you recorded it in the docs or changed code for it, revert that, then apply the current decision, custom ("Plan your first trip."), as usual, then run the done line.',
    );
  });

  const reopenHint =
    '    Reopened, not decided again yet: don\'t change the docs or code for it now. Run the done line; when the human decides again, pending says "Decided again".';

  it("says to wait for a new decision after a reopen alone (R5-17)", async () => {
    const demo = await copyDemoProject();
    await human(demo, "0004", { type: "reopen", note: "Costs changed." });
    expect((await cli("pending", demo)).out).toContain(reopenHint);
  });

  // Only a decision taken back by a reopen waits for a new one, and only until it comes (R7-12).
  it("gives the reopen hint only for a reopened decision that wasn't made again", async () => {
    const demo = await copyDemoProject();
    await human(demo, "0002", { type: "defer", note: "Later." });
    await human(demo, "0002", { type: "reopen", note: "Now is fine." });
    const undeferred = (await cli("pending", demo)).out;
    expect(undeferred).toMatch(/reopen \S+: Now is fine\./);
    expect(undeferred).not.toContain("Reopened, not decided again yet");
    await human(demo, "0004", { type: "reopen", note: "Costs changed." });
    await human(demo, "0004", { type: "resolve", choice: "maptiler" });
    const decidedAgain = (await cli("pending", demo)).out;
    expect(decidedAgain).toMatch(/Decided again: it was "protomaps"/);
    expect(decidedAgain).not.toContain("Reopened, not decided again yet");
  });

  // The hints are about the entries, not about which came last (R6-12).
  it("keeps the reopen and undo hints when a note comes after them", async () => {
    const demo = await copyDemoProject();
    await human(demo, "0004", { type: "reopen" });
    await human(demo, "0004", { type: "note", note: "Still thinking about cost." });
    expect((await cli("pending", demo)).out).toContain(reopenHint);
    const decided = await human(demo, "0001", { type: "resolve", choice: "sqlite" });
    await undoLastAction({ name: "demo", path: demo }, "0001", decided.revision);
    await human(demo, "0001", { type: "note", note: "Let me sleep on it." });
    expect((await cli("pending", demo)).out).toMatch(
      /Let me sleep on it\.\n {4}The human took back the earlier decision "sqlite"\. If you recorded it/,
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

  // The project is the folder given (or "."), or the folder that holds a card's decisions/
  // folder; nothing above it is looked at, in a git repository or not.
  it("uses the folder it is given as the project, and nothing above it", async () => {
    const repo = await copyDemoProject("trips");
    await mkdir(join(repo, ".git"));
    await mkdir(join(repo, "src"));
    await cli("add", repo);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(join(repo, "src"));
    try {
      for (const command of ["pending", "validate"]) {
        expect(await cli(command)).toEqual({
          code: 1,
          out: "",
          err: `president: ${join(repo, "src")} has no decisions/ folder. Run this in the project's main folder (the one that contains decisions/), not in a git worktree.`,
        });
      }
      expect(await cli("add", ".")).toMatchObject({
        code: 1,
        err: `president: ${join(repo, "src")} has no decisions/ folder. Run this in the project's main folder (the one that contains decisions/), not in a git worktree. Or add --create to make one here.`,
      });
      // --create makes decisions/ in the folder given, never in a parent.
      expect((await cli("add", ".", "--create")).out).toBe(`Registered src (${join(repo, "src")})`);
      expect((await readdir(join(repo, "src"))).includes("decisions")).toBe(true);
    } finally {
      cwd.mockRestore();
    }
  });

  // A folder argument is used exactly as given, even one called decisions (R8-1).
  it("uses a project folder named decisions as the project, in every command", async () => {
    const root = join(await tempDir(), "decisions");
    await mkdir(root);
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
    try {
      expect((await cli("add", ".", "--create")).out).toBe(`Registered decisions (${root})`);
      await writeFile(join(root, "decisions", "0001-pick-a-colour.md"), cardText());
      await human(root, "0001", { type: "note", note: "Blue, maybe?" });
      expect(await cli("validate")).toEqual({
        code: 0,
        out: `ok      0001-pick-a-colour.md\n\n1 valid, 0 broken in ${join(root, "decisions")}. Format: ${CARD_FORMAT_DOC}`,
        err: "",
      });
      const listed = await cli("pending");
      expect(listed).toMatchObject({ code: 0, err: "" });
      expect(listed.out).toMatch(/New notes from the human[\s\S]*Blue, maybe\?/);
      // Its own decisions/ folder is a folder like any other: not a way to name the project.
      const inner = `president: ${join(root, "decisions")} has no decisions/ folder. Run this in the project's main folder (the one that contains decisions/), not in a git worktree.`;
      for (const command of ["pending", "validate"]) {
        expect(await cli(command, "decisions")).toEqual({ code: 1, out: "", err: inner });
      }
      expect((await cli("add", "decisions")).err).toBe(
        `${inner} Or add --create to make one here.`,
      );
    } finally {
      cwd.mockRestore();
    }
  });

  it("says when the project is not registered", async () => {
    const demo = await copyDemoProject("trips");
    const note = `president: note: ${demo} is not registered with the hub, so the human doesn't see its cards. Register it: president add ${demo}`;
    expect(await cli("pending", demo)).toEqual({ code: 0, out: "Nothing pending.", err: note });
    expect((await cli("validate", demo)).err).toBe(note);
    expect((await cli("validate", join(demo, "decisions", "0002-api-errors.md"))).err).toBe(note);
    // An entry that names a link to the folder (written by hand) is the same project.
    const link = join(await tempDir(), "trips-link");
    await symlink(demo, link);
    await mkdir(join(configHome, "president", "projects"), { recursive: true });
    await writeFile(
      join(configHome, "president", "projects", "trips.json"),
      JSON.stringify({ path: link }),
    );
    expect((await cli("pending", demo)).err).toBe("");
    // A registry it can't read is said, and the command still runs.
    await writeFile(join(configHome, "president", "projects", "trips.json"), "{");
    const unreadable = await cli("pending", demo);
    expect(unreadable).toMatchObject({ code: 0, out: "Nothing pending." });
    expect(unreadable.err).toMatch(/^president: note: can't read the registry: /);
  });

  // A linked worktree's decisions/ is its own copy, without the human's answers (#0022).
  it("warns, without refusing, when pending, applied, seen or update run in a git worktree", async () => {
    const main = await realpath(await copyDemoProject("trips"));
    const wt = join(dirname(main), "wt");
    // No GIT_* variables from a hook, no system or global git config.
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    const git = (...args: string[]) =>
      promisify(execFile)("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: main,
        env,
      });
    await git("init", "-q");
    await git("add", ".");
    await git("commit", "-qm", "cards");
    await git("worktree", "add", "-q", wt);
    await cli("add", main);

    expect(await cli("pending", main)).toMatchObject({ code: 0, err: "" });
    const warning = `president: warning: ${wt} is in a git worktree, which has its own copy of decisions/: the human's answers are not in it, and this command reads or marks only that copy. Run president commands in the project's main folder (${main}), and don't run president add in a worktree.`;
    const pending = await cli("pending", wt);
    expect(pending).toMatchObject({ code: 0, out: "Nothing pending." });
    // First, before the note that suggests registering the worktree.
    expect(pending.err.split("\n")[0]).toBe(warning);
    const card = join(wt, "decisions", "0004-map-tiles.md");
    for (const args of [
      ["applied", card, "--token", "x"],
      ["seen", card, "--token", "x"],
      ["update", card, join(wt, "decisions", ".0004.new")],
    ]) {
      expect((await cli(...args)).err.split("\n")).toContain(warning);
    }
    // A project in a subfolder: the same subfolder of the main checkout.
    expect(await linkedWorktree(join(wt, "decisions"))).toEqual({
      main: join(main, "decisions"),
    });
    expect(await linkedWorktree(main)).toBeUndefined();
    expect(await linkedWorktree(dirname(main))).toBeUndefined();
  });

  // A link to a registered project's folder is that project (R8-6).
  it("knows a registered project given through a link to its folder", async () => {
    const demo = await copyDemoProject("trips");
    await cli("add", demo);
    const link = join(await tempDir(), "trips-link");
    await symlink(demo, link);
    expect(await cli("pending", link)).toEqual({ code: 0, out: "Nothing pending.", err: "" });
    expect(await cli("validate", link)).toMatchObject({ code: 0, err: "" });
    const card = join(link, "decisions", "0002-api-errors.md");
    expect(await cli("validate", card)).toMatchObject({ code: 0, err: "" });
  });

  // A path that isn't there is said so, not taken for a folder without decisions/ (R8-6).
  it("says a path is missing before looking for its decisions/ folder", async () => {
    const missing = join(await tempDir(), "nope");
    const gone = { code: 1, out: "", err: `president: "${missing}" does not exist` };
    expect(await cli("add", missing)).toEqual(gone);
    expect(await cli("validate", missing)).toEqual(gone);
    expect(await cli("pending", missing)).toEqual(gone);
    // Something there that isn't a folder is a different thing (R9-2).
    const file = join(await tempDir(), "notes.txt");
    await writeFile(file, "notes");
    const notFolder = { code: 1, out: "", err: `president: "${file}" is not a folder` };
    expect(await cli("pending", file)).toEqual(notFolder);
  });

  // A project inside a registered one (r7 vf7.sh): its own cards, not the outer project's.
  it("checks a card in the project that holds its decisions/ folder (R7-1)", async () => {
    const shop = await copyDemoProject("shop");
    await mkdir(join(shop, ".git"));
    await cli("add", shop);
    const web = join(shop, "web");
    await mkdir(join(web, "decisions"), { recursive: true });
    const card = join(web, "decisions", "0001-web-copy.md");
    await writeFile(card, cardText({ id: '"0001"' }));
    const unregistered = `president: note: ${web} is not registered with the hub, so the human doesn't see its cards. Register it: president add ${web}`;
    const good = await cli("validate", card);
    expect(good).toMatchObject({ code: 0, err: unregistered });
    expect(good.out).toMatch(/^ok {6}0001-web-copy\.md\n/);
    const bad = join(web, "decisions", "0002-broken.md");
    await writeFile(bad, cardText({ id: '"0002"', title: "Copy: what?" }));
    const broken = await cli("validate", bad);
    expect(broken.code).toBe(1);
    expect(broken.err).toMatch(/^president: note: .*\nbroken {2}0002-broken\.md\n {10}- /);
    const all = await cli("validate", web);
    expect(all.code).toBe(1);
    expect(all.out).toMatch(
      /^ok {6}0001-web-copy\.md\n\n1 valid, 1 broken in .*\/web\/decisions\./,
    );
    const pending = await cli("pending", web);
    expect(pending.out).toMatch(/Broken cards .*\n {2}0002-broken\.md: /);
  });

  // validate never exits 1 without saying why.
  it("says why a card file can't be checked in its project", async () => {
    const demo = await copyDemoProject();
    const outside = await tempDir();
    await rename(join(demo, "decisions"), join(outside, "decisions"));
    await symlink(join(outside, "decisions"), join(demo, "decisions"));
    const result = await cli("validate", join(demo, "decisions", "0002-api-errors.md"));
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/links to .*, outside the project; president doesn't follow it/);
  });

  // Nor when the card went away while its project was read (R8-6).
  it("says a card file was not found when its project's cards don't have it", async () => {
    const demo = await copyDemoProject();
    loading.drop = "0002-api-errors.md";
    const result = await cli("validate", join(demo, "decisions", "0002-api-errors.md"));
    expect(result.code).toBe(1);
    expect(
      result.err.endsWith(
        `\nbroken  0002-api-errors.md\n          - not found in ${join(demo, "decisions")}`,
      ),
    ).toBe(true);
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

  // Not "has no decisions/ folder" for one it may not look in (R11-4).
  it.skipIf(process.getuid?.() === 0)("explains a project folder it may not look in", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "decisions"));
    await chmod(dir, 0o600);
    try {
      const denied = `president: cannot open ${join(dir, "decisions")}: permission denied`;
      for (const command of ["add", "pending", "validate"]) {
        expect(await cli(command, dir), command).toEqual({ code: 1, out: "", err: denied });
      }
      expect(await cli("list", "--json")).toMatchObject({ code: 0, out: "[]" });
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
    const node23 = `data:text/javascript,Object.defineProperty(process.versions,"node",{value:"23.11.0"})`;
    const result = await promisify(execFile)(process.execPath, ["--import", node23, BIN], {
      timeout: 9000,
    }).catch((error: { code: number; stderr: string }) => error);
    expect(result).toMatchObject({
      code: 1,
      stderr: "president needs Node 24.9 or newer (you have 23.11.0).\n",
    });
  });
});
