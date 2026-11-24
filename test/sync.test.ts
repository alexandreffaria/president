/**
 * Sync (card 20261116d34o, pull-only) against scratch repositories: it pulls main and never
 * commits or pushes, and every check and failure path of server/sync/sequence.ts. Each test
 * builds its own remote and two clones in a temp folder (see git-sandbox.ts); nothing here
 * runs git anywhere else.
 */
import { execFileSync } from "node:child_process";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type Socket, type Server as TcpServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { revisionOf } from "../src/server/cards.ts";
import { gitEnv, localEnvVars, runGit } from "../src/server/git.ts";
import { syncRepo, syncRepoDetailed } from "../src/server/sync/sequence.ts";
import { fetchRepo, repoStatus } from "../src/server/sync/status.ts";
import { gitSandbox, type Sandbox } from "./git-sandbox.ts";

// Each test runs a few dozen git commands; with several suites at once on a busy machine that
// can take a while.
vi.setConfig({ testTimeout: 90_000 });

/** The laptop's starting point in most tests: an answer, and an agent's work in progress. */
async function answerAndAgentWork(s: Sandbox) {
  await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\nnote: from laptop\n");
  await s.write(s.laptop, "lib.js", "y = wip\n");
}

/** The other machine pushes a change. */
async function desktopPushes(s: Sandbox, files: Record<string, string>, message = "desktop") {
  for (const [file, text] of Object.entries(files)) await s.write(s.desktop, file, text);
  s.push(s.desktop, message);
}

/** A card change merged on the remote, for Sync to pull. */
const desktopChangesACard = (s: Sandbox) =>
  desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });

/** What must hold when Sync says "not now": nothing at all changed. */
function snapshot(s: Sandbox) {
  return {
    head: s.head(s.laptop),
    status: s.status(s.laptop),
    stash: s.stashCount(s.laptop),
    remote: s.remoteLog(),
  };
}

/** Installs a hook for the laptop (in a folder outside the repository). */
async function hook(s: Sandbox, name: string, script: string) {
  const hooks = join(s.root, "hooks");
  await s.write(s.root, `hooks/${name}`, `#!/bin/sh\n${script}\n`);
  await chmod(join(hooks, name), 0o755);
  s.git(s.laptop, "config", "core.hooksPath", hooks);
}

/** Runs git where it is expected to fail (a conflict), and returns nothing. */
function gitFails(s: Sandbox, cwd: string, ...args: string[]) {
  expect(() => s.git(cwd, ...args)).toThrow();
}

describe("the git environment", () => {
  it("removes the inherited variables that point git elsewhere and turns prompts off", () => {
    const env = gitEnv(
      { EXTRA: "1" },
      {
        PATH: "/bin",
        GIT_DIR: "/elsewhere/.git",
        GIT_WORK_TREE: "/elsewhere",
        git_dir: "x",
        GIT_INDEX_FILE: "/elsewhere/.git/index",
        GIT_CONFIG_PARAMETERS: "'core.hooksPath'='/x'",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/x",
        GIT_EXEC_PATH: "/elsewhere/libexec",
        GIT_OBJECT_DIRECTORY: "/elsewhere/objects",
        GIT_COMMON_DIR: "/elsewhere/.git",
        GIT_LITERAL_PATHSPECS: "1",
        GIT_GLOB_PATHSPECS: "1",
        GIT_NOGLOB_PATHSPECS: "1",
        GIT_ICASE_PATHSPECS: "1",
      },
    );
    for (const name of [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "git_dir",
      "GIT_INDEX_FILE",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_EXEC_PATH",
      "GIT_OBJECT_DIRECTORY",
      "GIT_COMMON_DIR",
      "GIT_LITERAL_PATHSPECS",
      "GIT_GLOB_PATHSPECS",
      "GIT_NOGLOB_PATHSPECS",
      "GIT_ICASE_PATHSPECS",
    ]) {
      expect(env[name], name).toBeUndefined();
    }
    expect(env).toMatchObject({
      PATH: "/bin",
      EXTRA: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GIT_OPTIONAL_LOCKS: "0",
    });
  });

  it("keeps the user's own git setup (S-6)", () => {
    const own = {
      GIT_SSH_COMMAND: "ssh -i ~/.ssh/work_key",
      GIT_SSH: "/usr/bin/ssh",
      GIT_CONFIG_GLOBAL: "/home/me/.gitconfig-work",
      GIT_SSL_CAINFO: "/etc/corp-ca.pem",
      GIT_AUTHOR_NAME: "Me",
      GIT_COMMITTER_EMAIL: "me@example.com",
    };
    expect(gitEnv({}, { PATH: "/bin", ...own })).toMatchObject(own);
  });

  it("removes everything the installed git lists in --local-env-vars", () => {
    const listed = execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean);
    expect(listed.length).toBeGreaterThan(5);
    const env = gitEnv({}, Object.fromEntries(listed.map((name) => [name, "x"])));
    for (const name of listed) {
      expect(localEnvVars().has(name), name).toBe(true);
      expect(env[name], name).toBeUndefined();
    }
  });

  it("passes GIT_SSH_COMMAND from the hub's environment on to git", async () => {
    const s = await gitSandbox();
    vi.stubEnv("GIT_SSH_COMMAND", "ssh -i /keys/second-account");
    try {
      const result = await runGit(
        s.laptop,
        ["-c", "alias.ssh-command=!printenv GIT_SSH_COMMAND", "ssh-command"],
        s.options,
      );
      expect(result.stdout.trim()).toBe("ssh -i /keys/second-account");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("ignores a GIT_DIR inherited from the hub's own environment", async () => {
    const s = await gitSandbox();
    const other = await gitSandbox();
    await desktopChangesACard(s);
    await desktopChangesACard(other);
    other.git(other.laptop, "fetch", "--quiet");
    const before = other.head(other.laptop);
    vi.stubEnv("GIT_DIR", join(other.laptop, ".git"));
    vi.stubEnv("GIT_WORK_TREE", other.laptop);
    try {
      const result = await syncRepo(s.laptop, "shop", s.options);
      expect(result.outcome).toBe("pulled");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(other.head(other.laptop)).toBe(before);
    expect(other.status(other.laptop)).toEqual([]);
    expect(s.head(s.laptop)).toBe(s.head(s.desktop));
  });

  it("stops a git command that runs past its timeout, with whatever it started", async () => {
    const s = await gitSandbox();
    const started = Date.now();
    // An alias to a shell command that would run for a minute.
    const result = await runGit(s.laptop, ["-c", "alias.wait=!sleep 60", "wait"], {
      ...s.options,
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
    expect(result.code).toBeNull();
    expect(result.stderr).toMatch(/took longer than 0\.5 s and was stopped/);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("Sync: the clean case", () => {
  it("pulls main, and leaves the answers and the agent's work uncommitted", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n", "app.js": "x = 2\n" });
    await answerAndAgentWork(s);
    // A new card an agent wrote and git doesn't track yet, and a file the agent staged.
    await s.write(s.laptop, "decisions/0003-new.md", "status: open\n");
    await s.write(s.laptop, "staged.js", "z = 1\n");
    s.git(s.laptop, "add", "staged.js");
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toEqual({ outcome: "pulled", message: "Pulled 0002", pulled: ["0002"] });
    // A fast-forward to the desktop's commit: no commit of Sync's own, nothing pushed.
    expect(s.head(s.laptop)).toBe(s.head(s.desktop));
    expect(s.remoteLog()).toEqual(remoteBefore);
    // The answer, the new card and the agent's work are all still uncommitted (staged.js
    // still staged); the desktop's changes are in.
    expect(s.status(s.laptop)).toEqual([
      " M decisions/0001-colour.md",
      " M lib.js",
      "?? decisions/0003-new.md",
      "A  staged.js",
    ]);
    expect(await s.read(s.laptop, "decisions/0001-colour.md")).toBe(
      "status: resolved\nnote: from laptop\n",
    );
    expect(await s.read(s.laptop, "app.js")).toBe("x = 2\n");
    expect(await s.read(s.laptop, "decisions/0002-size.md")).toBe("status: deferred\n");
    expect(s.stashCount(s.laptop)).toBe(0);
    expect(await repoStatus(s.laptop, s.options)).toEqual({ remoteChanges: 0 });
  });

  it("has nothing to do when the remote changed no card, even with answers here", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "app.js": "x = 2\n" });
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toEqual({ outcome: "nothing", message: "Nothing to pull", pulled: [] });
    expect(snapshot(s)).toEqual(before);
  });

  it("a second Sync changes nothing", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("pulled");
    const before = snapshot(s);

    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("nothing");
    expect(snapshot(s)).toEqual(before);
  });

  it("records what the pull brought in, at the revision it brought (S2-2)", async () => {
    const s = await gitSandbox();
    const desktopText = "status: deferred\nnote: desktop\n";
    await desktopPushes(s, { "decisions/0002-size.md": desktopText, "app.js": "x = 2\n" });

    const run = await syncRepoDetailed(s.laptop, "shop", s.options);

    expect(run).toMatchObject({ result: { outcome: "pulled" }, fetched: true });
    expect(run.broughtIn).toEqual([
      { path: "decisions/0002-size.md", revision: revisionOf(desktopText) },
    ]);
  });
});

describe("Sync: the checks say not now and change nothing", () => {
  it("refuses while main has commits that aren't on the remote", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    await s.write(s.laptop, "app.js", "x = agent\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "agent work");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe("Not now: main in shop has commits that aren't on origin/main");
    expect(result.action).toMatch(/once they are pushed/);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses an unpushed commit of cards only, or an empty one, too", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "an agent's answer commit");
    let before = snapshot(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).message).toMatch(
      /has commits that aren't on origin\/main/,
    );
    expect(snapshot(s)).toEqual(before);

    s.git(s.laptop, "reset", "--quiet", "--hard", "HEAD~1");
    s.git(s.laptop, "commit", "--quiet", "--allow-empty", "-m", "agent: empty");
    before = snapshot(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("not-now");
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses when the remote changed a file the agent has uncommitted edits to", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "app.js": "x = remote\n", "decisions/0002-size.md": "x\n" });
    await s.write(s.laptop, "app.js", "x = wip\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: app.js in shop has uncommitted changes here and changed on the remote",
      action: "Nothing was changed. Press Sync again once those changes are committed or put away.",
    });
    expect(snapshot(s)).toEqual(before);
    expect(await s.read(s.laptop, "app.js")).toBe("x = wip\n");
  });

  it("refuses when the remote changed a card answered here, and keeps the answer", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0001-colour.md": "status: resolved\nnote: desktop\n" });
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.message).toBe(
      "Not now: decisions/0001-colour.md in shop has uncommitted changes here and changed on the remote",
    );
    expect(snapshot(s)).toEqual(before);
    expect(await s.read(s.laptop, "decisions/0001-colour.md")).toBe(
      "status: resolved\nnote: from laptop\n",
    );
  });

  // Windows can't have a file named " " (it drops trailing spaces from names).
  it.skipIf(process.platform === "win32")(
    "refuses when the file both changed is named with only a space (S7-4)",
    async () => {
      const s = await gitSandbox();
      await s.write(s.laptop, " ", "x\n");
      s.push(s.laptop, "a file named space");
      s.git(s.desktop, "pull", "--quiet");
      await desktopPushes(s, { " ": "x = remote\n", "decisions/0002-size.md": "x\n" });
      await s.write(s.laptop, " ", "x = wip\n");
      const before = snapshot(s);

      const result = await syncRepo(s.laptop, "shop", s.options);

      expect(result.outcome).toBe("not-now");
      expect(snapshot(s)).toEqual(before);
    },
  );

  it("refuses when the remote renamed a file the agent has uncommitted edits to (S7-1)", async () => {
    const s = await gitSandbox();
    s.git(s.desktop, "mv", "lib.js", "lib2.js");
    await desktopChangesACard(s);
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toMatch(/^Not now: lib\.js in shop has uncommitted changes/);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses when a staged rename here moves a file the remote changed (S7-1)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "lib.js": "y = remote\n", "decisions/0002-size.md": "x\n" });
    s.git(s.laptop, "mv", "lib.js", "lib2.js");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toMatch(/^Not now: lib\.js in shop has uncommitted changes/);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses when the agent's edit to a file the remote changed is staged (S7-1)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "lib.js": "y = remote\n", "decisions/0002-size.md": "x\n" });
    await answerAndAgentWork(s);
    s.git(s.laptop, "add", "lib.js");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toMatch(/^Not now: lib\.js in shop has uncommitted changes/);
    expect(snapshot(s)).toEqual(before);
    expect(await s.read(s.laptop, "lib.js")).toBe("y = wip\n");
  });

  it("finds the clash on a file name that isn't UTF-8 (S6-1)", async ({ skip }) => {
    const s = await gitSandbox();
    // n\xe9.js: é in Latin-1. Some file systems (APFS, for one) refuse such a name.
    const latin1 = (repo: string) =>
      Buffer.concat([Buffer.from(`${repo}/n`), Buffer.from([0xe9]), Buffer.from(".js")]);
    try {
      await writeFile(latin1(s.laptop), "z = 1\n");
    } catch {
      skip("this file system refuses a file name that isn't UTF-8");
    }
    s.push(s.laptop, "a Latin-1 name");
    s.git(s.desktop, "pull", "--quiet");
    await writeFile(latin1(s.desktop), "z = remote\n");
    await desktopChangesACard(s);
    await writeFile(latin1(s.laptop), "z = wip\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toMatch(/^Not now: n.+\.js in shop has uncommitted changes/);
    expect(snapshot(s)).toEqual(before);
    expect(await readFile(latin1(s.laptop), "utf8")).toBe("z = wip\n");
  });

  it("refuses on any branch but the remote's default", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    // Branched from origin/main, so it even tracks origin/main.
    s.git(s.laptop, "checkout", "--quiet", "-b", "feat/x", "--track", "origin/main");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe("Not now: shop has the branch feat/x checked out, not main");
    expect(result.action).toBe(
      "Sync pulls only while main is checked out; press Sync again once it is. Cards on feat/x travel with its pull request.",
    );
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses when main tracks something other than the remote's main", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "push", "--quiet", "origin", "main:other");
    s.git(s.laptop, "branch", "--quiet", "--set-upstream-to=origin/other");
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: main in shop tracks origin/other, not origin/main",
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses while a merge is in progress", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "checkout", "--quiet", "-b", "side");
    await s.write(s.laptop, "side.js", "side\n");
    s.git(s.laptop, "add", "side.js");
    s.git(s.laptop, "commit", "--quiet", "-m", "side");
    s.git(s.laptop, "checkout", "--quiet", "main");
    s.git(s.laptop, "merge", "--quiet", "--no-ff", "--no-commit", "side");
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: a merge is in progress in shop",
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses without an upstream branch, and says how to set one", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "branch", "--unset-upstream");
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe(
      "Not now: the branch main in shop has no upstream branch to pull from",
    );
    expect(result.action).toMatch(/git branch -u origin\/main/);
    expect(result.action).toMatch(/If it is a feature branch, Sync doesn't pull it/);
    expect(snapshot(s)).toEqual(before);
  });

  it("has nothing to do in a repository without a remote", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "remote", "remove", "origin");
    const before = snapshot(s);
    expect(await syncRepo(s.laptop, "shop", s.options)).toMatchObject({
      outcome: "nothing",
      message: "Nothing to pull: it has no remote",
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses with a detached HEAD", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "checkout", "--quiet", "--detach");
    expect(await syncRepo(s.laptop, "shop", s.options)).toMatchObject({
      outcome: "not-now",
      message: "Not now: shop has no branch checked out (a detached HEAD)",
    });
  });

  it("refuses a remote named like an option, and changes nothing (M1)", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "config", "remote.-x.url", "../remote.git");
    s.git(s.laptop, "config", "remote.-x.fetch", "+refs/heads/*:refs/remotes/-x/*");
    s.git(s.laptop, "fetch", "--quiet", "../remote.git", "+refs/heads/*:refs/remotes/-x/*");
    s.git(s.laptop, "symbolic-ref", "refs/remotes/-x/HEAD", "refs/remotes/-x/main");
    s.git(s.laptop, "config", "branch.main.remote", "-x");
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: couldn't tell which branch is the main branch of the remote of shop",
    });
    expect(result.gitError).toBeUndefined();
    expect(snapshot(s)).toEqual(before);
  });

  it("works only in a folder that is the top of a git repository", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    const before = snapshot(s);
    const result = await syncRepo(join(s.laptop, "decisions"), "inner", s.options);
    expect(result).toMatchObject({
      outcome: "unavailable",
      message: "Not pulled: inner is skipped because it isn't the top folder of a git repository",
    });
    expect(snapshot(s)).toEqual(before);
    const none = await syncRepo(join(s.root, "home"), "plain", s.options);
    expect(none).toMatchObject({
      outcome: "unavailable",
      message: "Not pulled: plain is skipped because it isn't the top folder of a git repository",
    });
  });
});

describe("Sync waits for any git operation in progress (S-3)", () => {
  it("refuses during a cherry-pick and leaves it to be continued", async () => {
    const s = await gitSandbox();
    // An agent's cherry-pick that stopped on a conflict, which it has resolved but not
    // committed yet: nothing is unmerged, only CHERRY_PICK_HEAD says it isn't finished.
    s.git(s.laptop, "checkout", "--quiet", "-b", "side");
    await s.write(s.laptop, "lib.js", "y = side\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "side");
    s.git(s.laptop, "checkout", "--quiet", "main");
    await desktopPushes(s, { "lib.js": "y = remote\n" });
    s.git(s.laptop, "pull", "--quiet");
    gitFails(s, s.laptop, "cherry-pick", "side");
    await s.write(s.laptop, "lib.js", "y = resolved\n");
    s.git(s.laptop, "add", "lib.js");
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: a cherry-pick is in progress in shop",
    });
    expect(snapshot(s)).toEqual(before);
    expect(s.git(s.laptop, "rev-parse", "--verify", "CHERRY_PICK_HEAD").trim()).toBe(
      s.git(s.laptop, "rev-parse", "side").trim(),
    );
  });

  it("refuses during a revert, a series of picks and a bisect", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "lib.js": "y = 2\n" }, "two");
    await desktopPushes(s, { "lib.js": "y = 3\n" }, "three");
    s.git(s.laptop, "pull", "--quiet");
    gitFails(s, s.laptop, "revert", "HEAD~1");
    await s.write(s.laptop, "lib.js", "y = resolved\n");
    s.git(s.laptop, "add", "lib.js");
    await desktopChangesACard(s);
    let before = snapshot(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).message).toBe(
      "Not now: a revert is in progress in shop",
    );
    expect(snapshot(s)).toEqual(before);
    s.git(s.laptop, "revert", "--abort");

    // What a series of picks keeps between its steps (git rev-parse --git-path sequencer).
    const sequencer = s.git(s.laptop, "rev-parse", "--git-path", "sequencer").trim();
    await s.write(s.laptop, `${sequencer}/todo`, "pick 0000000 x\n");
    before = snapshot(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).message).toBe(
      "Not now: a series of cherry-picks or reverts is in progress in shop",
    );
    expect(snapshot(s)).toEqual(before);
    await rm(join(s.laptop, sequencer), { recursive: true });

    s.git(s.laptop, "bisect", "start");
    before = snapshot(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).message).toBe(
      "Not now: a bisect is in progress in shop",
    );
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses a rebase in progress", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "lib.js": "y = remote\n" });
    await s.write(s.laptop, "lib.js", "y = mine\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "an agent's commit");
    gitFails(s, s.laptop, "pull", "--quiet", "--rebase");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: a rebase is in progress in shop",
      action: `Press Sync again once it is finished or aborted (git status in ${s.laptop} shows it).`,
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses while files have unresolved conflicts", async () => {
    const s = await gitSandbox();
    // An agent's stash pop that conflicted: lib.js has unmerged entries.
    await s.write(s.laptop, "lib.js", "y = wip\n");
    s.git(s.laptop, "stash", "push", "--quiet", "-m", "agent");
    await desktopPushes(s, { "lib.js": "y = remote\n" });
    s.git(s.laptop, "pull", "--quiet");
    gitFails(s, s.laptop, "stash", "pop");
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: lib.js in shop has unresolved conflicts",
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("checks again right before the pull (an agent may start one during the fetch)", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    await answerAndAgentWork(s);
    // When the fetch updates origin/main, an agent's cherry-pick stops on a conflict
    // (CHERRY_PICK_HEAD written by the hook stands in for it).
    const done = join(s.root, "picked");
    await hook(
      s,
      "reference-transaction",
      [
        '[ "$1" = committed ] || exit 0',
        `[ -e "${done}" ] && exit 0`,
        `touch "${done}"`,
        'git rev-parse HEAD > "$(git rev-parse --git-path CHERRY_PICK_HEAD)"',
      ].join("\n"),
    );
    const head = s.head(s.laptop);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: expect.stringMatching(/a cherry-pick is in progress/),
    });
    expect(s.head(s.laptop)).toBe(head);
    expect(s.status(s.laptop)).toEqual([" M decisions/0001-colour.md", " M lib.js"]);
  });

  it("doesn't pull when the checkout moved to another branch during the fetch", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    const done = join(s.root, "switched");
    await hook(
      s,
      "reference-transaction",
      [
        '[ "$1" = committed ] || exit 0',
        `[ -e "${done}" ] && exit 0`,
        `touch "${done}"`,
        "git checkout --quiet -b elsewhere",
      ].join("\n"),
    );
    const head = s.head(s.laptop);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: the checkout in shop changed during Sync",
    });
    expect(s.git(s.laptop, "branch", "--show-current").trim()).toBe("elsewhere");
    expect(s.head(s.laptop)).toBe(head);
    expect(s.git(s.laptop, "rev-parse", "main").trim()).toBe(head);
  });
});

describe("Sync leaves untracked and ignored files to git (round 4)", () => {
  it("lets the remote replace a tracked folder with a file (S2-1)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "foo/a.js": "a\n" }, "a folder");
    s.git(s.laptop, "pull", "--quiet");
    s.git(s.desktop, "rm", "--quiet", "-r", "foo");
    await desktopPushes(s, { foo: "now a file\n", "decisions/0002-size.md": "x\n" });

    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("pulled");
    expect(await s.read(s.laptop, "foo")).toBe("now a file\n");
  });

  it("lets the remote replace a tracked file with a folder (S2-1)", async () => {
    const s = await gitSandbox();
    s.git(s.desktop, "rm", "--quiet", "app.js");
    await desktopPushes(s, { "app.js/index.js": "x = 2\n", "decisions/0002-size.md": "x\n" });

    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("pulled");
    expect(await s.read(s.laptop, "app.js/index.js")).toBe("x = 2\n");
  });

  it("leaves an untracked file where the remote adds one to git, which refuses (round 4)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "new.js": "remote\n", "decisions/0002-size.md": "x\n" });
    await s.write(s.laptop, "new.js", "mine\n");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "failed",
      message:
        "Not pulled: a file here that git doesn't track is where the online copy puts one (git names it below)",
      action: "Nothing was changed. Move or commit that file (an agent's?), then press Sync again.",
    });
    expect(result.gitError).toMatch(/new\.js/);
    expect(await s.read(s.laptop, "new.js")).toBe("mine\n");
    expect(snapshot(s)).toEqual(before);
  });

  it("leaves an untracked file in a folder the remote replaces to git, which refuses (round 4)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "foo/a.js": "a\n" }, "a folder");
    s.git(s.laptop, "pull", "--quiet");
    await s.write(s.laptop, "foo/agent-notes.txt", "LOCAL AGENT DATA\n");
    s.git(s.desktop, "rm", "--quiet", "-r", "foo");
    await desktopPushes(s, { foo: "now a file\n", "decisions/0002-size.md": "x\n" });
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "failed",
      message:
        "Not pulled: a file here that git doesn't track is where the online copy puts one (git names it below)",
    });
    expect(result.gitError).toMatch(/untracked/);
    expect(await s.read(s.laptop, "foo/agent-notes.txt")).toBe("LOCAL AGENT DATA\n");
    expect(snapshot(s)).toEqual(before);
  });
});

describe("Sync: the network", () => {
  it("reports a fetch that fails (no remote any more) and changes nothing", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    s.git(s.laptop, "remote", "set-url", "origin", join(s.root, "gone.git"));
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "failed",
      message: "Not pulled: couldn't fetch from the remote of shop",
    });
    expect(result.gitError).toMatch(/gone\.git/);
    expect(result.action).toMatch(/Nothing was changed/);
    expect(snapshot(s)).toEqual(before);
  });

  it("never prompts for a password: an authentication failure ends at once", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    const server = await listen(
      createServer((_request, response) => {
        response.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
        response.end();
      }),
    );
    try {
      s.git(s.laptop, "remote", "set-url", "origin", `http://127.0.0.1:${port(server)}/repo.git`);
      const before = snapshot(s);
      const started = Date.now();

      const result = await syncRepo(s.laptop, "shop", s.options);

      expect(result.outcome).toBe("failed");
      expect(result.gitError).toMatch(/terminal prompts disabled|could not read Username/);
      // It ended by itself, long before the timeout would have stopped a waiting prompt.
      expect(result.gitError).not.toMatch(/took longer/);
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(snapshot(s)).toEqual(before);
    } finally {
      await close(server);
    }
  });

  it("stops a remote that never answers after the timeout and changes nothing", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    const sockets = new Set<Socket>();
    const server = await listen(
      createTcpServer((socket) => {
        sockets.add(socket); // Accept, then say nothing.
        // Windows resets the connection of a git that was stopped.
        socket.on("error", () => {});
      }),
    );
    try {
      s.git(s.laptop, "remote", "set-url", "origin", `http://127.0.0.1:${port(server)}/repo.git`);
      const before = snapshot(s);
      const started = Date.now();

      const result = await syncRepo(s.laptop, "shop", { ...s.options, networkTimeoutMs: 1000 });

      expect(result.outcome).toBe("failed");
      expect(result.gitError).toMatch(/git fetch took longer than 1 s and was stopped/);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(snapshot(s)).toEqual(before);
    } finally {
      for (const socket of sockets) socket.destroy();
      await close(server);
    }
  });

  it("shows git's error when the pull itself fails", async () => {
    const s = await gitSandbox();
    await desktopChangesACard(s);
    // Once the fetch has moved origin/main, an agent's git takes the index lock.
    await hook(
      s,
      "reference-transaction",
      [
        '[ "$1" = committed ] || exit 0',
        'grep -q " refs/remotes/origin/main$" || exit 0',
        'touch "$(git rev-parse --git-path index.lock)"',
      ].join("\n"),
    );

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "failed",
      message: "Not pulled: the pull failed in shop",
      action: "Fix what git reports, then press Sync again.",
    });
    expect(result.gitError).toMatch(/index\.lock/);
  });
});

describe("the fetch at hub start and the count", () => {
  it("fetch changes no file and no branch, then counts the remote's card changes", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, {
      "decisions/0002-size.md": "status: deferred\n",
      "decisions/0005-other.md": "status: open\n",
      "app.js": "x = 2\n",
    });
    await answerAndAgentWork(s);
    expect(await repoStatus(s.laptop, s.options)).toEqual({ remoteChanges: 0 });
    const before = { head: s.head(s.laptop), status: s.status(s.laptop) };

    expect(await fetchRepo(s.laptop, s.options)).toEqual({});

    expect({ head: s.head(s.laptop), status: s.status(s.laptop) }).toEqual(before);
    // The two cards the desktop changed (app.js isn't a card).
    expect(await repoStatus(s.laptop, s.options)).toEqual({ remoteChanges: 2 });
  });

  it("reports a fetch that fails instead of failing", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "remote", "set-url", "origin", join(s.root, "gone.git"));
    const fetched = await fetchRepo(s.laptop, s.options);
    expect(fetched.error).toMatch(/gone\.git/);
  });

  it("skips folders that aren't a repository's top folder", async () => {
    const s = await gitSandbox();
    expect(await fetchRepo(join(s.laptop, "decisions"), s.options)).toEqual({});
    expect(await repoStatus(join(s.root, "home"), s.options)).toEqual({
      unavailable: "it isn't the top folder of a git repository",
      remoteChanges: 0,
    });
  });
});

describe("Sync and submodules (round 4)", () => {
  it("skips a project with a gitlink in the index, and changes nothing", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "update-index", "--add", "--cacheinfo", `160000,${s.head(s.laptop)},sub`);
    await desktopChangesACard(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "unavailable",
      message:
        "Not pulled: shop is skipped because it has git submodules, which Sync doesn't handle",
    });
    expect(snapshot(s)).toEqual(before);
    expect(await repoStatus(s.laptop, s.options)).toEqual({
      unavailable: "it has git submodules, which Sync doesn't handle",
      remoteChanges: 0,
    });
  });

  it("still finds a gitlink with a git that doesn't know ls-files --format (S4-1)", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "update-index", "--add", "--cacheinfo", `160000,${s.head(s.laptop)},sub`);
    // A git older than 2.38: --format is an unknown option.
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    await s.write(
      s.root,
      "old-git/git",
      `#!/bin/sh\nfor a in "$@"; do case "$a" in --format=*) echo "error: unknown option" >&2; exit 129;; esac; done\nexec "${realGit}" "$@"\n`,
    );
    await chmod(join(s.root, "old-git/git"), 0o755);
    const env = { ...s.options.env, PATH: `${join(s.root, "old-git")}:${process.env.PATH ?? ""}` };

    expect(await repoStatus(s.laptop, { ...s.options, env })).toMatchObject({
      unavailable: "it has git submodules, which Sync doesn't handle",
    });
  });

  it("refuses when git's file list is cut at the output limit (S4-1)", async () => {
    const s = await gitSandbox();
    for (let i = 0; i < 200; i++) await s.write(s.laptop, `files/f${i}.txt`, "x\n");
    s.git(s.laptop, "add", "files");
    // Past the cut below: a check that read the cut list would never see it.
    s.git(s.laptop, "update-index", "--add", "--cacheinfo", `160000,${s.head(s.laptop)},zz-sub`);
    await desktopChangesACard(s);
    const before = snapshot(s);
    const options = { ...s.options, maxOutput: 400 };

    const result = await syncRepo(s.laptop, "shop", options);

    expect(result).toMatchObject({
      outcome: "unavailable",
      message:
        "Not pulled: shop is skipped because git's list of its files is too long to check for submodules",
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("skips a project whose index git can't read, and changes nothing (S4-3)", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, ".git/index", "garbage");
    await desktopChangesACard(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("unavailable");
    expect(result.message).toMatch(
      /^Not pulled: shop is skipped because git can't read it: .*index/,
    );
    expect(await repoStatus(s.laptop, s.options)).toMatchObject({
      unavailable: expect.stringMatching(/^git can't read it: .*index/),
    });
    expect(await s.read(s.laptop, ".git/index")).toBe("garbage");
  });

  it("skips a project with a .gitmodules file, and changes nothing", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, ".gitmodules", "");
    await desktopChangesACard(s);
    const before = snapshot(s);

    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("unavailable");
    expect(snapshot(s)).toEqual(before);
  });
});

describe("output cut at the limit (S4-2, S5-1, S6-2)", () => {
  const vendorFile = (i: number) => `vendor/${"long-name-".repeat(10)}${i}.js`;
  /** 50 files with long names: about 5 KB of paths. */
  function manyFiles(text: string): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[vendorFile(i)] = text;
    return files;
  }
  const small = (s: Sandbox) => ({ ...s.options, maxOutput: 1000 });

  it("runGit says when it cut stdout", async () => {
    const s = await gitSandbox();
    const cut = await runGit(s.laptop, ["log", "--format=%H"], { ...s.options, maxOutput: 10 });
    expect(cut).toMatchObject({ code: 0, truncated: true });
    expect(cut.stdout).toHaveLength(10);
    const whole = await runGit(s.laptop, ["rev-parse", "HEAD"], s.options);
    expect(whole).toMatchObject({ code: 0, truncated: false });
    // Output exactly at the limit (40 hex digits and a newline) is whole (S5-4).
    const exact = await runGit(s.laptop, ["rev-parse", "HEAD"], { ...s.options, maxOutput: 41 });
    expect(exact).toMatchObject({ code: 0, truncated: false });
    expect(exact.stdout).toHaveLength(41);
  });

  it("treats a cut list of the remote's cards as a failure, and changes nothing", async () => {
    const s = await gitSandbox();
    // New cards with long names: about 3 KB of them.
    const cards: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      cards[`decisions/${9000 + i}-${"long-name-".repeat(9)}.md`] = "status: open\n";
    }
    await desktopPushes(s, cards);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", small(s));

    expect(result).toMatchObject({
      outcome: "failed",
      message: "Not pulled: git failed in shop",
      action: `The online copy of shop changed too many cards for Sync to list. Pull by hand (git pull --ff-only in ${s.laptop}).`,
    });
    expect(result.gitError).toMatch(/^git output too large: git diff/);
    expect(snapshot(s)).toEqual(before);
  });

  it("pulls when the remote changed many files and nothing is edited here", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { ...manyFiles("v\n"), "decisions/0002-size.md": "x\n" });

    expect(await syncRepo(s.laptop, "shop", small(s))).toMatchObject({
      outcome: "pulled",
      pulled: ["0002"],
    });
  });

  it("says to commit or put away the changes here when the remote's change list is cut", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { ...manyFiles("v\n"), "decisions/0002-size.md": "x\n" });
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", small(s));

    expect(result).toMatchObject({
      outcome: "failed",
      action:
        "The online copy of shop changed too many files for Sync to compare with the uncommitted changes here. Press Sync again once those changes are committed or put away.",
    });
    expect(result.gitError).toMatch(/^git output too large: git diff/);
    expect(snapshot(s)).toEqual(before);
  });

  it("says to commit or put away the work when the files edited here are too many", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, manyFiles("v\n"));
    s.git(s.laptop, "pull", "--quiet");
    await desktopChangesACard(s);
    for (const [file, text] of Object.entries(manyFiles("edited\n"))) {
      await s.write(s.laptop, file, text);
    }
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", small(s));

    expect(result).toMatchObject({
      outcome: "failed",
      action:
        "This project has more changed files than Sync can check. Commit the work there or put it away, then press Sync again.",
    });
    expect(result.gitError).toMatch(/^git output too large: git diff/);
    expect(snapshot(s)).toEqual(before);
  });
});

describe("the pull's messages are in English (S5-3)", () => {
  /** Whether git here has a Portuguese catalogue; CI's may not, and then the test is skipped. */
  function gitSpeaksPortuguese(): boolean {
    try {
      // Read-only, outside any repository: fails with "not a git repository", or its translation.
      execFileSync("git", ["-C", "/", "rev-parse"], {
        env: { ...process.env, LC_ALL: "pt_BR.UTF-8", LANGUAGE: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      return false;
    } catch (error) {
      const stderr = String((error as { stderr?: Buffer }).stderr ?? "");
      return stderr !== "" && !stderr.includes("not a git repository");
    }
  }

  it.runIf(gitSpeaksPortuguese())(
    "names an untracked file in the way under a localized git",
    async () => {
      const s = await gitSandbox();
      await desktopPushes(s, { "new.js": "remote\n", "decisions/0002-size.md": "x\n" });
      await s.write(s.laptop, "new.js", "mine\n");
      const env = { ...s.options.env, LC_ALL: "pt_BR.UTF-8", LANGUAGE: "pt_BR" };

      const result = await syncRepo(s.laptop, "shop", { ...s.options, env });

      expect(result.message).toBe(
        "Not pulled: a file here that git doesn't track is where the online copy puts one (git names it below)",
      );
      expect(await s.read(s.laptop, "new.js")).toBe("mine\n");
    },
  );
});

const servers: (Server | TcpServer)[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

async function listen<T extends Server | TcpServer>(server: T): Promise<T> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

function port(server: Server | TcpServer): number {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("not listening");
  return address.port;
}

function close(server: Server | TcpServer): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    if ("closeAllConnections" in server) server.closeAllConnections();
    server.close(() => resolve());
  });
}
