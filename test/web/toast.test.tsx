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

function ShowWithClose({ onClose, run }: { onClose: () => void; run: () => void }) {
  const toast = useToast();
  useEffect(() => {
    toast("Asked for new options on #0001.", {
      action: { label: "Undo", key: "u", run },
      onClose,
    });
  }, [toast, onClose, run]);
  return null;
}

describe("a toast's onClose (20261112160s)", () => {
  const renderWithClose = (onClose: () => void, run: () => void = () => {}) =>
    act(() =>
      root.render(
        <ToastProvider>
          <ShowWithClose onClose={onClose} run={run} />
        </ToastProvider>,
      ),
    );

  it("runs once when the time is up, not before", () => {
    const onClose = vi.fn();
    renderWithClose(onClose);
    act(() => vi.advanceTimersByTime(9_000));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs when the toast is dismissed", () => {
    const onClose = vi.fn();
    renderWithClose(onClose);
    act(() => (host.querySelector(".toast-close") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("doesn't run when the action is used", () => {
    const onClose = vi.fn();
    const run = vi.fn();
    renderWithClose(onClose, run);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "u", cancelable: true }));
    });
    act(() => vi.advanceTimersByTime(20_000));
    expect(run).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
