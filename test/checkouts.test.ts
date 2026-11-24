/**
 * The hub reads a project's cards from every checkout (cards on the working branch): the
 * registered folder and each `git worktree list` entry.
 */
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  actOnCard,
  findCard,
  loadProjectCards,
  pickCopy,
  rewriteCard,
  toCardDto,
  undoLastAction,
} from "../src/server/cards.ts";
import {
  checkoutsOf,
  forgetCheckouts,
  parseWorktreeList,
  withCheckouts,
} from "../src/server/checkouts.ts";
import { cardText, copyDemoProject, tempDir } from "./helpers.ts";

function git(cwd: string, ...args: string[]) {
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  return promisify(execFile)("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    env,
  });
}

/** The demo project as a git repository on main, plus a worktree on branch feat. */
async function repoWithWorktree() {
  const main = await realpath(await copyDemoProject("trips"));
  await git(main, "init", "-q", "-b", "main");
  await git(main, "add", ".");
  await git(main, "commit", "-qm", "cards");
  const wt = resolve(main, "..", "trips-feat");
  await git(main, "worktree", "add", "-q", "-b", "feat", wt);
  return { main, wt, project: { name: "trips", path: main } };
}

/** Runs right before the hub's atomic write of a card, when set (a folder going mid-write). */
const writeHook = vi.hoisted(() => ({ before: undefined as (() => void) | undefined }));
vi.mock("../src/server/fs-utils.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/fs-utils.ts")>();
  return {
    ...actual,
    writeFileAtomic: (path: string, content: string) => {
      writeHook.before?.();
      return actual.writeFileAtomic(path, content);
    },
  };
});

// Each test runs several git commands, slow to start on a busy Windows machine.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => forgetCheckouts());

describe("checkoutsOf", () => {
  it("lists the folder first, then every other worktree, with their branches", async () => {
    const { main, wt, project } = await repoWithWorktree();
    expect(await checkoutsOf(project)).toEqual([
      { path: main, branch: "main" },
      { path: wt, branch: "feat" },
    ]);
    // From the worktree, it comes first.
    forgetCheckouts();
    expect(await checkoutsOf({ path: wt })).toEqual([
      { path: wt, branch: "feat" },
      { path: main, branch: "main" },
    ]);
    // A detached HEAD has no branch.
    await git(wt, "checkout", "-q", "--detach");
    forgetCheckouts();
    expect((await checkoutsOf(project))[1]).toEqual({ path: wt, branch: null });
  });

  it("tells a worktree inside the registered folder from the folder itself", async () => {
    const { main, project } = await repoWithWorktree();
    // As .claude/worktrees/ in president's own checkout (ignored, like there).
    await writeFile(join(main, ".gitignore"), ".claude/\n");
    const nested = join(main, ".claude", "worktrees", "inner");
    await git(main, "worktree", "add", "-q", "-b", "inner", nested);
    const [own, ...others] = await checkoutsOf(project);
    expect(own).toEqual({ path: main, branch: "main" });
    // The others in git's order.
    expect(others).toHaveLength(2);
    expect(others).toEqual(
      expect.arrayContaining([
        { path: resolve(main, "..", "trips-feat"), branch: "feat" },
        { path: nested, branch: "inner" },
      ]),
    );
    forgetCheckouts();
    expect((await checkoutsOf({ path: nested }))[0]).toEqual({ path: nested, branch: "inner" });
  });

  it("updates a card's branch when its checkout switches branch", async () => {
    const { wt } = await repoWithWorktree();
    const before = await loadProjectCards(await withCheckouts({ name: "trips", path: wt }));
    expect(before.cards[0]?.branch).toBe("feat");
    await new Promise((done) => setTimeout(done, 2100)); // until the parses are cached
    await git(wt, "checkout", "-q", "-b", "renamed");
    forgetCheckouts();
    const after = await loadProjectCards(await withCheckouts({ name: "trips", path: wt }));
    // The same files, read from the cache, now on the new branch.
    expect(after.cards.map((c) => c.branch)).toEqual(after.cards.map(() => "renamed"));
  });

  it("is just the folder outside git", async () => {
    const dir = await tempDir();
    expect(await checkoutsOf({ path: dir })).toEqual([{ path: dir, branch: null }]);
  });

  it("is just the folder when git can't even start there (a path through a file)", async () => {
    const file = join(await tempDir(), "notes.txt");
    await writeFile(file, "notes");
    const inside = join(file, "project");
    expect(await checkoutsOf({ path: inside })).toEqual([{ path: inside, branch: null }]);
  });

  it("finds the project's subfolder in each checkout", async () => {
    const root = await realpath(await tempDir());
    await mkdir(join(root, "app", "decisions"), { recursive: true });
    await writeFile(join(root, "app", "decisions", "README.md"), "cards\n");
    await git(root, "init", "-q", "-b", "main");
    await git(root, "add", ".");
    await git(root, "commit", "-qm", "app");
    const wt = resolve(root, "..", `${root.split(/[\\/]/).at(-1)}-wt`);
    await git(root, "worktree", "add", "-q", "-b", "feat", wt);
    expect(await checkoutsOf({ path: join(root, "app") })).toEqual([
      { path: join(root, "app"), branch: "main" },
      { path: join(wt, "app"), branch: "feat" },
    ]);
    // A worktree whose branch made the subfolder a link to elsewhere is left out.
    await rm(join(wt, "app"), { recursive: true });
    await symlink(await tempDir(), join(wt, "app"), "junction");
    forgetCheckouts();
    expect(await checkoutsOf({ path: join(root, "app") })).toEqual([
      { path: join(root, "app"), branch: "main" },
    ]);
  });

  it("leaves out bare repositories, prunable worktrees and quoted paths", () => {
    const abs = process.platform === "win32" ? "C:/r" : "/r";
    const output = [
      `worktree ${abs}/bare`,
      "bare",
      "",
      `worktree ${abs}/main`,
      "HEAD 1234",
      "branch refs/heads/main",
      "",
      `worktree ${abs}/gone`,
      "HEAD 1234",
      "branch refs/heads/old",
      "prunable gitdir file points to non-existent location",
      "",
      `worktree "${abs}/odd\\nname"`,
      "HEAD 1234",
      "detached",
      "",
      `worktree ${abs}/feat`,
      "HEAD 1234",
      "branch refs/heads/team/feat",
      "",
    ].join("\n");
    expect(parseWorktreeList(output)).toEqual([
      { path: resolve(`${abs}/main`), branch: "main" },
      { path: resolve(`${abs}/feat`), branch: "team/feat" },
    ]);
  });
});

describe("cards in every checkout", () => {
  it("shows a card that is only on a worktree's branch, with that branch, and writes there", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const file = "20261116abcd-new-question.md";
    await writeFile(join(wt, "decisions", file), cardText({ id: '"20261116abcd"' }));

    const hub = await withCheckouts(project);
    const { cards, error } = await loadProjectCards(hub);
    expect(error).toBeUndefined();
    const card = cards.find((c) => c.id === "20261116abcd");
    expect(card).toMatchObject({
      branch: "feat",
      shownBranch: "feat",
      path: join(wt, "decisions", file),
    });
    // The demo's cards are in both checkouts, the same: each is shown once, from the folder,
    // with no branch shown (the registered folder's own).
    expect(cards.filter((c) => c.id === "0001")).toEqual([
      expect.objectContaining({
        branch: "main",
        shownBranch: null,
        path: join(main, "decisions", "0001-offline-storage.md"),
      }),
    ]);
    expect(card && toCardDto(card).branch).toBe("feat");
    const folderCard = cards.find((c) => c.id === "0001");
    expect(folderCard && toCardDto(folderCard).branch).toBeNull();
    expect(cards.map((c) => c.fileName)).toEqual([...cards.map((c) => c.fileName)].sort());

    const found = await findCard(hub, "20261116abcd");
    if (!found.ok) throw new Error("broken");
    await actOnCard(
      hub,
      "20261116abcd",
      { type: "resolve", choice: "custom", note: "Yes." },
      {
        revision: found.card.revision,
      },
    );
    expect(await readFile(join(wt, "decisions", file), "utf8")).toMatch(/status: resolved/);

    // preside's own folder scope sees only its checkout.
    const alone = await loadProjectCards(project);
    expect(alone.cards.some((c) => c.id === "20261116abcd")).toBe(false);
  });

  it("refuses with a conflict an answer to a card whose worktree went meanwhile", async () => {
    const { wt, project } = await repoWithWorktree();
    const file = "20261124gone-question.md";
    await writeFile(join(wt, "decisions", file), cardText({ id: '"20261124gone"' }));
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "20261124gone");
    if (!found.ok) throw new Error("broken");
    // The worktree is removed after the card was found, before its file is read for the write
    // (`now` is read in between).
    const options = {
      revision: found.card.revision,
      get now() {
        rmSync(wt, { recursive: true, force: true });
        return new Date();
      },
    };
    await expect(
      actOnCard(hub, "20261124gone", { type: "note", note: "Hi." }, options),
    ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/the card moved/) });
    // Nothing was written back: the folder stays gone.
    expect(existsSync(join(wt, "decisions"))).toBe(false);
  });

  it("refuses with a conflict a write to a card file deleted after it was read", async () => {
    const project = { name: "demo", path: await copyDemoProject() };
    const path = join(project.path, "decisions", "0002-api-errors.md");
    const found = await findCard(project, "0002");
    if (!found.ok) throw new Error("broken");
    // rewriteCard reads `raw` after reading the file: the file goes in between, so the check
    // before the write sees it gone.
    const next = {
      get raw() {
        rmSync(path);
        return found.card.raw;
      },
      body: found.card.body,
    };
    await expect(rewriteCard(project, "0002", found.card, next)).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/the card moved/),
    });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses with a conflict a write whose decisions/ goes during the write itself", async () => {
    const project = { name: "demo", path: await copyDemoProject() };
    const dir = join(project.path, "decisions");
    const found = await findCard(project, "0002");
    if (!found.ok) throw new Error("broken");
    // The folder goes after the check that the file is there, as the atomic write starts.
    writeHook.before = () => rmSync(dir, { recursive: true, force: true });
    try {
      await expect(
        actOnCard(
          project,
          "0002",
          { type: "note", note: "Hi." },
          { revision: found.card.revision },
        ),
      ).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/the card moved/) });
    } finally {
      writeHook.before = undefined;
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("shows the copy with the latest activity when copies differ", async () => {
    const { wt, project } = await repoWithWorktree();
    const hub = await withCheckouts(project);
    const inWorktree = await findCard({ name: "trips", path: wt }, "0001");
    if (!inWorktree.ok) throw new Error("broken");
    await actOnCard(
      { name: "trips", path: wt },
      "0001",
      { type: "note", note: "Later." },
      {
        revision: inWorktree.card.revision,
      },
    );
    const found = await findCard(hub, "0001");
    expect(found.ok && found.card).toMatchObject({ branch: "feat" });
    const { cards } = await loadProjectCards(hub);
    expect(cards.filter((c) => c.id === "0001").map((c) => c.branch)).toEqual(["feat"]);
  });

  it("keeps showing the answered copy after an agent marks a stale copy seen", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "0001");
    if (!found.ok) throw new Error("broken");
    // The answer goes to the folder's copy, the registered folder's of identical copies.
    await actOnCard(
      hub,
      "0001",
      { type: "resolve", choice: "custom", note: "Yes." },
      {
        revision: found.card.revision,
      },
    );
    // An agent in the worktree marks its own, unanswered copy seen, later (`preside seen`).
    const staleFile = join(wt, "decisions", "0001-offline-storage.md");
    const later = new Date(Date.now() + 60_000).toISOString().replace(/\.\d+Z$/, "Z");
    const text = await readFile(staleFile, "utf8");
    const marked = text.replace(/^seen_at: .*$/m, `seen_at: ${later}`);
    expect(marked).not.toBe(text);
    await writeFile(staleFile, marked);
    const stale = await findCard({ name: "trips", path: wt }, "0001");
    expect(stale.ok && stale.card.frontmatter.seen_at).toBe(later);
    const shown = await findCard(hub, "0001");
    expect(shown.ok && shown.card.path).toBe(join(main, "decisions", "0001-offline-storage.md"));
    expect(shown.ok && shown.card.frontmatter.status).toBe("resolved");
  });

  it("keeps showing a copy deferred without a note after git touches the other copy", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "0002");
    if (!found.ok) throw new Error("broken");
    // A defer without a note leaves no time in the frontmatter that the copies compare.
    await actOnCard(hub, "0002", { type: "defer" }, { revision: found.card.revision });
    // The worktree's unchanged copy is written again later (a checkout, a rebase).
    const staleFile = join(wt, "decisions", "0002-api-errors.md");
    await writeFile(staleFile, await readFile(staleFile, "utf8"));
    const later = new Date(Date.now() + 60_000);
    await utimes(staleFile, later, later);
    const shown = await findCard(hub, "0002");
    expect(shown.ok && shown.card.path).toBe(join(main, "decisions", "0002-api-errors.md"));
    expect(shown.ok && shown.card.frontmatter.status).toBe("deferred");
  });

  it("undoes an action on a card that is only in a worktree, byte for byte", async () => {
    const { wt, project } = await repoWithWorktree();
    const file = join(wt, "decisions", "20261116undo-question.md");
    const text = cardText({ id: '"20261116undo"' });
    await writeFile(file, text);
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "20261116undo");
    if (!found.ok) throw new Error("broken");
    const noted = await actOnCard(
      hub,
      "20261116undo",
      { type: "note", note: "Hm." },
      {
        revision: found.card.revision,
      },
    );
    expect(await readFile(file, "utf8")).not.toBe(text);
    await undoLastAction(hub, "20261116undo", noted.revision);
    expect(await readFile(file, "utf8")).toBe(text);
  });

  it("undoes a defer on a card with identical copies in the folder's copy", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const folderCopy = join(main, "decisions", "0002-api-errors.md");
    const before = await readFile(folderCopy, "utf8");
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "0002");
    if (!found.ok) throw new Error("broken");
    const deferred = await actOnCard(
      hub,
      "0002",
      { type: "defer" },
      {
        revision: found.card.revision,
      },
    );
    expect(deferred.path).toBe(folderCopy);
    const undone = await undoLastAction(hub, "0002", deferred.revision);
    expect(undone.path).toBe(folderCopy);
    expect(await readFile(folderCopy, "utf8")).toBe(before);
    // The copies are identical again: one card, from the folder.
    const shown = await findCard(hub, "0002");
    expect(shown.ok && shown.card.path).toBe(folderCopy);
    expect(await readFile(join(wt, "decisions", "0002-api-errors.md"), "utf8")).toBe(before);
  });

  it("doesn't mind a worktree whose branch has no decisions/ folder", async () => {
    const { wt, project } = await repoWithWorktree();
    await rm(join(wt, "decisions"), { recursive: true });
    const { cards, error } = await loadProjectCards(await withCheckouts(project));
    expect(error).toBeUndefined();
    expect(cards.length).toBeGreaterThan(0);
  });

  it("finds a card in a worktree when the folder has no decisions/ folder", async () => {
    const { main, wt, project } = await repoWithWorktree();
    await rm(join(main, "decisions"), { recursive: true });
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "0001");
    expect(found.ok && found.card.path).toBe(join(wt, "decisions", "0001-offline-storage.md"));
    // A card that is nowhere is just not there, not "decisions/ does not exist".
    await expect(findCard(hub, "20261116none")).rejects.toThrow(/no card "20261116none"/);
    // No error while a worktree has a decisions/ folder: the folder's branch has no cards.
    const loaded = await loadProjectCards(hub);
    expect(loaded.error).toBeUndefined();
    expect(loaded.cards.length).toBeGreaterThan(0);
    // With none anywhere, the folder's problem is the project's error.
    await rm(join(wt, "decisions"), { recursive: true });
    expect((await loadProjectCards(hub)).error).toMatch(/does not exist/);
  });
});

describe("checkouts' problems", () => {
  it("doesn't follow a worktree's decisions/ that links outside it", async () => {
    const { wt, project } = await repoWithWorktree();
    const outside = await tempDir();
    await writeFile(join(outside, "20261116zzzz-outside.md"), cardText({ id: '"20261116zzzz"' }));
    await rm(join(wt, "decisions"), { recursive: true });
    await symlink(outside, join(wt, "decisions"), "junction");
    const hub = await withCheckouts(project);
    const { cards, error } = await loadProjectCards(hub);
    expect(error).toBeUndefined();
    expect(cards.some((c) => c.id === "20261116zzzz")).toBe(false);
    await expect(findCard(hub, "20261116zzzz")).rejects.toThrow(/no card/);
  });

  it("prefers a copy that reads as a card, and lists a broken file once", async () => {
    const { main, wt, project } = await repoWithWorktree();
    await writeFile(join(main, "decisions", "0001-offline-storage.md"), "---\nnot: [yaml\n");
    await writeFile(join(main, "decisions", "0009-broken.md"), "no frontmatter\n");
    await writeFile(join(wt, "decisions", "0009-broken.md"), "no frontmatter\n");
    const hub = await withCheckouts(project);
    const { cards, broken } = await loadProjectCards(hub);
    expect(cards.find((c) => c.id === "0001")?.branch).toBe("feat");
    expect(broken.filter((b) => b.fileName === "0009-broken.md")).toHaveLength(1);
    // The broken copy of 0001 isn't listed: the card is.
    expect(broken.some((b) => b.id === "0001")).toBe(false);
    const found = await findCard(hub, "0001");
    expect(found.ok && found.card.path).toBe(join(wt, "decisions", "0001-offline-storage.md"));
  });

  it("shows the copy changed last when their activity ties", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const file = join(wt, "decisions", "0002-api-errors.md");
    // An agent's `update` (new wording) adds no timestamp to the frontmatter.
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/^title: .*$/m, "title: Reworded question"));
    const later = new Date(Date.now() + 60_000);
    await utimes(file, later, later);
    const hub = await withCheckouts(project);
    const found = await findCard(hub, "0002");
    expect(found.ok && found.card.path).toBe(file);
    // The other way round, the folder's copy wins.
    const folderCopy = join(main, "decisions", "0002-api-errors.md");
    const evenLater = new Date(Date.now() + 120_000);
    await writeFile(
      folderCopy,
      (await readFile(folderCopy, "utf8")).replace(/^title: .*$/m, "title: Other"),
    );
    await utimes(folderCopy, evenLater, evenLater);
    const again = await findCard(hub, "0002");
    expect(again.ok && again.card.path).toBe(folderCopy);
  });
});

describe("a broken file next to a card with its id", () => {
  it("is listed, in a single folder as across checkouts", async () => {
    const { main, project } = await repoWithWorktree();
    await writeFile(join(main, "decisions", "0001-broken.md"), "no frontmatter\n");
    for (const scope of [project, await withCheckouts(project)]) {
      const { cards, broken } = await loadProjectCards(scope);
      expect(cards.some((c) => c.id === "0001")).toBe(true);
      expect(broken.some((b) => b.fileName === "0001-broken.md")).toBe(true);
    }
  });
});

describe("the same id on two branches", () => {
  it("is two broken cards when they are different cards", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const id = '"20261116dupe"';
    await writeFile(join(main, "decisions", "20261116dupe-one.md"), cardText({ id }));
    await writeFile(
      join(wt, "decisions", "20261116dupe-two.md"),
      cardText({ id, title: "Another question", created: "2026-11-16T01:00:00Z" }),
    );
    const hub = await withCheckouts(project);
    const { cards, broken } = await loadProjectCards(hub);
    expect(cards.some((c) => c.id === "20261116dupe")).toBe(false);
    // The registered folder's own branch isn't shown.
    expect(broken.filter((b) => b.id === "20261116dupe").map((b) => b.branch)).toEqual([
      null,
      "feat",
    ]);
    expect(broken[0]?.errors[0]).toMatch(/is also used by a different card/);
    const found = await findCard(hub, "20261116dupe");
    expect(found.ok).toBe(false);
  });

  it("names only the other card, not its own copies, in each error", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const third = resolve(main, "..", "trips-third");
    await git(main, "worktree", "add", "-q", "-b", "third", third);
    const id = '"20261116trio"';
    await writeFile(join(main, "decisions", "20261116trio-one.md"), cardText({ id }));
    await writeFile(join(wt, "decisions", "20261116trio-one.md"), cardText({ id }));
    await writeFile(
      join(third, "decisions", "20261116trio-two.md"),
      cardText({ id, title: "Another question", created: "2026-11-16T01:00:00Z" }),
    );
    const { broken } = await loadProjectCards(await withCheckouts(project));
    const mine = broken.filter((b) => b.id === "20261116trio");
    // The two copies of one card are one entry: the same file, the same error.
    expect(mine.map((b) => b.fileName)).toEqual(["20261116trio-one.md", "20261116trio-two.md"]);
    expect(mine[0]?.errors[0]).toMatch(/a different card, 20261116trio-two\.md on third;/);
    expect(mine[1]?.errors[0]).toMatch(
      /a different card, 20261116trio-one\.md on main, 20261116trio-one\.md on feat;/,
    );
  });

  it("is one card when a renamed copy ties two copies together", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const third = resolve(main, "..", "trips-third");
    await git(main, "worktree", "add", "-q", "-b", "third", third);
    const id = '"20261116link"';
    // x at t1, y at t2, and x at t2: the last links the first two.
    await writeFile(join(main, "decisions", "20261116link-x.md"), cardText({ id }));
    await writeFile(
      join(wt, "decisions", "20261116link-y.md"),
      cardText({ id, created: "2026-11-16T01:00:00Z" }),
    );
    await writeFile(
      join(third, "decisions", "20261116link-x.md"),
      cardText({ id, created: "2026-11-16T01:00:00Z" }),
    );
    const { cards, broken } = await loadProjectCards(await withCheckouts(project));
    expect(cards.filter((c) => c.id === "20261116link")).toHaveLength(1);
    expect(broken.some((b) => b.id === "20261116link")).toBe(false);
  });

  it("is one card when an agent renamed its file on its branch", async () => {
    const { main, wt, project } = await repoWithWorktree();
    const id = '"20261116move"';
    await writeFile(join(main, "decisions", "20261116move-old-name.md"), cardText({ id }));
    await writeFile(join(wt, "decisions", "20261116move-new-name.md"), cardText({ id }));
    const { cards, broken } = await loadProjectCards(await withCheckouts(project));
    expect(cards.filter((c) => c.id === "20261116move")).toHaveLength(1);
    expect(broken.some((b) => b.id === "20261116move")).toBe(false);
  });
});

describe("pickCopy", () => {
  it("takes the registered folder's of identical copies, wherever it is in the list", async () => {
    const { project, wt } = await repoWithWorktree();
    const a = await findCard(await withCheckouts(project), "0002");
    if (!a.ok) throw new Error("broken");
    expect(a.card).toMatchObject({
      registered: true,
      path: join(project.path, "decisions", "0002-api-errors.md"),
    });
    const b = {
      ...a.card,
      registered: false,
      path: join(wt, "decisions", "0002-api-errors.md"),
      changedMs: 0,
    };
    expect(pickCopy([a.card, b])).toBe(a.card);
    expect(pickCopy([b, a.card])).toBe(a.card);
  });

  it("prefers a named branch to a detached HEAD, then the oldest file, never git's path order", async () => {
    const { main, wt: feat, project } = await repoWithWorktree();
    // A card only on branch feat, and two more worktrees with it: a detached reviewer's,
    // whose path sorts first, and a stacked branch's, made later.
    const file = "20261124copy-question.md";
    await writeFile(join(feat, "decisions", file), cardText({ id: '"20261124copy"' }));
    await git(feat, "add", ".");
    await git(feat, "commit", "-qm", "card");
    const reviewer = resolve(main, "..", "trips-0-review");
    await git(main, "worktree", "add", "-q", "--detach", reviewer, "feat");
    const stacked = resolve(main, "..", "trips-1-stacked");
    await git(main, "worktree", "add", "-q", "-b", "stacked", stacked, "feat");
    const hub = await withCheckouts(project);
    // git lists the worktrees by path: the detached one comes before feat's.
    expect(hub.checkouts.map((c) => c.path)).toEqual([main, reviewer, stacked, feat]);

    const found = await findCard(hub, "20261124copy");
    if (!found.ok) throw new Error("broken");
    // Not the detached copy, and of the named branches the oldest file: feat's.
    expect(found.card.path).toBe(join(feat, "decisions", file));
    const { cards } = await loadProjectCards(hub);
    expect(cards.find((c) => c.id === "20261124copy")?.path).toBe(join(feat, "decisions", file));

    // An answer goes there, and that copy stays the one shown.
    await actOnCard(
      hub,
      "20261124copy",
      { type: "resolve", choice: "custom", note: "Yes." },
      { revision: found.card.revision },
    );
    expect(await readFile(join(feat, "decisions", file), "utf8")).toMatch(/status: resolved/);
    expect(await readFile(join(reviewer, "decisions", file), "utf8")).not.toMatch(/resolved/);
    const after = await findCard(hub, "20261124copy");
    expect(after.ok && after.card.path).toBe(join(feat, "decisions", file));

    // With only detached copies, the oldest file wins.
    const one = { ...found.card, branch: null, registered: false, changedMs: 2, path: "a" };
    const two = { ...found.card, branch: null, registered: false, changedMs: 1, path: "b" };
    expect(pickCopy([one, two])).toBe(two);
    expect(pickCopy([two, one])).toBe(two);
  });
});
