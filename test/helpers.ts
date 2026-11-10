import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/**
 * The tests' own copy of the demo project. The example in examples/ is for people to try,
 * so tests never depend on it being untouched.
 */
export const DEMO_PROJECT = join(import.meta.dirname, "fixtures", "demo-project");

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

/** A line diff (longest common subsequence): which lines were removed and which added. */
export function diffLines(
  before: string,
  after: string,
): { removed: { line: number; text: string }[]; added: string[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      row[j] =
        a[i] === b[j]
          ? ((lcs[i + 1] as number[])[j + 1] as number) + 1
          : Math.max((lcs[i + 1] as number[])[j] as number, row[j + 1] as number);
    }
  }
  const removed: { line: number; text: string }[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length ||
        ((lcs[i] as number[])[j + 1] as number) >= ((lcs[i + 1] as number[])[j] as number))
    ) {
      added.push(b[j++] as string);
    } else {
      removed.push({ line: i + 1, text: a[i++] as string });
    }
  }
  return { removed, added };
}
