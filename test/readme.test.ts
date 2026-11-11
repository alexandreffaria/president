/**
 * The README's snippets that link the decision-cards skill into a project (S2-1, S2-2): run
 * twice each, in a temp folder with a stand-in president checkout, they must leave one
 * working link and nothing inside president's own tree.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.ts";

const ROOT = join(import.meta.dirname, "..");
/** Set in the vitest run that the GIT_DIR test starts, so it doesn't start another. */
const CHILD = "PRESIDENT_README_TEST_CHILD";
/** That run's bound: a whole vitest process, slow to start on a busy machine (setup-gate). */
const RUN_MS = 60_000;
/** How that run ended, when it failed. */
type Run = { stdout?: string; stderr?: string };

const readme = await readFile(join(ROOT, "README.md"), "utf8");
const snippets = [...readme.matchAll(/^( *)```sh\n([\s\S]*?)\n\1```$/gm)]
  .map(([, indent = "", code = ""]) => code.replace(new RegExp(`^${indent}`, "gm"), ""))
  .filter((code) => code.includes("skills/decision-cards"));

/**
 * The environment for every git and sh call (F-2): no `GIT_*` variables (a git hook or
 * `git rebase -x` in a linked worktree exports `GIT_DIR` and `GIT_INDEX_FILE`, which would
 * point git at that repo instead of the sandbox), no system or global git config, and the
 * sandbox's home folder.
 */
function cleanEnv(home: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return { ...env, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
}

/** A president checkout and a project next to it, and a home folder for the global link. */
async function sandbox() {
  const root = await tempDir();
  const president = join(root, "president");
  const project = join(root, "project");
  const home = join(root, "home");
  const env = cleanEnv(home);
  await mkdir(join(president, "skills", "decision-cards"), { recursive: true });
  await writeFile(join(president, "skills", "decision-cards", "SKILL.md"), "skill\n");
  await mkdir(project);
  await mkdir(home);
  execFileSync("git", ["init", "-q"], { cwd: project, env });
  const run = (script: string, cwd: string) =>
    execFileSync("sh", ["-ec", script], { cwd, env, encoding: "utf8" });
  return { president, project, home, env, run };
}

describe("README skill links", () => {
  it("has the three snippets, each using ln -sfn", () => {
    expect(snippets).toHaveLength(3);
    for (const snippet of snippets) {
      expect(snippet).toMatch(/\bln -sfn /);
      expect(snippet).not.toMatch(/\bln -s /);
    }
  });

  it.each([
    ["local only", 0, "project"],
    ["committed", 1, "project"],
    ["global", 2, "president"],
  ] as const)("can run the %s snippet twice", async (_, index, from) => {
    const box = await sandbox();
    const script = (snippets[index] ?? "").replace("/absolute/path/to/president", box.president);
    const linkDir = from === "president" ? join(box.home, ".claude") : join(box.project, ".claude");
    for (let i = 0; i < 2; i++) {
      const out = box.run(script, from === "president" ? box.president : box.project);
      if (from === "project") expect(out.trim().split("\n").at(-1)).toBe("ok");
    }
    const link = join(linkDir, "skills", "decision-cards");
    expect(await readFile(join(link, "SKILL.md"), "utf8")).toBe("skill\n");
    expect(await readlink(link)).toMatch(/president\/skills\/decision-cards$/);
    // GNU ln -s without -n follows the existing link and puts a new one inside it.
    expect(existsSync(join(box.president, "skills", "decision-cards", "decision-cards"))).toBe(
      false,
    );
  });

  it("keeps the local-only link out of git, listed once however often it runs", async () => {
    const box = await sandbox();
    const script = (snippets[0] ?? "").replace("/absolute/path/to/president", box.president);
    for (let i = 0; i < 2; i++) box.run(script, box.project);
    const exclude = await readFile(join(box.project, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n").filter((line) => line === ".claude/skills/decision-cards")).toEqual([
      ".claude/skills/decision-cards",
    ]);
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: box.project,
      env: box.env,
      encoding: "utf8",
    });
    expect(status).toBe("");
  });

  // Run this file again as if from a git hook or `git rebase -x` in a linked worktree, which
  // export GIT_DIR and GIT_INDEX_FILE: the repo they point at must stay untouched (F-2).
  it.skipIf(process.env[CHILD])(
    "leaves the repo of an inherited GIT_DIR alone",
    {
      timeout: RUN_MS + 5000,
    },
    async () => {
      const scratch = await tempDir();
      execFileSync("git", ["init", "-q", "repo"], { cwd: scratch, env: cleanEnv(scratch) });
      const gitDir = join(scratch, "repo", ".git");
      const exclude = join(gitDir, "info", "exclude");
      const before = await readFile(exclude, "utf8");
      const report = join(scratch, "report.json");
      const run: Run = await promisify(execFile)(
        process.execPath,
        [
          join(ROOT, "node_modules", "vitest", "vitest.mjs"),
          "run",
          join("test", "readme.test.ts"),
          "--reporter=json",
          `--outputFile=${report}`,
        ],
        {
          cwd: ROOT,
          env: {
            ...process.env,
            [CHILD]: "1",
            GIT_DIR: gitDir,
            GIT_INDEX_FILE: join(gitDir, "index"),
          },
          timeout: RUN_MS,
        },
      ).catch((error: Run) => error);
      expect(await readFile(exclude, "utf8")).toBe(before);
      const text = await readFile(report, "utf8").catch(() => {
        throw new Error(`the run wrote no report:\n${run.stdout ?? ""}${run.stderr ?? ""}`);
      });
      const { numPassedTests, numFailedTests } = JSON.parse(text) as Record<string, number>;
      expect(numFailedTests).toBe(0);
      expect(numPassedTests).toBeGreaterThanOrEqual(5);
    },
  );
});
