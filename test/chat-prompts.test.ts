import { describe, expect, it } from "vitest";
import { isNewConversation, NEW_CONVERSATION } from "../src/core/api.ts";
import { isViewAsked, VIEW_ASKED } from "../src/server/chat/prompts.ts";

describe("isNewConversation", () => {
  it("knows the divider, and the words an earlier build wrote", () => {
    expect(isNewConversation({ from: "hub", text: NEW_CONVERSATION })).toBe(true);
    const old = "New conversation. It starts from the card and its summaries.";
    expect(isNewConversation({ from: "hub", text: old })).toBe(true);
    expect(isNewConversation({ from: "you", text: NEW_CONVERSATION })).toBe(false);
  });
});

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
