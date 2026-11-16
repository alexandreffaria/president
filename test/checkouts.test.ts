/**
 * The hub reads a project's cards from every checkout (cards on the working branch): the
 * registered folder and each `git worktree list` entry.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { actOnCard, findCard, loadProjectCards, pickCopy } from "../src/server/cards.ts";
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
    expect(card).toMatchObject({ branch: "feat", path: join(wt, "decisions", file) });
    // The demo's cards are in both checkouts, the same: each is shown once, from the folder.
    expect(cards.filter((c) => c.id === "0001")).toEqual([
      expect.objectContaining({
        branch: "main",
        path: join(main, "decisions", "0001-offline-storage.md"),
      }),
    ]);
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

describe("pickCopy", () => {
  it("takes the first of identical copies", async () => {
    const { project, wt } = await repoWithWorktree();
    const a = await findCard(project, "0002");
    const b = await findCard({ name: "trips", path: wt }, "0002");
    if (!a.ok || !b.ok) throw new Error("broken");
    expect(pickCopy([a.card, b.card])).toBe(a.card);
    expect(pickCopy([b.card, a.card])).toBe(b.card);
  });
});
