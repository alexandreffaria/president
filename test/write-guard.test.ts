/**
 * The last guard before a card is written: president parses what it is about to write and
 * refuses to turn a valid card into a broken one (R5-19). The card writer is replaced here
 * by one that produces a broken card, the kind of bug the guard is there for.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { actOnCard, findCard } from "../src/server/cards.ts";
import { copyDemoProject } from "./helpers.ts";

const writer = vi.hoisted(() => ({ broken: false }));

vi.mock("../src/core/card-writer.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/card-writer.ts")>();
  return {
    ...real,
    updateCardText: (original: string, next: Record<string, unknown>) => {
      const text = real.updateCardText(original, next);
      return writer.broken ? text.replace(/^status: \w+$/m, "status: maybe") : text;
    },
  };
});

describe("writing a card", () => {
  it("refuses to write a card that would be broken, and leaves the file alone", async () => {
    const demo = await copyDemoProject();
    const project = { name: "demo", path: demo };
    const file = join(demo, "decisions", "0002-api-errors.md");
    const before = await readFile(file, "utf8");
    const found = await findCard(project, "0002");
    if (!found.ok) throw new Error("broken fixture");

    writer.broken = true;
    try {
      await expect(
        actOnCard(
          project,
          "0002",
          { type: "note", note: "Hi." },
          { revision: found.card.revision },
        ),
      ).rejects.toThrow(/^refusing to write an invalid card: status: Invalid option/);
    } finally {
      writer.broken = false;
    }
    expect(await readFile(file, "utf8")).toBe(before);

    // The same action with a working writer goes through.
    const written = await actOnCard(
      project,
      "0002",
      { type: "note", note: "Hi." },
      { revision: found.card.revision },
    );
    expect(written.frontmatter.feedback.at(-1)?.note).toBe("Hi.");
  });
});
