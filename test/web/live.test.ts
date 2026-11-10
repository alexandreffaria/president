/**
 * The live connection shared by every tab (R2-10): each "tab" here is a connectLive call
 * with its own BroadcastChannel, sharing Node's real BroadcastChannel and Web Locks, as tabs
 * of one browser profile do.
 */
import { afterEach, describe, expect, it } from "vitest";
import { connectLive, type LiveEnv, type LiveEvent, type LiveState } from "../../src/web/live.ts";

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

let run = 0;
const tabs: (() => void)[] = [];

function environment(): LiveEnv {
  return {
    EventSource: FakeEventSource as unknown as LiveEnv["EventSource"],
    BroadcastChannel: globalThis.BroadcastChannel,
    locks: globalThis.navigator.locks,
    // Each test gets its own channel and lock, like a separate browser profile.
    name: `president-live-test-${process.pid}-${++run}`,
    url: "/api/events",
  };
}

function openTab(env: LiveEnv) {
  const tab = { events: [] as LiveEvent[], state: "connecting" as LiveState, close: () => {} };
  tab.close = connectLive(
    {
      onEvent: (event) => tab.events.push(event),
      onState: (state) => {
        tab.state = state;
      },
    },
    env,
  );
  tabs.push(tab.close);
  return tab;
}

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

afterEach(() => {
  for (const close of tabs.splice(0)) close();
  FakeEventSource.open = [];
  FakeEventSource.created = 0;
});

describe("one live connection for every tab", () => {
  it("opens a single stream for ten tabs and relays its events to all of them", async () => {
    const env = environment();
    const all = Array.from({ length: 10 }, () => openTab(env));
    await until(() => all.every((t) => t.state === "live"), "every tab to be live");
    expect(FakeEventSource.created).toBe(1);
    expect(FakeEventSource.open).toHaveLength(1);

    FakeEventSource.open[0]?.emit("cards", { type: "cards", project: "demo", id: "0001" });
    await until(
      () => all.every((t) => t.events.some((e) => e.type === "cards")),
      "the event in every tab",
    );
    for (const tab of all) {
      expect(tab.events.filter((e) => e.type === "cards")).toEqual([
        { type: "cards", project: "demo", id: "0001" },
      ]);
    }
  });

  it("hands the stream to another tab when the leader closes", async () => {
    const env = environment();
    const leader = openTab(env);
    await until(() => leader.state === "live", "the leader");
    const others = [openTab(env), openTab(env)];
    await until(() => others.every((t) => t.state === "live"), "the others to hear it is live");
    expect(FakeEventSource.created).toBe(1);

    const readies = (tab: (typeof others)[number]) =>
      tab.events.filter((e) => e.type === "ready").length;
    const before = others.map(readies);
    leader.close();
    // The next tab takes the lock, opens one new stream, and its "ready" makes every
    // remaining tab refetch what it may have missed.
    await until(() => FakeEventSource.created === 2, "a new stream");
    await until(
      () => others.every((t, i) => readies(t) > (before[i] ?? 0)),
      "ready in every remaining tab",
    );
    expect(FakeEventSource.open).toHaveLength(1);
    FakeEventSource.open[0]?.emit("projects", { type: "projects" });
    await until(
      () => others.every((t) => t.events.some((e) => e.type === "projects")),
      "events from the new leader",
    );
  });

  it("tells every tab when the stream goes offline", async () => {
    const env = environment();
    const [a, b] = [openTab(env), openTab(env)];
    await until(() => a.state === "live" && b.state === "live", "both live");
    const source = FakeEventSource.open[0];
    if (!source) throw new Error("no stream");
    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();
    await until(() => a.state === "offline" && b.state === "offline", "both offline");
  });

  it("falls back to a stream per tab without Web Locks", async () => {
    const env = { ...environment(), locks: undefined };
    const [a, b] = [openTab(env), openTab(env)];
    await until(() => a.state === "live" && b.state === "live", "both live");
    expect(FakeEventSource.created).toBe(2);
  });
});
