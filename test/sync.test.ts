/**
 * Sync (card #0001) against scratch repositories: every check and failure path the card and
 * docs/roadmap.md describe. Each test builds its own remote and two clones in a temp folder
 * (see git-sandbox.ts); nothing here runs git anywhere else.
 */
import { execFileSync } from "node:child_process";
import { chmod, rename, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type Socket, type Server as TcpServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { revisionOf } from "../src/server/cards.ts";
import { gitEnv, localEnvVars, runGit } from "../src/server/git.ts";
import {
  commitMessage,
  fetchRepo,
  repoStatus,
  syncRepo,
  syncRepoDetailed,
} from "../src/server/sync.ts";
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

/** What must hold when Sync says "not now": nothing at all changed. */
function snapshot(s: Sandbox) {
  return {
    head: s.head(s.laptop),
    status: s.status(s.laptop),
    stash: s.stashCount(s.laptop),
    remote: s.remoteLog(),
  };
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
    await answerAndAgentWork(s);
    const before = other.head(other.laptop);
    vi.stubEnv("GIT_DIR", join(other.laptop, ".git"));
    vi.stubEnv("GIT_WORK_TREE", other.laptop);
    try {
      const result = await syncRepo(s.laptop, "shop", s.options);
      expect(result.outcome).toBe("synced");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(other.head(other.laptop)).toBe(before);
    expect(other.status(other.laptop)).toEqual([]);
    expect(s.remoteLog()[0]).toBe("decisions from laptop: 0001");
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
  it("commits the cards in one commit, pulls, pushes, and leaves the agent's work alone", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n", "app.js": "x = 2\n" });
    await answerAndAgentWork(s);
    // A new card an agent wrote and git doesn't track yet, and a file the agent staged.
    await s.write(s.laptop, "decisions/0003-new.md", "status: open\n");
    await s.write(s.laptop, "staged.js", "z = 1\n");
    s.git(s.laptop, "add", "staged.js");

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "synced",
      message: "Synced: sent 0001, 0003; received 0002",
      sent: ["0001", "0003"],
      received: ["0002"],
    });
    // One commit with the cards, on top of the desktop's, now on the remote.
    expect(s.remoteLog()).toEqual(["decisions from laptop: 0001, 0003", "desktop", "init"]);
    expect(s.git(s.laptop, "show", "--name-only", "--format=", "HEAD").trim().split("\n")).toEqual([
      "decisions/0001-colour.md",
      "decisions/0003-new.md",
    ]);
    // The agent's work is still uncommitted (and still staged), the desktop's changes are in.
    expect(s.status(s.laptop)).toEqual([" M lib.js", "A  staged.js"]);
    expect(await s.read(s.laptop, "lib.js")).toBe("y = wip\n");
    expect(await s.read(s.laptop, "app.js")).toBe("x = 2\n");
    expect(await s.read(s.laptop, "decisions/0002-size.md")).toBe("status: deferred\n");
    expect(s.stashCount(s.laptop)).toBe(0);
    expect(await repoStatus(s.laptop, s.options)).toEqual({ unsynced: 0, remoteChanges: 0 });
  });

  it("a second Sync with nothing to commit changes nothing", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("synced");
    const before = snapshot(s);

    const again = await syncRepo(s.laptop, "shop", s.options);

    expect(again).toMatchObject({ outcome: "nothing", sent: [], received: [] });
    expect(snapshot(s)).toEqual(before);
  });

  it("only pulls when the card changes are all on the remote", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    await s.write(s.laptop, "lib.js", "y = wip\n");
    const before = s.head(s.laptop);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", message: "Synced: received 0002" });
    // No commit of its own: the laptop is now at the desktop's commit.
    expect(s.git(s.laptop, "log", "--format=%s", "-1").trim()).toBe("desktop");
    expect(s.head(s.laptop)).not.toBe(before);
    expect(s.status(s.laptop)).toEqual([" M lib.js"]);
  });

  it("pushes an earlier answers-only commit (unpushed commits that only touch decisions/ are fine)", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, "decisions/0004-card.md", "status: open\n");
    s.git(s.laptop, "add", "decisions/0004-card.md");
    s.git(s.laptop, "commit", "--quiet", "-m", "an agent's card");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", sent: ["0001", "0004"] });
    expect(s.remoteLog()).toEqual(["decisions from laptop: 0001", "an agent's card", "init"]);
  });
});

describe("Sync: the checks say not now and change nothing", () => {
  it("refuses while an agent has unpushed commits outside decisions/", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, "app.js", "x = agent\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "agent work");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe("Not now: an agent in shop has commits it hasn't pushed");
    expect(result.action).toMatch(/until they are pushed/);
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses when the remote changed a file the agent has uncommitted edits to", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "app.js": "x = remote\n" });
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    await s.write(s.laptop, "app.js", "x = wip\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe(
      "Not now: an agent in shop has uncommitted edits to app.js, which also changed on the remote",
    );
    expect(snapshot(s)).toEqual(before);
    expect(await s.read(s.laptop, "app.js")).toBe("x = wip\n");
  });

  it("refuses on any branch but the remote's default", async () => {
    const s = await gitSandbox();
    // Branched from origin/main, so it even tracks origin/main.
    s.git(s.laptop, "checkout", "--quiet", "-b", "feat/x", "--track", "origin/main");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe("Not now: shop has the branch feat/x checked out, not main");
    expect(snapshot(s)).toEqual(before);
  });

  it("refuses when main tracks something other than the remote's main", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "push", "--quiet", "origin", "main:other");
    s.git(s.laptop, "branch", "--quiet", "--set-upstream-to=origin/other");
    await answerAndAgentWork(s);
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
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
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
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-now");
    expect(result.message).toBe(
      "Not now: the branch main in shop has no upstream branch to pull from and push to",
    );
    expect(result.action).toMatch(/git push -u origin main/);
    expect(snapshot(s)).toEqual(before);
  });

  it("has nothing to do without an upstream when there are no card changes", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "branch", "--unset-upstream");
    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("nothing");
  });

  it("works only in a folder that is the top of a git repository", async () => {
    const s = await gitSandbox();
    // Inside the repository, but not its top folder: never committed into.
    const before = snapshot(s);
    await answerAndAgentWork(s);
    const result = await syncRepo(join(s.laptop, "decisions"), "inner", s.options);
    expect(result).toMatchObject({
      outcome: "unavailable",
      message: "Not synced: inner is skipped because it isn't the top folder of a git repository",
    });
    expect(s.head(s.laptop)).toBe(before.head);
    expect(s.remoteLog()).toEqual(before.remote);
    const none = await syncRepo(join(s.root, "home"), "plain", s.options);
    expect(none).toMatchObject({
      outcome: "unavailable",
      message: "Not synced: plain is skipped because it isn't the top folder of a git repository",
    });
  });
});

describe("Sync: a card changed on both machines", () => {
  it("aborts cleanly, keeps the answers committed, and a second Sync does the same", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, {
      "decisions/0001-colour.md": "status: resolved\nnote: from desktop\n",
    });
    await answerAndAgentWork(s);
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-synced");
    expect(result.message).toBe("Not synced: 0001 changed on both machines");
    expect(result.action).toMatch(/your answers are kept in a local commit/);
    // No rebase left behind, the agent's work is back, nothing stays in the stash.
    expect(s.git(s.laptop, "status").includes("rebase")).toBe(false);
    expect(s.status(s.laptop)).toEqual([" M lib.js"]);
    expect(await s.read(s.laptop, "lib.js")).toBe("y = wip\n");
    expect(s.stashCount(s.laptop)).toBe(0);
    // The answer is committed locally, not pushed, with no conflict markers.
    expect(s.git(s.laptop, "log", "--format=%s", "-1").trim()).toBe("decisions from laptop: 0001");
    expect(await s.read(s.laptop, "decisions/0001-colour.md")).toBe(
      "status: resolved\nnote: from laptop\n",
    );
    expect(s.remoteLog()).toEqual(remoteBefore);
    expect(await repoStatus(s.laptop, s.options)).toEqual({ unsynced: 1, remoteChanges: 1 });

    // Pressing Sync again retries: nothing new to commit, the same conflict, the same clean state.
    const head = s.head(s.laptop);
    const again = await syncRepo(s.laptop, "shop", s.options);
    expect(again.message).toBe("Not synced: 0001 changed on both machines");
    expect(s.head(s.laptop)).toBe(head);
    expect(s.status(s.laptop)).toEqual([" M lib.js"]);
    expect(s.stashCount(s.laptop)).toBe(0);
    expect(s.remoteLog()).toEqual(remoteBefore);
  });

  it("isn't refused by the third check when the remote changed a card answered here", async () => {
    // The roadmap's clarification: check 3 only looks outside decisions/. The card is
    // committed first, so a clash ends in the rebase conflict above, not in "not now".
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    await s.write(s.laptop, "decisions/0002-size.md", "status: open\nnote: here\n");

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.message).toBe("Not synced: 0002 changed on both machines");
  });
});

describe("Sync: looking before pushing", () => {
  it("stops without pushing when an agent writes a file while the pull has it set aside", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "app.js": "x = remote\n" });
    await answerAndAgentWork(s);
    // The agent writes lib.js again after the rebase, before the autostash goes back
    // (simulated with a hook that runs at that moment, as in the card's test).
    const hooks = join(s.root, "hooks");
    await s.write(s.root, "hooks/post-rewrite", '#!/bin/sh\necho "y = wip2" > lib.js\n');
    await chmod(join(hooks, "post-rewrite"), 0o755);
    s.git(s.laptop, "config", "core.hooksPath", hooks);
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-pushed");
    expect(result.message).toBe(
      "Not pushed: a file in shop changed while the pull had it set aside, and git kept the older copy in its stash entry named autostash",
    );
    // The exact entry is named (the stash is shared with agents), and no bare drop.
    const [sha, subject] = s.git(s.laptop, "stash", "list", "--format=%H %gs").trim().split(" ");
    expect(subject).toBe("autostash");
    expect(result.action).toContain(
      `stash entry named autostash (stash@{0} when Sync looked, commit ${sha}`,
    );
    expect(result.action).toMatch(/drop only that entry/);
    expect(result.action).not.toMatch(/\(git stash drop\)/);
    expect(s.stashCount(s.laptop)).toBe(1);
    expect(await s.read(s.laptop, "lib.js")).toBe("y = wip2\n");
    expect(s.remoteLog()).toEqual(remoteBefore);
  });

  it("reports a push that fails, keeps the answers committed, and pushes them on the next Sync", async () => {
    const s = await gitSandbox();
    await s.write(
      s.root,
      "remote.git/hooks/pre-receive",
      "#!/bin/sh\necho 'rejected by test' >&2\nexit 1\n",
    );
    await chmod(join(s.remote, "hooks", "pre-receive"), 0o755);
    await answerAndAgentWork(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-pushed");
    expect(result.message).toBe("Not pushed: git push failed in shop");
    expect(result.gitError).toMatch(/rejected by test/);
    expect(result.action).toMatch(/kept in a local commit/);
    expect(s.remoteLog()).toEqual(["init"]);
    expect(await repoStatus(s.laptop, s.options)).toMatchObject({ unsynced: 1 });

    await rename(join(s.remote, "hooks", "pre-receive"), join(s.remote, "hooks", "off"));
    const head = s.head(s.laptop);
    const retry = await syncRepo(s.laptop, "shop", s.options);
    expect(retry).toMatchObject({ outcome: "synced", sent: ["0001"] });
    expect(s.head(s.laptop)).toBe(head); // nothing new to commit
    expect(s.remoteLog()).toEqual(["decisions from laptop: 0001", "init"]);
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
      outcome: "not-synced",
      message: "Not synced: couldn't fetch from the remote of shop",
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

      expect(result.outcome).toBe("not-synced");
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
      }),
    );
    try {
      s.git(s.laptop, "remote", "set-url", "origin", `http://127.0.0.1:${port(server)}/repo.git`);
      const before = snapshot(s);
      const started = Date.now();

      const result = await syncRepo(s.laptop, "shop", { ...s.options, networkTimeoutMs: 1000 });

      expect(result.outcome).toBe("not-synced");
      expect(result.gitError).toMatch(/git fetch took longer than 1 s and was stopped/);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(snapshot(s)).toEqual(before);
    } finally {
      for (const socket of sockets) socket.destroy();
      await close(server);
    }
  });

  it("shows git's error when the pull fails without a conflict, and keeps the answers committed", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    // The remote goes away right after the commit, before the pull.
    const hooks = join(s.root, "hooks");
    await s.write(s.root, "hooks/post-commit", `#!/bin/sh\nmv "${s.remote}" "${s.remote}.away"\n`);
    await chmod(join(hooks, "post-commit"), 0o755);
    s.git(s.laptop, "config", "core.hooksPath", hooks);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-synced",
      message: "Not synced: the pull failed in shop",
    });
    expect(result.gitError).toMatch(/remote\.git/);
    expect(result.action).toMatch(/Nothing was pushed; your answers are kept in a local commit/);
    expect(s.git(s.laptop, "log", "--format=%s", "-1").trim()).toBe("decisions from laptop: 0001");
    expect(s.status(s.laptop)).toEqual([" M lib.js"]);
    expect(s.stashCount(s.laptop)).toBe(0);
  });
});

describe("the fetch at hub start and the counts", () => {
  it("fetch changes no file and no branch, then counts the remote's card changes", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, {
      "decisions/0002-size.md": "status: deferred\n",
      "decisions/0005-other.md": "status: open\n",
      "app.js": "x = 2\n",
    });
    await answerAndAgentWork(s);
    await s.write(s.laptop, "decisions/0003-new.md", "status: open\n");
    expect(await repoStatus(s.laptop, s.options)).toEqual({ unsynced: 2, remoteChanges: 0 });
    const before = { head: s.head(s.laptop), status: s.status(s.laptop) };

    expect(await fetchRepo(s.laptop, s.options)).toEqual({});

    expect({ head: s.head(s.laptop), status: s.status(s.laptop) }).toEqual(before);
    // Changed and new cards here, and the two cards the desktop changed (app.js isn't a card).
    expect(await repoStatus(s.laptop, s.options)).toEqual({ unsynced: 2, remoteChanges: 2 });
  });

  it("counts answers in local commits that aren't pushed", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "answers");
    await s.write(s.laptop, "decisions/0002-size.md", "status: deferred\n");
    expect(await repoStatus(s.laptop, s.options)).toEqual({ unsynced: 2, remoteChanges: 0 });
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
      unsynced: 0,
      remoteChanges: 0,
    });
  });
});

describe("commit messages", () => {
  it("name the machine and the cards", () => {
    expect(
      commitMessage("laptop", [
        "decisions/0009-c.md",
        "decisions/0003-a.md",
        "decisions/0005-b.md",
      ]),
    ).toBe("decisions from laptop: 0003, 0005, 0009");
    expect(commitMessage("laptop", ["decisions/README.md"])).toBe(
      "decisions from laptop: README.md",
    );
  });
});

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

describe("Sync pushes exactly what it checked, where main tracks (S-1)", () => {
  it("never pushes another branch, whatever push.default says", async () => {
    const s = await gitSandbox();
    // An agent's branch, pushed once, then a commit it hasn't pushed.
    s.git(s.laptop, "checkout", "--quiet", "-b", "feat");
    s.git(s.laptop, "push", "--quiet", "origin", "feat");
    await s.write(s.laptop, "feat.js", "agent\n");
    s.git(s.laptop, "add", "feat.js");
    s.git(s.laptop, "commit", "--quiet", "-m", "agent unpushed feat work");
    s.git(s.laptop, "checkout", "--quiet", "main");
    s.git(s.laptop, "config", "push.default", "matching");
    const remoteFeat = s.git(s.remote, "rev-parse", "feat").trim();
    await answerAndAgentWork(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", sent: ["0001"] });
    expect(s.remoteLog()[0]).toBe("decisions from laptop: 0001");
    expect(s.git(s.remote, "rev-parse", "feat").trim()).toBe(remoteFeat);
  });

  it("pushes to the remote main tracks, not remote.pushDefault or branch.main.pushRemote", async () => {
    const s = await gitSandbox();
    s.git(s.root, "clone", "--quiet", "--bare", s.remote, "fork.git");
    s.git(s.laptop, "remote", "add", "fork", "../fork.git");
    s.git(s.laptop, "config", "remote.pushDefault", "fork");
    s.git(s.laptop, "config", "branch.main.pushRemote", "fork");
    const forkBefore = s.git(join(s.root, "fork.git"), "rev-parse", "main").trim();
    await answerAndAgentWork(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", sent: ["0001"] });
    expect(s.remoteLog()[0]).toBe("decisions from laptop: 0001");
    expect(s.git(join(s.root, "fork.git"), "rev-parse", "main").trim()).toBe(forkBefore);
    expect(s.git(s.laptop, "rev-parse", "origin/main").trim()).toBe(s.head(s.laptop));
    expect(await repoStatus(s.laptop, s.options)).toEqual({ unsynced: 0, remoteChanges: 0 });
  });

  it("pushes no tags, even with push.followTags", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "config", "push.followTags", "true");
    s.git(s.laptop, "tag", "-a", "-m", "an agent's tag", "agent-tag");
    await answerAndAgentWork(s);

    expect((await syncRepo(s.laptop, "shop", s.options)).outcome).toBe("synced");
    expect(s.git(s.remote, "tag", "--list").trim()).toBe("");
  });
});

describe("Sync checks again after the pull (S-2)", () => {
  it("doesn't push an agent's commit made while Sync ran", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    await answerAndAgentWork(s);
    // An agent commits code right after Sync's commit (the hook stands in for it).
    const done = join(s.root, "agent-committed");
    await hook(
      s,
      "post-commit",
      [
        `[ -e "${done}" ] && exit 0`,
        `touch "${done}"`,
        "unset GIT_INDEX_FILE",
        'echo "x = agent" > app.js',
        'git commit --quiet -m "agent code commit" app.js',
      ].join("\n"),
    );
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-pushed");
    expect(result.message).toBe(
      "Not pushed: an agent in shop committed while Sync ran, and its commits aren't pushed",
    );
    expect(result.action).toMatch(/your answers are kept in a local commit/);
    expect(s.remoteLog()).toEqual(remoteBefore);
    expect(s.git(s.laptop, "log", "--format=%s", "-2").trim().split("\n")).toEqual([
      "agent code commit",
      "decisions from laptop: 0001",
    ]);
  });

  it("doesn't push when the checkout moved to another branch during the pull", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    await answerAndAgentWork(s);
    // Right after the pull's rebase, an agent switches branches.
    await hook(s, "post-rewrite", "git checkout --quiet -b elsewhere");
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-pushed");
    expect(result.message).toBe("Not pushed: the checkout in shop changed during Sync");
    expect(result.action).toMatch(/It is now on elsewhere/);
    expect(s.remoteLog()).toEqual(remoteBefore);
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
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
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
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    let before = snapshot(s);
    expect((await syncRepo(s.laptop, "shop", s.options)).message).toBe(
      "Not now: a revert is in progress in shop",
    );
    expect(snapshot(s)).toEqual(before);
    s.git(s.laptop, "revert", "--abort");

    // What a series of picks keeps between its steps (git rev-parse --git-path sequencer).
    const sequencer = s.git(s.laptop, "rev-parse", "--git-path", "sequencer").trim();
    await s.write(s.laptop, `${sequencer}/todo`, "pick 0000000 x\n");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
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

  it("refuses while files have unresolved conflicts, and commits nothing", async () => {
    const s = await gitSandbox();
    // An agent's stash pop that conflicted: lib.js has unmerged entries.
    await s.write(s.laptop, "lib.js", "y = wip\n");
    s.git(s.laptop, "stash", "push", "--quiet", "-m", "agent");
    await desktopPushes(s, { "lib.js": "y = remote\n" });
    s.git(s.laptop, "pull", "--quiet");
    gitFails(s, s.laptop, "stash", "pop");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: lib.js in shop has unresolved conflicts",
    });
    expect(snapshot(s)).toEqual(before);
  });

  it("checks again right before committing (an agent may start one during the fetch)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
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
      message: "Not now: a cherry-pick is in progress in shop",
    });
    expect(s.head(s.laptop)).toBe(head);
    expect(s.status(s.laptop)).toEqual([" M decisions/0001-colour.md", " M lib.js"]);
  });
});

describe("Sync only names git's own stash entry (S-4)", () => {
  it("stops on an agent's new stash entry without suggesting to drop it", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    // An agent stashes its work while Sync runs (here: right after Sync's commit).
    await hook(
      s,
      "post-commit",
      "unset GIT_INDEX_FILE\ngit stash push --quiet -m 'agent entry' -- lib.js",
    );
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-pushed");
    expect(result.message).toBe(
      "Not pushed: a new entry appeared in git stash list in shop while Sync ran",
    );
    expect(result.action).toMatch(/"On main: agent entry".*probably an agent's: leave it alone/);
    expect(result.action).not.toMatch(/stash drop/);
    expect(s.git(s.laptop, "stash", "list", "--format=%gs").trim()).toBe("On main: agent entry");
    expect(s.remoteLog()).toEqual(remoteBefore);
  });
});

describe("Sync leaves untracked and ignored files to git (round 4)", () => {
  it("lets the remote replace a tracked folder with a file (S2-1)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "foo/a.js": "a\n" }, "a folder");
    s.git(s.laptop, "pull", "--quiet");
    s.git(s.desktop, "rm", "--quiet", "-r", "foo");
    await desktopPushes(s, { foo: "now a file\n" }, "the folder becomes a file");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", sent: ["0001"] });
    expect(await s.read(s.laptop, "foo")).toBe("now a file\n");
  });

  it("lets the remote replace a tracked file with a folder (S2-1)", async () => {
    const s = await gitSandbox();
    s.git(s.desktop, "rm", "--quiet", "app.js");
    await desktopPushes(s, { "app.js/index.js": "x = 2\n" }, "the file becomes a folder");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", sent: ["0001"] });
    expect(await s.read(s.laptop, "app.js/index.js")).toBe("x = 2\n");
  });

  it("leaves an untracked file where the remote adds one to git, which refuses (round 4)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "new.js": "remote\n" });
    await s.write(s.laptop, "new.js", "mine\n");
    await answerAndAgentWork(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-synced",
      message: "Not synced: the pull failed in shop",
    });
    expect(await s.read(s.laptop, "new.js")).toBe("mine\n");
    expect(s.status(s.laptop)).toEqual([" M lib.js", "?? new.js"]);
  });

  it("leaves an untracked file in a folder the remote replaces to git, which refuses (round 4)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "foo/a.js": "a\n" }, "a folder");
    s.git(s.laptop, "pull", "--quiet");
    await s.write(s.laptop, "foo/agent-notes.txt", "LOCAL AGENT DATA\n");
    s.git(s.desktop, "rm", "--quiet", "-r", "foo");
    await desktopPushes(s, { foo: "now a file\n" }, "the folder becomes a file");
    await answerAndAgentWork(s);
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-synced",
      message: "Not synced: the pull failed in shop",
    });
    expect(result.gitError).toMatch(/untracked/);
    expect(result.action).toMatch(/Nothing was pushed; your answers are kept in a local commit/);
    expect(await s.read(s.laptop, "foo/agent-notes.txt")).toBe("LOCAL AGENT DATA\n");
    expect(s.git(s.laptop, "log", "--format=%s", "-1").trim()).toBe("decisions from laptop: 0001");
    expect(s.status(s.laptop)).toEqual([" M lib.js", "?? foo/agent-notes.txt"]);
    expect(s.stashCount(s.laptop)).toBe(0);
    expect(s.remoteLog()).toEqual(remoteBefore);
    expect((await repoStatus(s.laptop, s.options)).rebase).toBeUndefined();
  });
});

describe("Sync and submodules (round 4)", () => {
  it("skips a project with a gitlink in the index, and changes nothing", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "update-index", "--add", "--cacheinfo", `160000,${s.head(s.laptop)},sub`);
    await desktopPushes(s, { "decisions/0002-size.md": "status: resolved\n" });
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "unavailable",
      message:
        "Not synced: shop is skipped because it has git submodules, which Sync doesn't handle",
    });
    expect(snapshot(s)).toEqual(before);
    // The top bar agrees: skipped, and no answers counted that Sync will never move.
    expect(await repoStatus(s.laptop, s.options)).toEqual({
      unavailable: "it has git submodules, which Sync doesn't handle",
      unsynced: 0,
      remoteChanges: 0,
    });
  });

  it("skips a project with a .gitmodules file, and changes nothing", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, ".gitmodules", "");
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("unavailable");
    expect(snapshot(s)).toEqual(before);
  });
});

describe("what Sync brought in (S2-2)", () => {
  it("is read right after the pull, not after an agent rewrote the card during the push", async () => {
    const s = await gitSandbox();
    const desktopText = "status: deferred\nnote: desktop\n";
    const agentText = "status: open\nnote: an agent rewrote it\n";
    await desktopPushes(s, { "decisions/0002-size.md": desktopText });
    await answerAndAgentWork(s);
    // An agent rewrites the card the pull brought in while the push runs.
    await hook(
      s,
      "pre-push",
      `printf '${agentText.replace(/\n/g, "\\n")}' > decisions/0002-size.md`,
    );

    const run = await syncRepoDetailed(s.laptop, "shop", s.options);

    expect(run.result.outcome).toBe("synced");
    expect(await s.read(s.laptop, "decisions/0002-size.md")).toBe(agentText);
    expect(run.broughtIn).toEqual([
      { path: "decisions/0002-size.md", revision: revisionOf(desktopText) },
    ]);
  });
});

describe("the checks round 2 of review found untested (S2-4)", () => {
  it("refuses a remote named like an option, and changes nothing (M1)", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "config", "remote.-x.url", "../remote.git");
    s.git(s.laptop, "config", "remote.-x.fetch", "+refs/heads/*:refs/remotes/-x/*");
    s.git(s.laptop, "fetch", "--quiet", "../remote.git", "+refs/heads/*:refs/remotes/-x/*");
    s.git(s.laptop, "symbolic-ref", "refs/remotes/-x/HEAD", "refs/remotes/-x/main");
    s.git(s.laptop, "config", "branch.main.remote", "-x");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: couldn't tell which branch is the main branch of the remote of shop",
    });
    expect(result.gitError).toBeUndefined();
    expect(snapshot(s)).toEqual(before);
  });

  it("doesn't push when main's remote changed during the pull, the upstream's name aside (M6)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    await answerAndAgentWork(s);
    // Another remote whose branches land in refs/remotes/origin/: @{u} reads the same.
    s.git(s.laptop, "config", "remote.other.url", "../remote.git");
    s.git(s.laptop, "config", "remote.other.fetch", "+refs/heads/*:refs/remotes/origin/*");
    await hook(s, "post-rewrite", "git config branch.main.remote other");
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(s.git(s.laptop, "rev-parse", "--symbolic-full-name", "@{u}").trim()).toBe(
      "refs/remotes/origin/main",
    );
    expect(result).toMatchObject({
      outcome: "not-pushed",
      message: "Not pushed: the checkout in shop changed during Sync",
    });
    expect(s.remoteLog()).toEqual(remoteBefore);
  });

  it("doesn't push when a git operation started during the pull (M7)", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    await answerAndAgentWork(s);
    // Right after the pull's rebase, an agent starts a bisect.
    await hook(s, "post-rewrite", 'touch "$(git rev-parse --git-path BISECT_LOG)"');
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-pushed",
      message: "Not pushed: a bisect started in shop during Sync",
    });
    expect(result.action).toMatch(/your answers are kept in a local commit/);
    expect(s.remoteLog()).toEqual(remoteBefore);
  });

  it("says so when the remote-tracking branch doesn't show the pushed commit (M3)", async () => {
    const s = await gitSandbox();
    await answerAndAgentWork(s);
    // Once the push has started, put origin/main back as soon as git moves it.
    const pushing = join(s.root, "pushing");
    const done = join(s.root, "moved-back");
    await hook(s, "pre-push", `touch "${pushing}"`);
    await hook(
      s,
      "reference-transaction",
      [
        '[ "$1" = committed ] || exit 0',
        `[ -e "${pushing}" ] || exit 0`,
        `[ -e "${done}" ] && exit 0`,
        "while read -r old new ref; do",
        '  if [ "$ref" = refs/remotes/origin/main ]; then',
        `    touch "${done}"`,
        '    git update-ref refs/remotes/origin/main "$old"',
        "  fi",
        "done",
      ].join("\n"),
    );

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-pushed",
      message:
        "Not sure it synced: git push said it worked in shop, but origin/main doesn't show the pushed commit",
    });
  });

  it("refuses an empty commit on top of an unpushed answers commit (M5)", async () => {
    const s = await gitSandbox();
    await s.write(s.laptop, "decisions/0002-size.md", "status: deferred\n");
    s.git(s.laptop, "commit", "--quiet", "-am", "decisions from laptop: 0002");
    s.git(s.laptop, "commit", "--quiet", "--allow-empty", "-m", "agent: empty");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: an agent in shop has commits it hasn't pushed",
    });
    expect(snapshot(s)).toEqual(before);
  });
});

describe("nothing to push (S2-5)", () => {
  it("doesn't push when the remote moved past HEAD since the pull", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0002-size.md": "status: deferred\n" });
    // Once the pull has moved main, the desktop pushes a card change and something here
    // fetches: received names only what reached the checkout (S3-6).
    const done = join(s.root, "fetched");
    await hook(
      s,
      "reference-transaction",
      [
        '[ "$1" = committed ] || exit 0',
        `[ -e "${done}" ] && exit 0`,
        "grep -q ' refs/heads/main$' || exit 0",
        `touch "${done}"`,
        "(",
        "  unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE",
        `  cd "${s.desktop}"`,
        '  echo "status: resolved" > decisions/0001-colour.md',
        '  git commit --quiet -am "desktop again"',
        "  git push --quiet",
        ")",
        "git fetch --quiet",
      ].join("\n"),
    );

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "synced", sent: [], received: ["0002"] });
    expect(s.remoteLog()[0]).toBe("desktop again");
    expect(s.git(s.laptop, "merge-base", "--is-ancestor", "HEAD", "origin/main")).toBe("");
  });
});

describe("a rebase left in progress (S-8)", () => {
  it("names the files it set aside and git rebase --abort, in Sync and in the status", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "decisions/0001-colour.md": "status: resolved\nnote: desktop\n" });
    await answerAndAgentWork(s);
    // What a Sync cut short during its pull leaves: its commit, and a rebase stopped on a
    // conflict, holding the agent's lib.js in its autostash.
    s.git(s.laptop, "commit", "--quiet", "-m", "decisions from laptop: 0001", "--", "decisions/");
    gitFails(s, s.laptop, "pull", "--quiet", "--rebase", "--autostash");
    expect(await s.read(s.laptop, "lib.js")).toBe("y = 1\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: a rebase is in progress in shop",
    });
    expect(result.action).toMatch(/set aside the uncommitted changes to lib\.js/);
    expect(result.action).toContain(`git rebase --abort in ${s.laptop} puts everything back`);
    expect(snapshot(s)).toEqual(before);

    const status = await repoStatus(s.laptop, s.options, "shop");
    expect(status.rebase?.message).toBe(
      "A rebase is in progress in shop, and Sync waits until it is finished or aborted",
    );
    expect(status.rebase?.action).toMatch(/lib\.js.*git rebase --abort/);

    // The advice works: the abort brings the agent's work back.
    s.git(s.laptop, "rebase", "--abort");
    expect(await s.read(s.laptop, "lib.js")).toBe("y = wip\n");
    expect((await repoStatus(s.laptop, s.options)).rebase).toBeUndefined();
  });
});

describe("Sync's last look before pushing (S-9)", () => {
  it("stops when putting the agent's changes back conflicts", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "app.js": "x = remote\n" });
    await answerAndAgentWork(s);
    // After check 3 has passed, an agent edits the line the remote changed (once: the
    // rebase runs post-commit too). The autostash takes the edit, and putting it back
    // conflicts: markers in app.js, unmerged entries, and git still exits 0.
    const done = join(s.root, "agent-edited");
    await hook(
      s,
      "post-commit",
      `[ -e "${done}" ] && exit 0\ntouch "${done}"\necho "x = agent" > app.js`,
    );
    const remoteBefore = s.remoteLog();

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result.outcome).toBe("not-pushed");
    expect(result.message).toBe("Not pushed: app.js in shop has conflicts after the pull");
    expect(result.action).toMatch(/stash entry named autostash/);
    expect(await s.read(s.laptop, "app.js")).toMatch(/^<<<<<<< /m);
    expect(s.remoteLog()).toEqual(remoteBefore);
  });
});

describe("check 2 and empty commits (S-10)", () => {
  it("refuses an agent's unpushed empty commit", async () => {
    const s = await gitSandbox();
    s.git(s.laptop, "commit", "--quiet", "--allow-empty", "-m", "agent: empty");
    await answerAndAgentWork(s);
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({
      outcome: "not-now",
      message: "Not now: an agent in shop has commits it hasn't pushed",
    });
    expect(snapshot(s)).toEqual(before);
  });
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
