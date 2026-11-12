import { describe, expect, it } from "vitest";
import type { CardDto } from "../src/core/api.ts";
import {
  buildLog,
  buildQueue,
  compareQueue,
  isBackFromDeferral,
  isSnoozed,
  isWaitingOnAgent,
  nextReturn,
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
  const NOW = Date.parse("2026-11-12T12:00:00Z");
  const cards = [
    card("0001"),
    card("0002", { status: "deferred", defer_until: "2026-11-19T12:00:00Z" }),
    card("0003", resolved("2026-11-02")),
    card("0004", { needs_new_options: true }),
    card("0005", {}, "other"),
  ];

  it("keeps open cards that aren't waiting on an agent", () => {
    // Same priority and age: sorted by project name ("other" < "p").
    expect(buildQueue(cards, undefined, NOW).map((c) => c.id)).toEqual(["0005", "0001"]);
    expect(isWaitingOnAgent(cards[3] as CardDto)).toBe(true);
  });

  it("brings a deferred card back once its date passes, sorted like an open one (#0017)", () => {
    const later = Date.parse("2026-11-19T12:00:00Z");
    expect(buildQueue(cards, undefined, later - 1).map((c) => c.id)).toEqual(["0005", "0001"]);
    // Same priority and age as 0001 (project "p", id order).
    expect(buildQueue(cards, undefined, later).map((c) => c.id)).toEqual(["0005", "0001", "0002"]);
    const deferred = cards[1] as CardDto;
    expect(isSnoozed(deferred, later - 1)).toBe(true);
    expect(isBackFromDeferral(deferred, later)).toBe(true);
    expect(isBackFromDeferral(cards[0] as CardDto, later)).toBe(false);
  });

  it("treats a deferred card without a date as back (202611112hzh)", () => {
    const old = card("0006", { status: "deferred", priority: "high" });
    expect(isBackFromDeferral(old, NOW)).toBe(true);
    expect(isSnoozed(old, NOW)).toBe(false);
    expect(buildQueue([...cards, old], undefined, NOW).map((c) => c.id)).toEqual([
      "0006",
      "0005",
      "0001",
    ]);
  });

  it("sinks cards with an undecided dependency below the ready ones (#0009)", () => {
    const all = [
      card("0001", { priority: "high", depends_on: ["0002"] }),
      card("0002", { priority: "low", created: "2026-11-05T10:00:00Z" }),
      card("0003", { created: "2026-11-03T10:00:00Z" }),
      card("0004", { priority: "low", depends_on: ["0003"], created: "2026-10-01T10:00:00Z" }),
      card("0005", { priority: "high", depends_on: ["0006"] }),
      card("0006", resolved("2026-11-02")),
      // A deferred dependency (snoozed or back) is still undecided.
      card("0007", { depends_on: ["0008"] }),
      card("0008", { status: "deferred", defer_until: "2026-12-01T00:00:00Z" }),
    ];
    // Ready: 0005 (its dependency is decided), 0003, 0002; then the sunk: 0001, 0007, 0004.
    expect(buildQueue(all, undefined, NOW).map((c) => c.id)).toEqual([
      "0005",
      "0003",
      "0002",
      "0001",
      "0007",
      "0004",
    ]);
    // Once 0002 is decided, 0001 moves back up among the ready cards.
    const decided = all.map((c) => (c.id === "0002" ? card("0002", resolved("2026-11-12")) : c));
    expect(buildQueue(decided, undefined, NOW).map((c) => c.id)).toEqual([
      "0001",
      "0005",
      "0003",
      "0007",
      "0004",
    ]);
  });

  it("looks up dependencies across every card, even when filtering by project", () => {
    const all = [card("0001", { depends_on: ["0002"] }), card("0002"), card("0003", {}, "other")];
    expect(buildQueue(all, "p", NOW).map((c) => c.id)).toEqual(["0002", "0001"]);
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

describe("nextReturn", () => {
  it("is the earliest date a snoozed card comes back", () => {
    const NOW = Date.parse("2026-11-12T12:00:00Z");
    const cards = [
      card("0001", { status: "deferred", defer_until: "2026-11-20T00:00:00Z" }),
      card("0002", { status: "deferred", defer_until: "2026-11-14T00:00:00Z" }),
      card("0003", { status: "deferred", defer_until: "2026-11-01T00:00:00Z" }),
      card("0004", { status: "deferred" }),
      card("0005"),
    ];
    expect(nextReturn(cards, NOW)).toBe(Date.parse("2026-11-14T00:00:00Z"));
    expect(nextReturn([card("0005")], NOW)).toBeUndefined();
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
