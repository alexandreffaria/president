// @vitest-environment happy-dom
/**
 * The live connection (R2-10, R3-6): each tab has a stream of its own only while it is
 * visible, so the open streams stay one per window however many tabs there are, and a tab
 * shown again reconnects and refetches what it missed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectLive, type LiveEvent, type LiveState } from "../../src/web/live.ts";

class FakeEventSource {
  static readonly CLOSED = 2;
  static open: FakeEventSource[] = [];
  static created = 0;
  readyState = 1;
  onerror: (() => void) | null = null;
  readonly #listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.created++;
    FakeEventSource.open.push(this);
    queueMicrotask(() => this.emit("ready", {}));
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
  close() {
    this.readyState = 2;
    FakeEventSource.open = FakeEventSource.open.filter((s) => s !== this);
  }
}

let hidden = false;
const closers: (() => void)[] = [];

beforeEach(() => {
  hidden = false;
  FakeEventSource.open = [];
  FakeEventSource.created = 0;
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.unstubAllGlobals();
});

function connect() {
  const tab = { events: [] as LiveEvent[], states: [] as LiveState[] };
  closers.push(
    connectLive({
      onEvent: (event) => tab.events.push(event),
      onState: (state) => tab.states.push(state),
    }),
  );
  return tab;
}

async function setHidden(value: boolean) {
  hidden = value;
  document.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
}

describe("live connection", () => {
  it("opens a stream and passes its events on", async () => {
    const tab = connect();
    await Promise.resolve();
    expect(tab.states).toEqual(["connecting", "live"]);
    FakeEventSource.open[0]?.emit("cards", { type: "cards", project: "demo" });
    expect(tab.events).toEqual([{ type: "ready" }, { type: "cards", project: "demo" }]);
  });

  it("holds no stream while the tab is hidden, and reconnects when it is shown", async () => {
    const tab = connect();
    await Promise.resolve();
    await setHidden(true);
    expect(FakeEventSource.open).toHaveLength(0);
    await setHidden(false);
    expect(FakeEventSource.open).toHaveLength(1);
    expect(FakeEventSource.created).toBe(2);
    // The new stream's "ready" is what makes the page refetch what it missed.
    expect(tab.events.filter((e) => e.type === "ready")).toHaveLength(2);
  });

  it("opens no stream for a tab that starts hidden, until it is shown", async () => {
    hidden = true;
    connect();
    expect(FakeEventSource.created).toBe(0);
    await setHidden(false);
    expect(FakeEventSource.open).toHaveLength(1);
  });

  it("says when the stream is offline", async () => {
    const tab = connect();
    await Promise.resolve();
    const source = FakeEventSource.open[0];
    if (!source) throw new Error("no stream");
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();
    expect(tab.states.at(-1)).toBe("offline");
  });

  it("closes its stream and stops listening when disconnected", async () => {
    connect();
    closers.pop()?.();
    expect(FakeEventSource.open).toHaveLength(0);
    await setHidden(true);
    await setHidden(false);
    expect(FakeEventSource.created).toBe(1);
  });
});
