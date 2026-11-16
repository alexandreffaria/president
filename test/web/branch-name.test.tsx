// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { BranchName } from "../../src/web/components/BranchName.tsx";
import { BrokenCard } from "../../src/web/components/BrokenCard.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rendered(node: React.ReactNode): string {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    act(() => root.render(node));
    return host.textContent ?? "";
  } finally {
    act(() => root.unmount());
    host.remove();
  }
}

describe("the branch a card is on", () => {
  it("shows as on <branch>", () => {
    expect(rendered(<BranchName branch="feat-login" />)).toBe("on feat-login");
  });

  it("shows on a broken card, and not when there is none", () => {
    const broken = { project: "app", fileName: "0001-x.md", id: "0001", errors: ["bad"] };
    expect(rendered(<BrokenCard broken={{ ...broken, branch: "feat" }} />)).toContain(
      "in app (on feat) couldn't be read",
    );
    expect(rendered(<BrokenCard broken={{ ...broken, branch: null }} />)).not.toContain("(on");
  });
});
