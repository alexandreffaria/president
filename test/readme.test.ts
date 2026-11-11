/**
 * The README's snippets that link the decision-cards skill into a project (S2-1, S2-2): run
 * twice each, in a temp folder with a stand-in president checkout, they must leave one
 * working link and nothing inside president's own tree.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers.ts";

const readme = await readFile(join(import.meta.dirname, "..", "README.md"), "utf8");
const snippets = [...readme.matchAll(/^( *)```sh\n([\s\S]*?)\n\1```$/gm)]
  .map(([, indent = "", code = ""]) => code.replace(new RegExp(`^${indent}`, "gm"), ""))
  .filter((code) => code.includes("skills/decision-cards"));

/** A president checkout and a project next to it, and a home folder for the global link. */
async function sandbox() {
  const root = await tempDir();
  const president = join(root, "president");
  const project = join(root, "project");
  const home = join(root, "home");
  await mkdir(join(president, "skills", "decision-cards"), { recursive: true });
  await writeFile(join(president, "skills", "decision-cards", "SKILL.md"), "skill\n");
  await mkdir(project);
  await mkdir(home);
  execFileSync("git", ["init", "-q"], { cwd: project });
  const run = (script: string, cwd: string) =>
    execFileSync("sh", ["-ec", script], {
      cwd,
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });
  return { president, project, home, run };
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
      encoding: "utf8",
    });
    expect(status).toBe("");
  });
});
