import { describe, expect, it } from "vitest";
import { applyAction, type CardAction, canApply, timestamp } from "../src/core/actions.ts";
import { type ParsedCard, parseCard, updateCardText } from "../src/core/card-file.ts";
import { CARD_STATUSES, type CardStatus } from "../src/core/schema.ts";
import { cardText } from "./helpers.ts";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const AT = "2026-11-10T12:00:00Z";

function card(overrides: Record<string, string> = {}): ParsedCard {
  const result = parseCard(cardText(overrides), "0001-colour.md");
  if (!result.ok) throw new Error(result.problem.errors.join("; "));
  return result.card;
}

const RESOLVED = {
  status: "resolved",
  resolution: "{ choice: a, note: warm, resolved_at: 2026-11-09T08:00:00Z }",
  applied_at: "2026-11-09T09:00:00Z",
};

/** Applies the action, checks the result re-parses, and returns the new frontmatter. */
function act(from: ParsedCard, action: CardAction) {
  const result = applyAction(from, action, NOW);
  if (!result.ok) throw new Error(result.error);
  const text = updateCardText(cardText(), result.raw);
  const reparsed = parseCard(text, "0001-colour.md");
  if (!reparsed.ok) throw new Error(reparsed.problem.errors.join("; "));
  return { raw: result.raw, frontmatter: reparsed.card.frontmatter };
}

function rejects(from: ParsedCard, action: CardAction): string {
  const result = applyAction(from, action, NOW);
  if (result.ok) throw new Error("expected the action to be rejected");
  return result.error;
}

describe("timestamp", () => {
  it("drops milliseconds", () => expect(timestamp(NOW)).toBe(AT));
});

describe("resolve", () => {
  it("resolves an open card with an option and a note", () => {
    const { frontmatter } = act(card(), { type: "resolve", choice: "b", note: "calmer" });
    expect(frontmatter.status).toBe("resolved");
    expect(frontmatter.resolution).toEqual({ choice: "b", note: "calmer", resolved_at: AT });
  });

  it("omits an empty note", () => {
    const { raw } = act(card(), { type: "resolve", choice: "a", note: "" });
    expect(raw.resolution).toEqual({ choice: "a", resolved_at: AT });
  });

  it("resolves a deferred card and clears needs_new_options", () => {
    const { raw } = act(card({ status: "deferred", needs_new_options: "true" }), {
      type: "resolve",
      choice: "a",
    });
    expect(raw.status).toBe("resolved");
    expect(raw).not.toHaveProperty("needs_new_options");
  });

  it("accepts a custom answer only with a note", () => {
    const { frontmatter } = act(card({ kind: "open", options: "" }), {
      type: "resolve",
      choice: "custom",
      note: "Green, obviously.",
    });
    expect(frontmatter.resolution?.choice).toBe("custom");
    expect(rejects(card(), { type: "resolve", choice: "custom" })).toMatch(/needs a note/);
  });

  it("rejects unknown options and resolved cards", () => {
    expect(rejects(card(), { type: "resolve", choice: "z" })).toMatch(/"z" is not an option/);
    expect(rejects(card(RESOLVED), { type: "resolve", choice: "a" })).toMatch(
      /cannot resolve a card while it is resolved/,
    );
  });
});

describe("neither", () => {
  it("appends feedback, keeps the card open and asks for new options", () => {
    const { frontmatter } = act(card(), { type: "neither", note: "Both too loud." });
    expect(frontmatter.status).toBe("open");
    expect(frontmatter.needs_new_options).toBe(true);
    expect(frontmatter.feedback).toEqual([{ at: AT, type: "neither", note: "Both too loud." }]);
  });

  it("keeps earlier feedback rounds", () => {
    const previous = "[{ at: 2026-11-01, note: first round }]";
    const { frontmatter } = act(card({ feedback: previous }), { type: "neither", note: "second" });
    expect(frontmatter.feedback.map((f) => f.note)).toEqual(["first round", "second"]);
  });

  it("reopens a deferred card", () => {
    expect(act(card({ status: "deferred" }), { type: "neither", note: "x" }).raw.status).toBe(
      "open",
    );
  });

  it("is not available for cards without options", () => {
    expect(rejects(card({ kind: "open", options: "" }), { type: "neither", note: "x" })).toMatch(
      /no options/,
    );
  });
});

describe("note", () => {
  it("appends feedback without changing the status", () => {
    const { raw } = act(card({ status: "deferred" }), { type: "note", note: "Ask the team." });
    expect(raw.status).toBe("deferred");
    expect(raw.feedback).toEqual([{ at: AT, type: "note", note: "Ask the team." }]);
    expect(raw).not.toHaveProperty("needs_new_options");
  });
});

describe("defer", () => {
  it("defers an open card, with an optional note", () => {
    expect(act(card(), { type: "defer" }).raw).toMatchObject({ status: "deferred" });
    expect(act(card(), { type: "defer" }).raw).not.toHaveProperty("feedback");
    const { raw } = act(card(), { type: "defer", note: "after launch" });
    expect(raw.feedback).toEqual([{ at: AT, type: "defer", note: "after launch" }]);
  });

  it("rejects deferring a deferred or resolved card", () => {
    expect(rejects(card({ status: "deferred" }), { type: "defer" })).toMatch(
      /cannot defer a card while/,
    );
    expect(rejects(card(RESOLVED), { type: "defer" })).toMatch(/cannot defer a card while/);
  });
});

describe("reopen", () => {
  it("reopens a resolved card and records the old resolution", () => {
    const { raw, frontmatter } = act(card(RESOLVED), { type: "reopen", note: "Changed my mind." });
    expect(frontmatter.status).toBe("open");
    expect(raw).not.toHaveProperty("resolution");
    expect(raw).not.toHaveProperty("applied_at");
    expect(frontmatter.feedback[0]).toMatchObject({
      at: AT,
      type: "reopen",
      note: 'Reopened; it was resolved as "a" (warm). Changed my mind.',
      previous_resolution: { choice: "a", note: "warm" },
    });
  });

  it("reopens a deferred card", () => {
    const { raw } = act(card({ status: "deferred" }), { type: "reopen" });
    expect(raw.status).toBe("open");
    expect(raw).not.toHaveProperty("feedback");
  });

  it("rejects reopening an open card", () => {
    expect(rejects(card(), { type: "reopen" })).toMatch(/cannot reopen a card while it is open/);
  });
});

describe("applied", () => {
  it("stamps applied_at on a resolved card", () => {
    const { raw } = act(card({ ...RESOLVED, applied_at: "" }), { type: "applied" });
    expect(raw.applied_at).toBe(AT);
  });

  it("is only for resolved cards", () => {
    expect(rejects(card(), { type: "applied" })).toMatch(
      /cannot mark a card as applied while it is open/,
    );
  });
});

describe("transition table", () => {
  const table: Record<CardStatus, string[]> = {
    open: ["resolve", "neither", "note", "defer"],
    deferred: ["resolve", "neither", "note", "reopen"],
    resolved: ["reopen", "applied"],
  };
  for (const status of CARD_STATUSES) {
    it(`allows exactly ${table[status].join(", ")} from ${status}`, () => {
      const all = ["resolve", "neither", "note", "defer", "reopen", "applied"] as const;
      expect(all.filter((t) => canApply(status, t))).toEqual(table[status]);
    });
  }
});
