// @vitest-environment happy-dom
/**
 * The live connection (R4-1): one WebSocket per tab, whose state the indicator shows, and
 * which is reopened with backoff after it drops; the new socket's "ready" makes the page
 * refetch what it missed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectLive,
  type LiveEvent,
  type LiveOptions,
  type LiveState,
  retryDelay,
  SILENCE_MS,
} from "../../src/web/live.ts";
import { FakeWebSocket } from "./harness.ts";

const open = () => FakeWebSocket.instances.filter((s) => !s.closed);
const closers: (() => void)[] = [];

beforeEach(() => {
  // The page's socket says "ready" only when the test sends it.
  FakeWebSocket.install({ autoReady: false });
  vi.useFakeTimers();
});

afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function connect(options: LiveOptions = {}) {
  const tab = { events: [] as LiveEvent[], states: [] as LiveState[] };
  closers.push(
    connectLive(
      {
        onEvent: (event) => tab.events.push(event),
        onState: (state) => tab.states.push(state),
      },
      options,
    ),
  );
  // The first socket opens on the next turn (R5-6).
  vi.advanceTimersByTime(0);
  return tab;
}

describe("live connection", () => {
  it("opens one socket on the page's host and passes its events on", () => {
    const tab = connect();
    expect(FakeWebSocket.instances.map((s) => s.url)).toEqual([
      `ws://${window.location.host}/api/events`,
    ]);
    expect(tab.states).toEqual(["connecting"]);
    open()[0]?.emit({ type: "ready" });
    expect(tab.states).toEqual(["connecting", "live"]);
    open()[0]?.emit({ type: "cards", project: "demo" });
    open()[0]?.emit("not json");
    open()[0]?.emit('{"type":"ping"}');
    expect(tab.events).toEqual([{ type: "ready" }, { type: "cards", project: "demo" }]);
  });

  it("says offline as soon as the socket closes, and reconnects with backoff", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const tab = connect();
    open()[0]?.emit({ type: "ready" });
    open()[0]?.drop();
    expect(tab.states.at(-1)).toBe("offline");
    // The hub is still down: each attempt fails, and the wait doubles.
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    open()[0]?.drop();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
    // Still offline until the new socket is ready, and then live again; that second
    // "ready" is what makes the page refetch what it missed.
    expect(tab.states.at(-1)).toBe("offline");
    open()[0]?.emit({ type: "ready" });
    expect(tab.states.at(-1)).toBe("live");
    expect(tab.events.filter((e) => e.type === "ready")).toHaveLength(2);
    // A ready resets the backoff.
    open()[0]?.drop();
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(4);
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
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("closes its socket and stops reconnecting when disconnected", () => {
    connect();
    const socket = open()[0];
    closers.pop()?.();
    expect(open()).toHaveLength(0);
    socket?.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("says offline and reconnects when the hub goes silent without closing (R5-5)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const tab = connect();
    const first = open()[0];
    first?.emit({ type: "ready" });
    // The heartbeat's pings keep it live; each one restarts the wait.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(SILENCE_MS - 1);
      first?.emit({ type: "ping" });
    }
    expect(tab.states.at(-1)).toBe("live");
    expect(first?.closed).toBe(false);
    expect(tab.events).toEqual([{ type: "ready" }]);
    // A hub that stopped (SIGSTOP, a hung disk) sends nothing and closes nothing.
    vi.advanceTimersByTime(SILENCE_MS);
    expect(tab.states.at(-1)).toBe("offline");
    expect(first?.closed).toBe(true);
    vi.advanceTimersByTime(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    // The late close of the abandoned socket changes nothing.
    first?.drop();
    expect(FakeWebSocket.instances).toHaveLength(2);
    open()[0]?.emit({ type: "ready" });
    expect(tab.states.at(-1)).toBe("live");
  });

  it("gives up on a handshake that never completes", () => {
    const tab = connect({ silenceMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(tab.states).toEqual(["connecting", "offline"]);
    expect(FakeWebSocket.instances[0]?.closed).toBe(true);
  });

  it("opens nothing when disconnected in the same turn, as StrictMode's first mount is (R5-6)", () => {
    const states: LiveState[] = [];
    const stop = connectLive({ onEvent: () => {}, onState: (s) => states.push(s) });
    expect(FakeWebSocket.instances).toHaveLength(0);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(states).toEqual(["connecting"]);
  });

  it("stops a pending reconnect when disconnected", () => {
    connect();
    open()[0]?.drop();
    closers.pop()?.();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
