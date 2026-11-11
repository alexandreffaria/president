import { describe, expect, it } from "vitest";
import type { CardDto } from "../src/core/api.ts";
import {
  buildLog,
  buildQueue,
  compareQueue,
  isWaitingOnAgent,
  openDependencies,
  unknownDependencies,
} from "../src/core/queue.ts";
import { FrontmatterSchema } from "../src/core/schema.ts";

function card(id: string, fields: Record<string, unknown> = {}, project = "p"): CardDto {
  const frontmatter = FrontmatterSchema.parse({
    id,
    title: `Card ${id}`,
    status: "open",
    kind: "open",
    created: "2026-11-01T10:00:00Z",
    created_by: "test",
    ...fields,
  });
  return { project, id, fileName: `${id}.md`, revision: "r", frontmatter };
}

const resolved = (at: string) => ({
  status: "resolved",
  resolution: { choice: "custom", note: "x", resolved_at: at },
});

describe("compareQueue", () => {
  it("puts high priority first, then the oldest, then sorts by project and id", () => {
    const cards = [
      card("0004", { priority: "low", created: "2026-01-01" }),
      card("0003", { created: "2026-11-02" }),
      card("0002", { created: "2026-11-01" }, "b"),
      card("0001", { created: "2026-11-01" }, "a"),
      card("0005", { priority: "high", created: "2026-12-01" }),
      card("0000", { created: "2026-11-01" }, "a"),
    ];
    expect([...cards].sort(compareQueue).map((c) => `${c.project}/${c.id}`)).toEqual([
      "p/0005",
      "a/0000",
      "a/0001",
      "b/0002",
      "p/0003",
      "p/0004",
    ]);
  });
});

describe("buildQueue", () => {
  const cards = [
    card("0001"),
    card("0002", { status: "deferred" }),
    card("0003", resolved("2026-11-02")),
    card("0004", { needs_new_options: true }),
    card("0005", {}, "other"),
  ];

  it("keeps open cards that aren't waiting on an agent", () => {
    // Same priority and age: sorted by project name ("other" < "p").
    expect(buildQueue(cards).map((c) => c.id)).toEqual(["0005", "0001"]);
    expect(isWaitingOnAgent(cards[3] as CardDto)).toBe(true);
  });

  it("filters by project", () => {
    expect(buildQueue(cards, "other").map((c) => c.id)).toEqual(["0005"]);
    expect(buildQueue(cards, "none")).toEqual([]);
  });
});

describe("buildLog", () => {
  it("lists resolved cards, most recently resolved first", () => {
    const cards = [
      card("0001", resolved("2026-11-02T10:00:00Z")),
      card("0002"),
      card("0003", resolved("2026-11-05T10:00:00Z")),
      card("0004", resolved("2026-11-03T10:00:00Z"), "other"),
    ];
    expect(buildLog(cards).map((c) => c.id)).toEqual(["0003", "0004", "0001"]);
    expect(buildLog(cards, "p").map((c) => c.id)).toEqual(["0003", "0001"]);
  });
});

describe("dependencies", () => {
  const all = [
    card("0001", { depends_on: ["0002", "0003", 4, "9999", "0001"] }),
    card("0002"),
    card("0003", resolved("2026-11-02")),
    card("0004", { status: "deferred" }),
    card("9999", {}, "other"),
  ];
  const first = all[0] as CardDto;

  it("lists dependencies in the same project that are not resolved", () => {
    expect(openDependencies(first, all)).toEqual(["0002", "4"]);
  });

  it("lists dependencies that are not cards of the project, or the card itself", () => {
    expect(unknownDependencies(first, all)).toEqual(["9999", "0001"]);
  });
});
