/**
 * Sync (card #0001) against scratch repositories: every check and failure path the card and
 * docs/roadmap.md describe. Each test builds its own remote and two clones in a temp folder
 * (see git-sandbox.ts); nothing here runs git anywhere else.
 */
import { chmod, rename } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type Socket, type Server as TcpServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitEnv, runGit } from "../src/server/git.ts";
import { commitMessage, fetchRepo, repoStatus, syncRepo } from "../src/server/sync.ts";
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
  it("removes inherited GIT_* variables and turns prompts off", () => {
    const env = gitEnv(
      { EXTRA: "1" },
      { PATH: "/bin", GIT_DIR: "/elsewhere/.git", GIT_WORK_TREE: "/elsewhere", git_dir: "x" },
    );
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.git_dir).toBeUndefined();
    expect(env).toMatchObject({
      PATH: "/bin",
      EXTRA: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      GIT_OPTIONAL_LOCKS: "0",
    });
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

  it("refuses when the remote added a file that exists here untracked", async () => {
    const s = await gitSandbox();
    await desktopPushes(s, { "new.js": "remote\n" });
    await s.write(s.laptop, "decisions/0001-colour.md", "status: resolved\n");
    await s.write(s.laptop, "new.js", "mine\n");
    const before = snapshot(s);

    const result = await syncRepo(s.laptop, "shop", s.options);

    expect(result).toMatchObject({ outcome: "not-now" });
    expect(result.message).toMatch(/uncommitted edits to new\.js/);
    expect(snapshot(s)).toEqual(before);
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
      "Not pushed: a file in shop changed while the pull had it set aside, and git kept the older copy in its stash",
    );
    expect(result.action).toMatch(/git stash list .* clear that entry/);
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
