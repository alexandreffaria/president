/**
 * Live updates from the server.
 *
 * Each tab opens its own server-sent events stream, but only while it is visible: a hidden
 * tab closes it, and when the tab is shown again it reconnects, and the stream's "ready"
 * event makes it refetch whatever it missed. Browsers allow 6 connections per host over
 * HTTP/1.1 and a stream holds one, so this keeps the streams to one per window that shows
 * a president tab, however many tabs are open.
 */
import type { HubEvent } from "../core/api.ts";

export type LiveState = "connecting" | "live" | "offline";

/** What the stream delivers: hub events, plus "ready" each time it (re)connects. */
export type LiveEvent = HubEvent | { type: "ready" };

export interface LiveHandlers {
  onEvent: (event: LiveEvent) => void;
  onState: (state: LiveState) => void;
}

const EVENT_TYPES = ["ready", "cards", "projects"] as const;

/** Keeps a stream open while the page is visible. Returns a function that disconnects. */
export function connectLive(handlers: LiveHandlers, url = "/api/events"): () => void {
  let source: EventSource | undefined;

  const open = () => {
    handlers.onState("connecting");
    const stream = new EventSource(url);
    for (const type of EVENT_TYPES) {
      stream.addEventListener(type, (message) => {
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
    stream.onerror = () => {
      handlers.onState(stream.readyState === EventSource.CLOSED ? "offline" : "connecting");
    };
    source = stream;
  };
  const update = () => {
    if (document.hidden) {
      source?.close();
      source = undefined;
    } else if (!source) {
      open();
    }
  };

  update();
  document.addEventListener("visibilitychange", update);
  return () => {
    document.removeEventListener("visibilitychange", update);
    source?.close();
    source = undefined;
  };
}
