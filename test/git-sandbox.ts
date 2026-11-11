/**
 * Scratch git repositories for the Sync tests: a bare repository as the remote and two
 * clones, "laptop" (the machine whose hub runs Sync) and "desktop" (the other machine).
 *
 * Everything lives in a temp folder. git runs with the same environment Sync uses (every
 * inherited GIT_* variable removed, so a GIT_DIR from a hook can't point it elsewhere), plus
 * a temp HOME and XDG_CONFIG_HOME, GIT_CONFIG_NOSYSTEM=1 and GIT_CONFIG_GLOBAL pointing at the
 * sandbox's own config, and GIT_CEILING_DIRECTORIES so git never looks above the sandbox.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitEnv } from "../src/server/git.ts";
import type { SyncOptions } from "../src/server/sync.ts";
import { tempDir } from "./helpers.ts";

export interface Sandbox {
  root: string;
  remote: string;
  /** The machine Sync runs on. */
  laptop: string;
  /** The other machine. */
  desktop: string;
  /** What Sync gets: the sandbox's git config, short timeouts, machine name "laptop". */
  options: SyncOptions;
  git(cwd: string, ...args: string[]): string;
  write(repo: string, file: string, text: string): Promise<void>;
  read(repo: string, file: string): Promise<string>;
  /** Commits everything in `repo` and pushes it. */
  push(repo: string, message: string): void;
  head(repo: string): string;
  /** `git status --short` of the repo, sorted lines. */
  status(repo: string): string[];
  stashCount(repo: string): number;
  /** Commit subjects of the remote's main, newest first. */
  remoteLog(): string[];
}

export async function gitSandbox(): Promise<Sandbox> {
  const root = await tempDir("president-sync-");
  const home = join(root, "home");
  await mkdir(home);
  const globalConfig = join(home, ".gitconfig");
  await writeFile(
    globalConfig,
    [
      "[user]",
      "\tname = Test",
      "\temail = test@example.com",
      "[init]",
      "\tdefaultBranch = main",
      "[advice]",
      "\tdetachedHead = false",
      "[commit]",
      "\tgpgsign = false",
      "",
    ].join("\n"),
  );
  const env: Record<string, string> = {
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CEILING_DIRECTORIES: root,
    LC_ALL: "C",
  };
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, {
      cwd,
      env: gitEnv(env),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  const remote = join(root, "remote.git");
  const laptop = join(root, "laptop");
  const desktop = join(root, "desktop");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(root, "clone", "--quiet", remote, laptop);

  const write = async (repo: string, file: string, text: string) => {
    await mkdir(dirname(join(repo, file)), { recursive: true });
    await writeFile(join(repo, file), text);
  };
  const read = (repo: string, file: string) => readFile(join(repo, file), "utf8");
  const push = (repo: string, message: string) => {
    git(repo, "add", "--all");
    git(repo, "commit", "--quiet", "-m", message);
    git(repo, "push", "--quiet");
  };

  await write(laptop, "decisions/0001-colour.md", "status: open\nnote: none\n");
  await write(laptop, "decisions/0002-size.md", "status: open\n");
  await write(laptop, "app.js", "x = 1\n");
  await write(laptop, "lib.js", "y = 1\n");
  git(laptop, "add", "--all");
  git(laptop, "commit", "--quiet", "-m", "init");
  git(laptop, "push", "--quiet", "-u", "origin", "main");
  // A fetch records the remote's default branch (refs/remotes/origin/HEAD) on this git.
  git(laptop, "fetch", "--quiet");
  git(root, "clone", "--quiet", remote, desktop);

  return {
    root,
    remote,
    laptop,
    desktop,
    options: {
      env,
      timeoutMs: 30_000,
      networkTimeoutMs: 60_000,
      hostname: "laptop",
    },
    git,
    write,
    read,
    push,
    head: (repo) => git(repo, "rev-parse", "HEAD").trim(),
    status: (repo) =>
      git(repo, "status", "--short", "--untracked-files=all").split("\n").filter(Boolean).sort(),
    stashCount: (repo) => git(repo, "stash", "list").split("\n").filter(Boolean).length,
    remoteLog: () => git(remote, "log", "--format=%s", "main").split("\n").filter(Boolean),
  };
}
