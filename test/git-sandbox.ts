/**
 * Scratch git repositories for the Sync tests: a bare repository as the remote and two
 * clones, "laptop" (the machine whose hub runs Sync) and "desktop" (the other machine).
 *
 * Everything lives in a temp folder. git runs with the same environment Sync uses (the
 * inherited variables that point git elsewhere removed, such as a GIT_DIR from a hook), plus
 * a temp HOME and XDG_CONFIG_HOME, GIT_CONFIG_NOSYSTEM=1 and GIT_CONFIG_GLOBAL pointing at the
 * sandbox's own config, and GIT_CEILING_DIRECTORIES so git never looks above the sandbox.
 *
 * The repositories are made once per test file and copied for each test (the clones name
 * their remote by a relative path, so a copy is self-contained): several suites at once
 * then start far fewer git processes.
 */
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";
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
  /** What Sync gets: the sandbox's git config, generous timeouts, machine name "laptop". */
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

const GLOBAL_CONFIG = [
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
].join("\n");

/** The environment for git in the sandbox at `root` (on top of {@link gitEnv}). */
function sandboxEnv(root: string): Record<string, string> {
  const home = join(root, "home");
  return {
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_CEILING_DIRECTORIES: root,
    LC_ALL: "C",
  };
}

function gitIn(root: string) {
  const env = gitEnv(sandboxEnv(root));
  return (cwd: string, ...args: string[]): string =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function write(repo: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(repo, file)), { recursive: true });
  await writeFile(join(repo, file), text);
}

let template: Promise<string> | undefined;
afterAll(async () => {
  if (template) await rm(await template, { recursive: true, force: true });
});

/** The remote, the laptop with two cards and two code files pushed, and the desktop's clone. */
async function makeTemplate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "president-sync-template-"));
  await mkdir(join(root, "home"));
  await writeFile(join(root, "home", ".gitconfig"), GLOBAL_CONFIG);
  const git = gitIn(root);
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", "remote.git");
  git(root, "clone", "--quiet", "remote.git", "laptop");
  const laptop = join(root, "laptop");
  git(laptop, "remote", "set-url", "origin", "../remote.git");
  await write(laptop, "decisions/0001-colour.md", "status: open\nnote: none\n");
  await write(laptop, "decisions/0002-size.md", "status: open\n");
  await write(laptop, "app.js", "x = 1\n");
  await write(laptop, "lib.js", "y = 1\n");
  git(laptop, "add", "--all");
  git(laptop, "commit", "--quiet", "-m", "init");
  git(laptop, "push", "--quiet", "-u", "origin", "main");
  // A fetch records the remote's default branch (refs/remotes/origin/HEAD) on this git.
  git(laptop, "fetch", "--quiet");
  git(root, "clone", "--quiet", "remote.git", "desktop");
  git(join(root, "desktop"), "remote", "set-url", "origin", "../remote.git");
  return root;
}

export async function gitSandbox(): Promise<Sandbox> {
  template ??= makeTemplate();
  const root = await tempDir("president-sync-");
  await cp(await template, root, { recursive: true });
  const git = gitIn(root);
  const remote = join(root, "remote.git");
  const laptop = join(root, "laptop");
  const desktop = join(root, "desktop");
  return {
    root,
    remote,
    laptop,
    desktop,
    options: {
      env: sandboxEnv(root),
      timeoutMs: 30_000,
      networkTimeoutMs: 60_000,
      hostname: "laptop",
    },
    git,
    write,
    read: (repo, file) => readFile(join(repo, file), "utf8"),
    push: (repo, message) => {
      git(repo, "add", "--all");
      git(repo, "commit", "--quiet", "-m", message);
      git(repo, "push", "--quiet");
    },
    head: (repo) => git(repo, "rev-parse", "HEAD").trim(),
    status: (repo) =>
      git(repo, "status", "--short", "--untracked-files=all").split("\n").filter(Boolean).sort(),
    stashCount: (repo) => git(repo, "stash", "list").split("\n").filter(Boolean).length,
    remoteLog: () => git(remote, "log", "--format=%s", "main").split("\n").filter(Boolean),
  };
}
