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
 *
 * The server sends a "ping" message with each heartbeat (HEARTBEAT_MS). A socket that hears
 * nothing for SILENCE_MS (two heartbeats and a half) belongs to a hub that hangs without
 * closing it (stopped, stuck on a slow disk): it is closed and treated like any other drop,
 * so the page says Offline instead of Live while every request hangs.
 */
import { HEARTBEAT_MS, type LiveMessage } from "../core/api.ts";

export type LiveState = "connecting" | "live" | "offline";

/** What the page is told about: everything but the heartbeat's "ping". */
export type LiveEvent = Exclude<LiveMessage, { type: "ping" }>;

export interface LiveHandlers {
  onEvent: (event: LiveEvent) => void;
  onState: (state: LiveState) => void;
}

export interface LiveOptions {
  url?: string;
  /** Give up on a socket that received nothing for this long (ms). */
  silenceMs?: number;
}

/** Two and a half of the server's heartbeats. */
export const SILENCE_MS = HEARTBEAT_MS * 2.5;

const EVENT_TYPES = new Set<string>(["ready", "cards", "projects", "sync"]);

/** Waits before the next reconnect: 0.5 s doubling to 3 s, with jitter. */
export function retryDelay(failures: number): number {
  return Math.min(500 * 2 ** failures, 3000) * (0.75 + Math.random() * 0.5);
}

function eventsUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/events`;
}

/** Keeps a socket open until the returned function is called. */
export function connectLive(handlers: LiveHandlers, options: LiveOptions = {}): () => void {
  const url = options.url ?? eventsUrl();
  const silenceMs = options.silenceMs ?? SILENCE_MS;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;

  /** The socket is gone (closed, or silent too long): say so and try again later. */
  const lost = (ws: WebSocket) => {
    if (stopped || socket !== ws) return;
    clearTimeout(silence);
    socket = undefined;
    handlers.onState("offline");
    retry = setTimeout(open, retryDelay(failures++));
  };

  const open = () => {
    retry = undefined;
    const ws = new WebSocket(url);
    socket = ws;
    // Counted from the start, so a handshake that never completes is given up on too.
    const listen = () => {
      clearTimeout(silence);
      silence = setTimeout(() => {
        ws.close();
        lost(ws);
      }, silenceMs);
    };
    listen();
    ws.onmessage = (message) => {
      listen();
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
    ws.onclose = () => lost(ws);
  };

  handlers.onState("connecting");
  // On the next turn, not now: React's StrictMode (in development) mounts, unmounts and
  // mounts again at once, and a socket opened and closed straight away makes the dev
  // proxy print an EPIPE stack trace. The throwaway mount's cleanup cancels this timer.
  retry = setTimeout(open, 0);
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearTimeout(silence);
    socket?.close();
    socket = undefined;
  };
}
