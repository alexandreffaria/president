import { describe, expect, it } from "vitest";
import { isViewAsked, VIEW_ASKED } from "../src/server/chat/prompts.ts";

describe("isViewAsked", () => {
  it("knows a view asked on some options, and the plain value an earlier build stored", () => {
    expect(isViewAsked(`${VIEW_ASKED}:abc123`)).toBe(true);
    expect(isViewAsked(VIEW_ASKED)).toBe(true);
  });

  it("is false for a revealed pick, a replaced one, or nothing", () => {
    expect(isViewAsked("abc123")).toBe(false);
    expect(isViewAsked("replaced")).toBe(false);
    expect(isViewAsked(undefined)).toBe(false);
  });
});
