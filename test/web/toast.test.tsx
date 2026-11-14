// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../../src/web/toast.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function ShowUndo({ run }: { run: () => void }) {
  const toast = useToast();
  useEffect(() => {
    toast("Decided #0001.", { action: { label: "Undo", key: "u", run } });
  }, [toast, run]);
  return null;
}

function render(run: () => void) {
  act(() =>
    root.render(
      <ToastProvider>
        <ShowUndo run={run} />
      </ToastProvider>,
    ),
  );
}

const toastShown = () => host.querySelector(".toast") !== null;

describe("toasts", () => {
  it("use one live region and disappear after a while", () => {
    render(() => {});
    expect(host.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(host.querySelectorAll("[role=status]")).toHaveLength(1);
    expect(toastShown()).toBe(true);
    act(() => vi.advanceTimersByTime(10_000));
    expect(toastShown()).toBe(false);
  });

  it("wait while hovered or focused", () => {
    render(() => {});
    const toast = host.querySelector(".toast") as HTMLElement;
    act(() => {
      toast.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(toastShown()).toBe(true);
    act(() => {
      toast.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    act(() => (host.querySelector(".toast button") as HTMLButtonElement).focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(toastShown()).toBe(true);
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => vi.advanceTimersByTime(10_000));
    expect(toastShown()).toBe(false);
  });

  it("run their action with its key", () => {
    const run = vi.fn();
    render(run);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", cancelable: true }));
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(toastShown()).toBe(false);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", cancelable: true }));
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
});
