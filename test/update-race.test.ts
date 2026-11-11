/**
 * `president update` reads the card again just before writing it: the hub may write it while
 * the agent's version is being checked (R6-15). Checking the agent's version is made slow
 * here by a parser that lets the human act on the card first.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/main.ts";
import { copyDemoProject, tempDir } from "./helpers.ts";

/** Runs once, when the agent's version (`text`) is parsed. */
const hook = vi.hoisted(() => ({ text: "", during: undefined as (() => void) | undefined }));

vi.mock("../src/core/card-file.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/card-file.ts")>();
  return {
    ...real,
    parseCard: (text: string, fileName: string) => {
      if (text === hook.text && hook.during) {
        const during = hook.during;
        hook.during = undefined;
        during();
      }
      return real.parseCard(text, fileName);
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("president update", () => {
  it("leaves the card alone when the hub writes it during the update", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", await tempDir());
    const demo = await copyDemoProject();
    const file = join(demo, "decisions", "0002-api-errors.md");
    const mine = join(demo, "decisions", ".0002.new.md");
    const before = await readFile(file, "utf8");
    hook.text = before.replace("## Option throw", "## Option throw\n\nRewritten.");
    await writeFile(mine, hook.text);
    const human = `${before}\nThe human's edit.\n`;
    hook.during = () => writeFileSync(file, human);
    const err: string[] = [];
    const code = await run(["update", file, mine], { log: () => {}, error: (l) => err.push(l) });
    expect(hook.during).toBeUndefined();
    expect({ code, err }).toEqual({
      code: 1,
      err: ["president: 0002-api-errors.md changed while updating it; run president update again"],
    });
    expect(readFileSync(file, "utf8")).toBe(human);
  });
});
