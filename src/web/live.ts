/**
 * Live updates from the server, over one WebSocket per tab (/api/events).
 *
 * A WebSocket rather than server-sent events because browsers keep WebSockets out of the
 * 6-connections-per-host pool that HTTP/1.1 requests share: a stream per tab used that pool
 * up, and the API calls of every president window then hung. With sockets, any number of
 * tabs and windows can be live at once, hidden or not.
 *
 * The state is the socket's own: "live" once the server says it is subscribed ("ready"),
 * "offline" from the moment it closes until a new socket is ready again. A closed socket is
 * reopened with backoff, and the new socket's "ready" makes the page refetch what it missed.
 */
import type { LiveMessage } from "../core/api.ts";

export type LiveState = "connecting" | "live" | "offline";

export type LiveEvent = LiveMessage;

export interface LiveHandlers {
  onEvent: (event: LiveEvent) => void;
  onState: (state: LiveState) => void;
}

const EVENT_TYPES = new Set<string>(["ready", "cards", "projects"]);

/** Waits before the next reconnect: 0.5 s doubling to 3 s, with jitter. */
export function retryDelay(failures: number): number {
  return Math.min(500 * 2 ** failures, 3000) * (0.75 + Math.random() * 0.5);
}

function eventsUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/events`;
}

/** Keeps a socket open until the returned function is called. */
export function connectLive(handlers: LiveHandlers, url = eventsUrl()): () => void {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;

  const open = () => {
    retry = undefined;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onmessage = (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(String(message.data)) as LiveEvent;
      } catch {
        return;
      }
      if (!EVENT_TYPES.has(event?.type)) return;
      if (event.type === "ready") {
        failures = 0;
        handlers.onState("live");
      }
      handlers.onEvent(event);
    };
    // Every failure ends in "close" (a refused handshake too), so that is the one to watch.
    ws.onclose = () => {
      if (stopped || socket !== ws) return;
      socket = undefined;
      handlers.onState("offline");
      retry = setTimeout(open, retryDelay(failures++));
    };
  };

  handlers.onState("connecting");
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
    socket = undefined;
  };
}
