// @vitest-environment happy-dom
/**
 * The whole UI against the real API (in process, on a copy of the demo project), driven
 * with key presses the way a keyboard user would.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubEvent } from "../../src/core/api.ts";
import { createApp } from "../../src/server/app.ts";
import { Registry } from "../../src/server/registry.ts";
import { EventBus } from "../../src/server/watcher.ts";
import { App } from "../../src/web/App.tsx";
import { copyDemoProject, tempDir } from "../helpers.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Stands in for the browser's EventSource; tests push hub events through it. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  onerror: (() => void) | null = null;
  readonly #listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
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
  }
}

let root: Root;
let host: HTMLElement;
let demo: string;
let registryFile: string;
let posts: string[];
/** Requests the UI started that haven't finished; awaited before the stubs go away. */
const inFlight = new Set<Promise<Response>>();

beforeEach(async () => {
  const registry = new Registry(join(await tempDir(), "config"));
  demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  registryFile = registry.file;
  const app = createApp({ registry, bus: new EventBus(), staticDir: undefined });
  posts = [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    if (init.method === "POST") posts.push(input);
    const request = new Request(`http://127.0.0.1:4747${input}`, init);
    // A browser adds Origin itself (scripts may not set it, so the DOM's Request drops it).
    request.headers.set("origin", "http://127.0.0.1:4747");
    const response = Promise.resolve(app.fetch(request));
    inFlight.add(response);
    response.finally(() => inFlight.delete(response)).catch(() => {});
    return response;
  });
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("confirm", () => true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  act(() => root.unmount());
  // A refresh can start one more request once the last one finishes: wait until it's quiet.
  for (let quiet = 0; quiet < 3; ) {
    if (inFlight.size > 0) {
      quiet = 0;
      await Promise.allSettled([...inFlight]);
    } else {
      quiet++;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}: ${text().slice(0, 600)}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

async function open(path: string, ready: () => boolean, what: string) {
  window.history.replaceState(null, "", path);
  act(() => root.render(<App />));
  await until(ready, what);
}

const text = () => host.textContent ?? "";
const pathname = () => window.location.pathname;
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label)) as
    | HTMLButtonElement
    | undefined;

async function press(key: string, target: EventTarget = document.activeElement ?? document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Lets pending requests and renders finish. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

const CARD_TITLE = "Where should trip data live on the device?";

describe("card view keyboard", () => {
  it("Enter on a focused button runs that button, never a decision", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    expect(text()).toContain("Selected");
    const neither = button("Neither");
    if (!neither) throw new Error("no Neither button");
    neither.focus();
    const event = await press("Enter", neither);
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(posts).toEqual([]);
    expect(pathname()).toBe("/card/demo/0001");
  });

  it("does nothing to the card while the help dialog is open", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("?", document.body);
    expect(host.querySelector("dialog[open]")).not.toBeNull();
    await press("d");
    await press("d", document.body);
    await settle();
    expect(posts).toEqual([]);
    await press("Escape");
    expect(host.querySelector("dialog")).toBeNull();
    expect(pathname()).toBe("/card/demo/0001");
    await press("?", document.body);
    await press("?");
    expect(host.querySelector("dialog")).toBeNull();
  });

  it("moves focus to the card title when a card opens", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await until(() => document.activeElement?.tagName === "H1", "focus on the title");
    expect(document.activeElement?.textContent).toContain(CARD_TITLE);
  });

  it("decides with Enter on the page, and u undoes it exactly", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    const original = await readFile(file, "utf8");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await press("Enter", document.body);
    await until(() => text().includes("Decided #0001"), "the decision toast");
    expect(await readFile(file, "utf8")).toMatch(/^status: resolved$/m);
    await press("u", document.body);
    await until(() => text().includes("Undone"), "the undo toast");
    expect(await readFile(file, "utf8")).toBe(original);
    expect(posts).toEqual(["/api/cards/demo/0001/actions", "/api/cards/demo/0001/undo"]);
  });

  it("clears a choice when an agent changes the card while it is open", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    expect(text()).toContain("Selected");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "title: IndexedDB through Dexie",
        "title: Something else entirely",
      ),
    );
    await act(async () => {
      FakeEventSource.instances[0]?.emit("cards", {
        type: "cards",
        project: "demo",
      } satisfies HubEvent);
    });
    await until(() => text().includes("your choice was cleared"), "the change notice");
    expect(text()).not.toContain("Selected");
    await press("Enter", document.body);
    await settle();
    expect(posts).toEqual([]);
    // The notice stays until it is dismissed.
    button("Dismiss")?.click();
    await settle();
    expect(text()).not.toContain("your choice was cleared");
  });

  it("puts focus back on the Note button when the note panel closes", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("m", document.body);
    const textarea = host.querySelector("textarea");
    expect(textarea).not.toBeNull();
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(host.querySelector("#panel-text")).toBeNull();
    expect(document.activeElement?.textContent).toMatch(/^Note…/);
  });
});

describe("queue keyboard", () => {
  it("Enter on a focused queue link doesn't open the selected card instead", async () => {
    await open("/", () => host.querySelectorAll(".queue-link").length >= 2, "the queue");
    const links = [...host.querySelectorAll<HTMLAnchorElement>(".queue-link")];
    expect(links[0]?.getAttribute("aria-current")).toBe("true");
    links[1]?.focus();
    const event = await press("Enter", links[1]);
    expect(event.defaultPrevented).toBe(false);
    expect(pathname()).toBe("/");
    // j moves the selection; Enter on the page opens it.
    await press("j", document.body);
    expect(links[1]?.getAttribute("aria-current")).toBe("true");
    await press("Enter", document.body);
    expect(pathname()).toBe(links[1]?.getAttribute("href"));
  });

  it("says each card's priority in words", async () => {
    await open("/", () => host.querySelectorAll(".queue-link").length >= 2, "the queue");
    expect(host.querySelector(".queue-link")?.textContent).toContain("High priority");
  });
});

describe("errors", () => {
  it("says so when a refresh fails, while keeping the cards on screen", async () => {
    await open("/", () => host.querySelectorAll(".queue-link").length >= 2, "the queue");
    await writeFile(registryFile, "{ not json");
    await act(async () => {
      FakeEventSource.instances[0]?.emit("projects", { type: "projects" } satisfies HubEvent);
    });
    await until(() => text().includes("Couldn't refresh"), "the error banner");
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(
      /projects\.json is not valid JSON/,
    );
    expect(host.querySelectorAll(".queue-link").length).toBeGreaterThanOrEqual(2);
  });
});

describe("routing", () => {
  it("shows a not-found page for a malformed address instead of crashing", async () => {
    await open("/card/%E0%A4%A/x", () => text().includes("nothing at this address"), "not found");
  });
});
