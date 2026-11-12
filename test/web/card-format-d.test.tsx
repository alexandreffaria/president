// @vitest-environment happy-dom
/**
 * What D (the card format, #0013 and #0023) shows in the hub: the short form of a dated id,
 * and a conversation summary's label in History.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CardId } from "../../src/web/components/CardId.tsx";
import { FeedbackHistory } from "../../src/web/components/FeedbackHistory.tsx";
import { fullDate } from "../../src/web/format.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

function render(node: ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

describe("CardId (#0013)", () => {
  it("shows a dated id's short form, with the full id in the tooltip", () => {
    const span = render(<CardId id="20261111k7q2" />).querySelector("span");
    expect(span?.textContent).toBe("#k7q2");
    expect(span?.title).toBe("#20261111k7q2");
  });

  it("adds the id's date where the row shows no other date", () => {
    const span = render(<CardId id="20261111k7q2" withDate />).querySelector("span");
    expect(span?.textContent).toBe(`#k7q2 (${fullDate("2026-11-11")})`);
  });

  it("shows a numbered id as before", () => {
    const span = render(<CardId id="0007" withDate />).querySelector("span");
    expect(span?.textContent).toBe("#0007");
    expect(span?.title).toBe("");
  });
});

describe("FeedbackHistory (#0023)", () => {
  it("labels a chat entry Conversation summary", () => {
    const view = render(
      <FeedbackHistory
        feedback={[{ at: "2026-11-12T09:14:00Z", type: "chat", note: "One line per call." }]}
        seenAt={undefined}
      />,
    );
    expect(view.querySelector(".feedback-type")?.textContent).toBe("Conversation summary");
  });
});
