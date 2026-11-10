// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/web/components/ErrorBoundary.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Broken(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  it("shows the error inside the page's main landmark, not in a second one", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <ErrorBoundary>
            <main className="main">
              <ErrorBoundary inPage>
                <Broken />
              </ErrorBoundary>
            </main>
          </ErrorBoundary>,
        ),
      );
      expect(host.querySelectorAll("main")).toHaveLength(1);
      expect(host.querySelector("main [role=alert]")?.textContent).toContain("boom");
    } finally {
      act(() => root.unmount());
      host.remove();
      quiet.mockRestore();
    }
  });

  it("is the main landmark itself when it replaces the whole app", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() =>
        root.render(
          <ErrorBoundary>
            <Broken />
          </ErrorBoundary>,
        ),
      );
      expect(host.querySelectorAll("main")).toHaveLength(1);
    } finally {
      act(() => root.unmount());
      host.remove();
      quiet.mockRestore();
    }
  });
});
