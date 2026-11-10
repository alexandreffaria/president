// @vitest-environment happy-dom
/**
 * The live connection (R4-1): one WebSocket per tab, whose state the indicator shows, and
 * which is reopened with backoff after it drops; the new socket's "ready" makes the page
 * refetch what it missed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMessage } from "../../src/core/api.ts";
import { connectLive, type LiveEvent, type LiveState, retryDelay } from "../../src/web/live.ts";

class FakeWebSocket {
  static all: FakeWebSocket[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.all.push(this);
  }
  send(message: LiveMessage | string) {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.onmessage?.(new MessageEvent("message", { data }));
  }
  /** The server hangs up, or the handshake fails. */
  drop() {
    this.closed = true;
    this.onclose?.();
  }
  close() {
    this.closed = true;
  }
}

const open = () => FakeWebSocket.all.filter((s) => !s.closed);
const closers: (() => void)[] = [];

beforeEach(() => {
  FakeWebSocket.all = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe("live connection", () => {
  it("opens one socket on the page's host and passes its events on", () => {
    const tab = connect();
    expect(FakeWebSocket.all.map((s) => s.url)).toEqual([
      `ws://${window.location.host}/api/events`,
    ]);
    expect(tab.states).toEqual(["connecting"]);
    open()[0]?.send({ type: "ready" });
    expect(tab.states).toEqual(["connecting", "live"]);
    open()[0]?.send({ type: "cards", project: "demo" });
    open()[0]?.send("not json");
    open()[0]?.send('{"type":"ping"}');
    expect(tab.events).toEqual([{ type: "ready" }, { type: "cards", project: "demo" }]);
  });

  it("says offline as soon as the socket closes, and reconnects with backoff", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const tab = connect();
    open()[0]?.send({ type: "ready" });
    open()[0]?.drop();
    expect(tab.states.at(-1)).toBe("offline");
    // The hub is still down: each attempt fails, and the wait doubles.
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.all).toHaveLength(2);
    open()[0]?.drop();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.all).toHaveLength(3);
    // Still offline until the new socket is ready, and then live again; that second
    // "ready" is what makes the page refetch what it missed.
    expect(tab.states.at(-1)).toBe("offline");
    open()[0]?.send({ type: "ready" });
    expect(tab.states.at(-1)).toBe("live");
    expect(tab.events.filter((e) => e.type === "ready")).toHaveLength(2);
    // A ready resets the backoff.
    open()[0]?.drop();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.all).toHaveLength(4);
    expect(open()).toHaveLength(1);
  });

  it("backs off from about 0.5 s to at most about 3 s", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([500, 1000, 2000, 3000, 3000]);
  });

  it("keeps its socket while the tab is hidden", () => {
    connect();
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(open()).toHaveLength(1);
    expect(FakeWebSocket.all).toHaveLength(1);
  });

  it("closes its socket and stops reconnecting when disconnected", () => {
    connect();
    const socket = open()[0];
    closers.pop()?.();
    expect(open()).toHaveLength(0);
    socket?.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.all).toHaveLength(1);
  });

  it("stops a pending reconnect when disconnected", () => {
    connect();
    open()[0]?.drop();
    closers.pop()?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.all).toHaveLength(1);
  });
});
