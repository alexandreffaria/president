/**
 * Live updates from the server, shared by every president tab.
 *
 * Browsers allow only 6 connections per host over HTTP/1.1, and a server-sent events
 * stream holds one for as long as the page is open. With one stream per tab, a 7th tab
 * never loads and the others stall. So one tab, the leader, holds the only stream and
 * relays its events to the others over a BroadcastChannel. The leader is whoever holds a
 * Web Lock; when its tab closes the lock is released, the next tab takes over and opens
 * the stream, and its "ready" event makes every tab refetch whatever it missed.
 *
 * Without Web Locks or BroadcastChannel (old browsers, some test environments) each tab
 * opens its own stream, as before.
 */
import type { HubEvent } from "../core/api.ts";

export type LiveState = "connecting" | "live" | "offline";

/** What the stream delivers: hub events, plus "ready" each time it (re)connects. */
export type LiveEvent = HubEvent | { type: "ready" };

export interface LiveHandlers {
  onEvent: (event: LiveEvent) => void;
  onState: (state: LiveState) => void;
}

/** The browser APIs used here, so tests can provide their own. */
export interface LiveEnv {
  EventSource: { new (url: string): EventSource; readonly CLOSED: number };
  BroadcastChannel: (new (name: string) => BroadcastChannel) | undefined;
  locks: LockManager | undefined;
  /** Channel and lock name. */
  name: string;
  url: string;
}

type Message =
  | { kind: "event"; event: LiveEvent }
  | { kind: "state"; state: LiveState }
  | { kind: "hello" };

const EVENT_TYPES = ["ready", "cards", "projects"] as const;

export function browserEnv(): LiveEnv {
  return {
    EventSource: globalThis.EventSource,
    BroadcastChannel: globalThis.BroadcastChannel,
    locks: globalThis.navigator?.locks,
    name: "president-live",
    url: "/api/events",
  };
}

/** Connects to the live stream (shared across tabs when possible). Returns a disconnect. */
export function connectLive(handlers: LiveHandlers, env: LiveEnv = browserEnv()): () => void {
  if (!env.locks || !env.BroadcastChannel) return openStream(env, handlers);

  const channel = new env.BroadcastChannel(env.name);
  const abort = new AbortController();
  let state: LiveState = "connecting";
  let leading: { close: () => void; release: () => void } | undefined;
  let closed = false;

  const setState = (next: LiveState) => {
    state = next;
    handlers.onState(next);
  };
  channel.onmessage = (message: MessageEvent<Message>) => {
    const data = message.data;
    if (data.kind === "event") handlers.onEvent(data.event);
    else if (data.kind === "state") setState(data.state);
    else if (data.kind === "hello" && leading) channel.postMessage({ kind: "state", state });
  };

  env.locks
    .request(env.name, { signal: abort.signal }, () => {
      if (closed) return undefined;
      return new Promise<void>((release) => {
        // This tab leads now: open the stream and pass everything on to the other tabs.
        const close = openStream(env, {
          onEvent: (event) => {
            handlers.onEvent(event);
            channel.postMessage({ kind: "event", event } satisfies Message);
          },
          onState: (next) => {
            setState(next);
            channel.postMessage({ kind: "state", state: next } satisfies Message);
          },
        });
        leading = { close, release };
      });
    })
    .catch(() => {
      // Aborted because this tab closed before it became the leader.
    });
  // Ask the leader (if there is one yet) how the stream is doing.
  channel.postMessage({ kind: "hello" } satisfies Message);

  return () => {
    closed = true;
    abort.abort();
    leading?.close();
    leading?.release();
    channel.close();
  };
}

/** One EventSource of our own. */
function openStream(env: LiveEnv, handlers: LiveHandlers): () => void {
  const source = new env.EventSource(env.url);
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      if (type === "ready") {
        handlers.onState("live");
        handlers.onEvent({ type: "ready" });
        return;
      }
      let event: LiveEvent;
      try {
        event = JSON.parse((message as MessageEvent<string>).data) as HubEvent;
      } catch {
        event = { type } as LiveEvent;
      }
      handlers.onEvent(event);
    });
  }
  source.onerror = () => {
    handlers.onState(source.readyState === env.EventSource.CLOSED ? "offline" : "connecting");
  };
  return () => source.close();
}
