import { describe, expect, it } from "vitest";
import {
  applyAction,
  type CardAction,
  CardActionSchema,
  canApply,
  feedbackTimestamp,
  timestamp,
} from "../src/core/actions.ts";
import { type ParsedCard, parseCard } from "../src/core/card-file.ts";
import { updateCardText } from "../src/core/card-writer.ts";
import { agentToken, unseenFeedback } from "../src/core/pending.ts";
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

describe("note on a decided card (#0011)", () => {
  it("appends the note and keeps the decision and applied_at", () => {
    const { raw } = act(card(RESOLVED), { type: "note", note: "Also update the README." });
    expect(raw).toMatchObject({
      status: "resolved",
      resolution: { choice: "a", note: "warm" },
      applied_at: "2026-11-09T09:00:00Z",
      feedback: [{ at: AT, type: "note", note: "Also update the README." }],
    });
  });
});

describe("defer", () => {
  it("defers an open card for a week, with an optional note (#0017)", () => {
    expect(act(card(), { type: "defer" }).raw).toMatchObject({
      status: "deferred",
      defer_until: "2026-11-17T12:00:00Z",
    });
    expect(act(card(), { type: "defer" }).raw).not.toHaveProperty("feedback");
    const { raw } = act(card(), { type: "defer", note: "after launch" });
    expect(raw.feedback).toEqual([{ at: AT, type: "defer", note: "after launch" }]);
  });

  it("defers until a given time, written in UTC without milliseconds", () => {
    const { raw } = act(card(), { type: "defer", until: "2026-12-01T09:30:00.250+01:00" });
    expect(raw.defer_until).toBe("2026-12-01T08:30:00Z");
  });

  it("refuses a date that has passed, or isn't a date", () => {
    expect(rejects(card(), { type: "defer", until: "2026-11-10T11:59:00Z" })).toMatch(/has passed/);
    expect(CardActionSchema.safeParse({ type: "defer", until: "next week" }).success).toBe(false);
  });

  it("snoozes a deferred card again with a new date (a card back from deferral)", () => {
    const back = card({ status: "deferred", defer_until: "2026-11-09T08:00:00Z" });
    expect(act(back, { type: "defer" }).raw.defer_until).toBe("2026-11-17T12:00:00Z");
    // 202611112hzh: a deferred card without a date gets a real one.
    expect(act(card({ status: "deferred" }), { type: "defer" }).raw.defer_until).toBe(
      "2026-11-17T12:00:00Z",
    );
  });

  it("rejects deferring a resolved card", () => {
    expect(rejects(card(RESOLVED), { type: "defer" })).toMatch(/cannot defer a card while/);
  });

  it("keeps the date through a note, and drops it on reopen, resolve and neither", () => {
    const snoozed = card({ status: "deferred", defer_until: "2026-11-20T08:00:00Z" });
    expect(act(snoozed, { type: "note", note: "still later" }).raw.defer_until).toBe(
      "2026-11-20T08:00:00Z",
    );
    for (const action of [
      { type: "reopen" },
      { type: "resolve", choice: "a" },
      { type: "neither", note: "neither" },
    ] as const) {
      const { raw } = act(snoozed, action);
      expect(raw).not.toHaveProperty("defer_until");
    }
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
      previous_applied_at: "2026-11-09T09:00:00Z",
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

/** Applies the action and returns the card as it would be read back from the file. */
function step(from: ParsedCard, action: CardAction, now = NOW): ParsedCard {
  const result = applyAction(from, action, now);
  if (!result.ok) throw new Error(result.error);
  const reparsed = parseCard(updateCardText(cardText(), result.raw), "0001-colour.md");
  if (!reparsed.ok) throw new Error(reparsed.problem.errors.join("; "));
  return reparsed.card;
}

const ONE_NOTE = {
  feedback: "\n  - at: 2026-11-10T09:00:00Z\n    type: note\n    note: first",
};

describe("applied", () => {
  it("stamps applied_at, and seen_at up to the newest feedback the agent was shown", () => {
    const before = card({ ...RESOLVED, applied_at: "", ...ONE_NOTE });
    const { raw } = act(before, { type: "applied", token: agentToken(before) });
    expect(raw.applied_at).toBe(AT);
    expect(raw.seen_at).toBe("2026-11-10T09:00:00Z");
    const bare = card({ ...RESOLVED, applied_at: "" });
    expect(act(bare, { type: "applied", token: agentToken(bare) }).raw).not.toHaveProperty(
      "seen_at",
    );
  });

  it("is only for resolved cards", () => {
    expect(rejects(card(), { type: "applied", token: agentToken(card()) })).toMatch(
      /cannot mark a card as applied while it is open/,
    );
  });

  it("refuses when the human changed the decision after the agent looked", () => {
    // The agent is shown "a"; the human reopens and decides "b" before it runs applied.
    const shown = card({ ...RESOLVED, applied_at: "" });
    const token = agentToken(shown);
    const later = new Date("2026-11-10T12:05:00Z");
    const redecided = step(step(shown, { type: "reopen" }, later), {
      type: "resolve",
      choice: "b",
    });
    const result = applyAction(redecided, { type: "applied", token }, later);
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(!result.ok && result.error).toMatch(/now resolved as "b".*preside pending/);
  });

  it("refuses when the human undid the decision and made it again", () => {
    const open = card();
    const first = step(open, { type: "resolve", choice: "a" });
    const token = agentToken(first);
    // Undo puts the file back as it was; the same choice a minute later is a new decision.
    const again = step(open, { type: "resolve", choice: "a" }, new Date("2026-11-10T12:01:00Z"));
    expect(applyAction(again, { type: "applied", token }, NOW)).toMatchObject({
      ok: false,
      reason: "stale",
    });
  });
});

describe("seen", () => {
  it("marks only what the token covers, in any state, changing nothing else", () => {
    const cases: Record<string, string>[] = [{}, { status: "deferred" }, RESOLVED];
    for (const overrides of cases) {
      const before = card({ ...overrides, ...ONE_NOTE });
      const { raw } = act(before, { type: "seen", token: agentToken(before) });
      expect(raw).toEqual({ ...before.raw, seen_at: "2026-11-10T09:00:00Z" });
    }
  });

  it("leaves a note the human added after the agent looked unread", () => {
    const shown = card(ONE_NOTE);
    const token = agentToken(shown);
    const withSecond = step(shown, { type: "note", note: "second, never shown" });
    const after = step(withSecond, { type: "seen", token });
    expect(unseenFeedback(after.frontmatter).map((f) => f.note)).toEqual(["second, never shown"]);
  });

  it("never counts a note written in the same second as seen_at as read", () => {
    const shown = card(ONE_NOTE);
    const seen = step(shown, { type: "seen", token: agentToken(shown) }, NOW);
    // seen_at is the shown note's time; force the harder case where it is "now".
    const sameSecond = { ...seen, frontmatter: { ...seen.frontmatter, seen_at: AT } };
    const noted = step(
      { ...sameSecond, raw: { ...seen.raw, seen_at: AT } },
      { type: "note", note: "same second" },
      new Date("2026-11-10T12:00:00.400Z"),
    );
    expect(unseenFeedback(noted.frontmatter).map((f) => f.note)).toEqual(["same second"]);
  });

  it("refuses a token for feedback that is no longer there, or for another card", () => {
    const noted = step(card(), { type: "note", note: "oops" });
    const token = agentToken(noted);
    // The human undid the note: the card is back as it was.
    expect(applyAction(card(), { type: "seen", token }, NOW)).toMatchObject({
      ok: false,
      reason: "stale",
    });
    const other = { ...noted, id: "0002" };
    expect(applyAction(other, { type: "seen", token }, NOW)).toMatchObject({ reason: "stale" });
    expect(applyAction(noted, { type: "seen", token: "nonsense" }, NOW)).toMatchObject({
      reason: "stale",
      error: expect.stringMatching(/not a token from `preside pending`/),
    });
  });
});

describe("feedback timestamps", () => {
  it("are whole seconds, but always later than earlier feedback and seen_at", () => {
    expect(feedbackTimestamp(NOW, { feedback: [] })).toBe(AT);
    expect(feedbackTimestamp(NOW, { feedback: [{ at: AT }] })).toBe("2026-11-10T12:00:00.001Z");
    expect(feedbackTimestamp(NOW, { feedback: [], seen_at: "2026-11-10T12:00:00.500Z" })).toBe(
      "2026-11-10T12:00:00.501Z",
    );
    // A clock that went backwards still gives a later time.
    expect(feedbackTimestamp(NOW, { feedback: [{ at: "2026-11-11T00:00:00Z" }] })).toBe(
      "2026-11-11T00:00:00.001Z",
    );
  });

  it("make two notes in one second both unread and in order", () => {
    const one = step(card(), { type: "note", note: "one" });
    const two = step(one, { type: "note", note: "two" });
    expect(two.frontmatter.feedback.map((f) => f.at)).toEqual([AT, "2026-11-10T12:00:00.001Z"]);
    expect(unseenFeedback(two.frontmatter)).toHaveLength(2);
  });
});

describe("error reasons", () => {
  it("tells a state conflict from a bad action", () => {
    const fail = (from: ParsedCard, action: CardAction) => {
      const result = applyAction(from, action, NOW);
      return result.ok ? "ok" : result.reason;
    };
    expect(fail(card(RESOLVED), { type: "defer" })).toBe("transition");
    expect(fail(card(), { type: "resolve", choice: "z" })).toBe("input");
    expect(fail(card(), { type: "resolve", choice: "custom" })).toBe("input");
    expect(fail(card({ kind: "open", options: "" }), { type: "neither", note: "x" })).toBe("input");
  });
});

describe("transition table", () => {
  const table: Record<CardStatus, string[]> = {
    open: ["resolve", "neither", "note", "defer", "seen"],
    deferred: ["resolve", "neither", "note", "defer", "reopen", "seen"],
    resolved: ["note", "reopen", "applied", "seen"],
  };
  for (const status of CARD_STATUSES) {
    it(`allows exactly ${table[status].join(", ")} from ${status}`, () => {
      const all = ["resolve", "neither", "note", "defer", "reopen", "applied", "seen"] as const;
      expect(all.filter((t) => canApply(status, t))).toEqual(table[status]);
    });
  }
});
