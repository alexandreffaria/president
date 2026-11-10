import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

export const DEMO_PROJECT = join(import.meta.dirname, "..", "examples", "demo-project");

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A fresh temp folder, removed after the test. */
export async function tempDir(prefix = "president-test-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

/** A copy of the demo project in a temp folder, safe to modify. */
export async function copyDemoProject(): Promise<string> {
  const root = await tempDir();
  const dir = join(root, "demo");
  await cp(DEMO_PROJECT, dir, { recursive: true });
  return dir;
}

/** A minimal valid card; override any frontmatter field. */
export function cardText(
  overrides: Record<string, string> = {},
  body = "\n## Context\n\nWhy.\n",
): string {
  const fields: Record<string, string> = {
    id: '"0001"',
    title: "Pick a colour",
    status: "open",
    kind: "choice",
    priority: "normal",
    created: "2026-11-10",
    created_by: "test",
    options: `
  - id: a
    title: Red
  - id: b
    title: Blue`,
    ...overrides,
  };
  const yaml = Object.entries(fields)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  return `---\n${yaml}\n---\n${body}`;
}
