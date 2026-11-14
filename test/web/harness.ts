/**
 * What the web tests share: waiting for the page, key presses, a stand-in for the browser's
 * WebSocket, and the hub's API answering the page's fetch in process.
 *
 * A file that sets `IS_REACT_ACT_ENVIRONMENT` to true gets these inside act() (React warns
 * about updates outside it); a file that sets it false (a reply streaming in from a child
 * process updates the page at any time) lets React render on its own, and these pause
 * instead.
 */
import { act } from "react";
import { vi } from "vitest";
import type { LiveMessage } from "../../src/core/api.ts";
import { until as untilIn } from "../helpers.ts";

const actEnvironment = () =>
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT === true;

/** Runs `work`, inside act() in an act environment. */
function inAct(work: () => void): void {
  if (actEnvironment()) act(work);
  else work();
}

/** Waits `ms`, letting React render (inside act() in an act environment). */
export async function pause(ms = actEnvironment() ? 10 : 20): Promise<void> {
  const wait = () => new Promise<void>((resolve) => setTimeout(resolve, ms));
  if (actEnvironment()) await act(wait);
  else await wait();
}

let waitMs = 5000;

/** How long `until` waits by default in this file (5 s unless set). */
export function setWaitMs(ms: number): void {
  waitMs = ms;
}

/** Waits until `check` holds; the timeout's error shows the start of the page's text. */
export function until(check: () => boolean, what: string, timeoutMs = waitMs): Promise<void> {
  return untilIn(check, what, {
    timeoutMs,
    everyMs: actEnvironment() ? 10 : 20,
    wait: pause,
    detail: () => (document.body.textContent ?? "").slice(0, 800),
  });
}

/**
 * A key press on `target` (the page by default), returning the event. Outside an act
 * environment it waits before and after, so the effects of what just showed (its key
 * handlers) have run.
 */
export async function press(
  key: string,
  target: EventTarget = document.body,
  init: KeyboardEventInit = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  if (actEnvironment()) {
    await act(async () => {
      target.dispatchEvent(event);
    });
  } else {
    await pause();
    target.dispatchEvent(event);
    await pause();
  }
  return event;
}

/** A key press on what has focus, as in a browser. */
export function pressFocused(key: string): Promise<KeyboardEvent> {
  return press(key, document.activeElement ?? document.body);
}

/** Stands in for the browser's WebSocket; tests push hub events through it. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  /** Off: a new socket says "ready" only when the test calls ready(). */
  static autoReady = true;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoReady) queueMicrotask(() => this.ready());
  }
  /** Forgets the sockets made so far, and stands in for WebSocket. */
  static install({ autoReady = true } = {}): void {
    FakeWebSocket.instances = [];
    FakeWebSocket.autoReady = autoReady;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  }
  /** The tab's current socket. */
  static last(): FakeWebSocket | undefined {
    return FakeWebSocket.instances.at(-1);
  }
  ready() {
    this.emit({ type: "ready" });
  }
  /** The hub sends a message (a string is sent as is); a closed socket gets nothing. */
  emit(message: LiveMessage | string) {
    if (this.closed) return;
    const data = typeof message === "string" ? message : JSON.stringify(message);
    inAct(() => this.onmessage?.(new MessageEvent("message", { data })));
  }
  /** The connection drops (the hub stopped, or the handshake failed). */
  drop() {
    this.closed = true;
    inAct(() => this.onclose?.());
  }
  close() {
    this.closed = true;
  }
}

/** Something that answers requests the way the hub does (createApp's app). */
interface Hub {
  fetch(request: Request): Response | Promise<Response>;
}

/**
 * Answers a request instead of the hub when it returns a response; `hub` asks the hub.
 * Returning undefined lets the hub answer.
 */
export type Intercept = (
  input: string,
  init: RequestInit,
  hub: () => Promise<Response>,
) => Promise<Response> | undefined;

/** Requests the page started that haven't finished; awaited before the stubs go away. */
const inFlight = new Set<Promise<Response>>();

/** Stubs fetch: the page's requests go to `app` in process, as from the hub's own page. */
export function stubHub(app: Hub, intercept?: Intercept): void {
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const hub = () => {
      const request = new Request(`http://127.0.0.1:4747${input}`, init);
      // A browser adds Origin itself (scripts may not set it, so the DOM's Request drops it).
      request.headers.set("origin", "http://127.0.0.1:4747");
      return Promise.resolve(app.fetch(request));
    };
    const response = intercept?.(input, init, hub) ?? hub();
    inFlight.add(response);
    response.finally(() => inFlight.delete(response)).catch(() => {});
    return response;
  });
}

/**
 * Waits until no request the page started is still out, and the effects of what they
 * showed have run. A card page loads the card, the queue and the card's conversation
 * separately, in no set order, and a refresh can start one more request once the last one
 * finishes, so it waits for three quiet turns in a row.
 */
export async function settled(): Promise<void> {
  for (let quiet = 0; quiet < 3; ) {
    if (inFlight.size > 0) {
      quiet = 0;
      const all = () => Promise.allSettled([...inFlight]);
      if (actEnvironment()) {
        await act(async () => {
          await all();
        });
      } else {
        await all();
      }
    } else {
      quiet++;
      await pause();
    }
  }
}
