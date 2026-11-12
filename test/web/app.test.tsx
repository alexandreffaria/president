// @vitest-environment happy-dom
/**
 * The whole UI against the real API (in process, on a copy of the demo project), driven
 * with key presses the way a keyboard user would.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HubEvent, LiveMessage } from "../../src/core/api.ts";
import { createApp } from "../../src/server/app.ts";
import { Registry } from "../../src/server/registry.ts";
import { EventBus } from "../../src/server/watcher.ts";
import { App } from "../../src/web/App.tsx";
import { clearWrites } from "../../src/web/app-writes.ts";
import { clearDrafts } from "../../src/web/drafts.ts";
import { navigate } from "../../src/web/router.tsx";
import { cardText, copyDemoProject, diffLines, tempDir } from "../helpers.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Each test renders the app and waits for real requests to the in-process API: 0.1-0.5 s
// alone. The first renders pay for code that runs once (markdown and syntax highlighting,
// the YAML parser, the schemas, the first key presses); the warm-up below does that before
// the tests, with its own timeout. With 4 suites at once on 8 cores a test can still take
// 3-6 s, so tests get 15 s, but a wait gives up after 5 s: a stuck test fails in 5 s and
// says what it was waiting for.
vi.setConfig({ testTimeout: 15_000 });
const WAIT_MS = 5000;

/** Stands in for the browser's WebSocket; tests push hub events through it. */
class FakeWebSocket {
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
  ready() {
    this.emit({ type: "ready" });
  }
  emit(message: LiveMessage) {
    if (this.closed) return;
    act(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) })));
  }
  /** The connection drops (the hub stopped, say). */
  drop() {
    this.closed = true;
    act(() => this.onclose?.());
  }
  close() {
    this.closed = true;
  }
}

/** The tab's current socket. */
const socket = () => FakeWebSocket.instances.at(-1);

let root: Root;
let host: HTMLElement;
let demo: string;
let registryEntry: string;
let posts: string[];
/** How many of the next undo requests the hub refuses because a Sync is running. */
let syncingUndos = 0;
/** While set, card reads say the hub's Sync brought in the revision (changedBySync). */
let syncBroughtIn = false;
/** Requests the UI started that haven't finished; awaited before the stubs go away. */
const inFlight = new Set<Promise<Response>>();

beforeAll(async () => {
  await setUp();
  const slow = 30_000;
  await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card", slow);
  await press("?", document.body);
  await press("Escape");
  await press("1", document.body);
  await press("Enter", document.body);
  await until(() => text().includes("Decided #0001"), "the decision toast", slow);
  await press("u", document.body);
  await until(() => text().includes("Undone"), "the undo toast", slow);
  await tearDown();
}, 60_000);

beforeEach(setUp);
afterEach(tearDown);

async function setUp() {
  const registry = new Registry(join(await tempDir(), "config"));
  demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  registryEntry = join(registry.dir, "demo.json");
  const app = createApp({ registry, bus: new EventBus(), staticDir: undefined });
  posts = [];
  syncingUndos = 0;
  syncBroughtIn = false;
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    if (init.method === "POST") posts.push(input);
    if (init.method === "POST" && input.endsWith("/undo") && syncingUndos > 0) {
      // What the hub answers while the project's Sync runs (SyncService.writeCard).
      syncingUndos--;
      return Response.json(
        {
          error: "Sync is running in demo, so nothing was changed; try again when it finishes.",
          code: "syncing",
        },
        { status: 409 },
      );
    }
    const request = new Request(`http://127.0.0.1:4747${input}`, init);
    // A browser adds Origin itself (scripts may not set it, so the DOM's Request drops it).
    request.headers.set("origin", "http://127.0.0.1:4747");
    const response = Promise.resolve(app.fetch(request)).then(async (res) => {
      if (
        !syncBroughtIn ||
        init.method === "POST" ||
        !/^\/api\/cards\/[^/?]+\/[^/?]+/.test(input)
      ) {
        return res;
      }
      // What SyncService.broughtIn says once a Sync's pull brought this revision in.
      const body = (await res.json()) as { ok: boolean; card?: { changedBySync: boolean } };
      if (body.card) body.card.changedBySync = true;
      return Response.json(body, { status: res.status });
    });
    inFlight.add(response);
    response.finally(() => inFlight.delete(response)).catch(() => {});
    return response;
  });
  FakeWebSocket.instances = [];
  FakeWebSocket.autoReady = true;
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("confirm", () => true);
  clearDrafts();
  clearWrites();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
}

async function tearDown() {
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
}

/**
 * Runs the test's own file or API work inside act, so the UI updates that happen while it
 * runs are inside act too (React warns about any that aren't, and test/setup.ts fails the
 * test on that warning).
 */
async function io<T>(work: () => Promise<T>): Promise<T> {
  let result!: T;
  await act(async () => {
    result = await work();
  });
  return result;
}

async function until(check: () => boolean, what: string, timeoutMs = WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${what}: ${text().slice(0, 600)}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

async function open(path: string, ready: () => boolean, what: string, timeoutMs = WAIT_MS) {
  window.history.replaceState(null, "", path);
  act(() => root.render(<App />));
  await until(ready, what, timeoutMs);
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

/** Types into a field the way a person does (React sees an input event). */
async function typeInto(field: Element | null, value: string) {
  if (!(field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement)) {
    throw new Error("no such field");
  }
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** An agent rewriting the card file, and the live event the watcher would send. */
async function agentEdits(file: string, from: string, to: string) {
  await editFile(file, from, to);
  socket()?.emit({
    type: "cards",
    project: "demo",
  } satisfies HubEvent);
}

/** Another president tab adds a note to a card, through the API. */
async function otherTabAddsNote(id: string, note: string) {
  const res = await io(async () => {
    const card = await (await fetch(`/api/cards/demo/${id}`)).json();
    return fetch(`/api/cards/demo/${id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", note, revision: card.card.revision }),
    });
  });
  if (!res.ok) throw new Error(`note failed: ${res.status}`);
}

/** Changes a file the way an agent's editor would. */
function editFile(file: string, from: string, to: string): Promise<void> {
  return io(async () => writeFile(file, (await readFile(file, "utf8")).replace(from, to)));
}

/**
 * Drops the tab's socket, runs `change` while it is down (so the tab gets no event about
 * it), and lets the socket the page reopens say "ready".
 */
async function whileDisconnected(change: () => Promise<void>) {
  FakeWebSocket.autoReady = false;
  const before = FakeWebSocket.instances.length;
  socket()?.drop();
  await until(() => text().includes("Offline"), "the offline indicator");
  await change();
  await until(() => FakeWebSocket.instances.length > before, "the reconnect");
  socket()?.ready();
}

/** Lets pending requests and renders finish. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

const CARD_TITLE = "Where should trip data live on the device?";

describe("card view keyboard", () => {
  it("leaves Enter on a focused button to the button, never a decision", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    expect(text()).toContain("Selected");
    const neither = button("Neither");
    if (!neither) throw new Error("no Neither button");
    neither.focus();
    const event = await press("Enter", neither);
    await settle();
    // Not taken by the page: the browser turns it into a click on the button (happy-dom
    // doesn't, so the click is simulated below).
    expect(event.defaultPrevented).toBe(false);
    expect(posts).toEqual([]);
    expect(pathname()).toBe("/card/demo/0001");
    await act(async () => neither.click());
    expect(host.querySelector("#panel-text")).not.toBeNull();
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

  it("decides with Enter on the page, and u undoes it, telling agents", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    const original = await io(() => readFile(file, "utf8"));
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await press("Enter", document.body);
    await until(() => text().includes("Decided #0001"), "the decision toast");
    expect(await io(() => readFile(file, "utf8"))).toMatch(/^status: resolved$/m);
    await press("u", document.body);
    await until(() => text().includes("Undone. #0001 is undecided again"), "the undo toast");
    // The card as it was, plus the entry that tells agents the decision was taken back.
    const after = await io(() => readFile(file, "utf8"));
    expect(diffLines(original, after).removed).toEqual([]);
    expect(after).toMatch(/type: undo\n\s+note: Took back the decision "dexie"\./);
    await until(() => text().includes("Decision taken back"), "the history entry");
    expect(posts).toEqual(["/api/cards/demo/0001/actions", "/api/cards/demo/0001/undo"]);
  });

  it("keeps Undo within reach when a Sync is running, so it can be tried again (S-5)", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await press("Enter", document.body);
    await until(() => text().includes("Decided #0001"), "the decision toast");
    syncingUndos = 1;
    await press("u", document.body);
    await until(() => text().includes("Not undone yet: Sync is running in demo"), "the refusal");
    // Nothing was undone, and the Undo is offered again, with its key.
    expect(await io(() => readFile(file, "utf8"))).toMatch(/^status: resolved$/m);
    expect(
      [...host.querySelectorAll(".toast button")].some((b) => b.textContent?.includes("Undo")),
    ).toBe(true);
    await press("u", document.body);
    await until(() => text().includes("Undone. #0001 is undecided again"), "the undo toast");
    expect(await io(() => readFile(file, "utf8"))).toMatch(/^status: open$/m);
    expect(posts).toEqual([
      "/api/cards/demo/0001/actions",
      "/api/cards/demo/0001/undo",
      "/api/cards/demo/0001/undo",
    ]);
  });

  it("clears a choice when an agent changes the card while it is open", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    expect(text()).toContain("Selected");
    await editFile(file, "title: IndexedDB through Dexie", "title: Something else entirely");
    socket()?.emit({
      type: "cards",
      project: "demo",
    } satisfies HubEvent);
    await until(() => text().includes("Your choice was cleared"), "the change notice");
    expect(text()).toContain('Option 1 ("Something else entirely") changed: title.');
    expect(text()).not.toContain("Selected");
    await press("Enter", document.body);
    await settle();
    expect(posts).toEqual([]);
    // The notice stays until the human says they read it.
    await act(async () => button("I've read it")?.click());
    expect(text()).not.toContain("Your choice was cleared");
  });

  it("says the change came with Sync when the hub's Sync brought it in, even after a mid-pull reload", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    // The pull rewrites the file; the watcher reloads the card before the Sync knows what
    // it brought in, so this first reload takes it for an agent's change.
    await editFile(file, "title: IndexedDB through Dexie", "title: Something else entirely");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => text().includes("An agent changed this card"), "the first notice");
    // The Sync recorded what it brought in, then sent its own cards event.
    syncBroughtIn = true;
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(
      () =>
        text().includes(
          "Sync just brought in a newer version of this card from the online copy. Read what changed before you act on it.",
        ),
      "the Sync notice",
    );
    expect(text()).not.toContain("An agent changed this card");
    expect(text()).toContain('Option 1 ("Something else entirely") changed: title.');
  });

  it("drops the notice and gives the pick back when the card returns to the version read (S2-6, S3-3)", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    // A reload mid-pull catches the card in between (the remote's version, before this
    // machine's commit is replayed), then the file is back to what the human read.
    await editFile(file, "title: IndexedDB through Dexie", "title: Something else entirely");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => text().includes("Your choice was cleared"), "the notice");
    expect(text()).not.toContain("Selected");
    await editFile(file, "title: Something else entirely", "title: IndexedDB through Dexie");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => !text().includes("An agent changed this card"), "the notice to go");
    expect(text()).toContain("Selected");
    expect(button("I've read it")).toBeUndefined();
  });

  it("keeps a pick made after the clear when the card returns to the version read (S4-4)", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await editFile(file, "title: IndexedDB through Dexie", "title: Something else entirely");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => text().includes("Your choice was cleared"), "the notice");
    // The human picks again, a different option.
    await press("2", document.body);
    await editFile(file, "title: Something else entirely", "title: IndexedDB through Dexie");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => !text().includes("An agent changed this card"), "the notice to go");
    const picked = [...host.querySelectorAll('button[aria-pressed="true"]')];
    expect(picked.map((b) => b.querySelector("kbd")?.textContent)).toEqual(["2"]);
  });

  it("forgets the cleared pick once the human has read the change (S4-4)", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await editFile(file, "title: IndexedDB through Dexie", "title: Something else entirely");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => text().includes("Your choice was cleared"), "the notice");
    await act(async () => button("I've read it")?.click());
    // Another change, then the card is back at the version the human read.
    await editFile(file, "title: Something else entirely", "title: A third title");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => text().includes("An agent changed this card"), "the second notice");
    await editFile(file, "title: A third title", "title: Something else entirely");
    socket()?.emit({ type: "cards", project: "demo" } satisfies HubEvent);
    await until(() => !text().includes("An agent changed this card"), "the notice to go");
    expect(text()).not.toContain("Selected");
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

describe("panels holding unsent text (R2-3)", () => {
  it("keep every page shortcut off while the panel is open, wherever focus is", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    const original = await io(() => readFile(file, "utf8"));
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("n", document.body);
    await typeInto(host.querySelector("#panel-text"), "None of these: we need sync");
    const close = button("Close");
    close?.focus();
    expect(document.activeElement).toBe(close);
    for (const key of ["j", "k", "m", "d", "2", "u", "?"]) await press(key);
    await press("j", document.body);
    await settle();
    expect(pathname()).toBe("/card/demo/0001");
    expect(posts).toEqual([]);
    expect(await io(() => readFile(file, "utf8"))).toBe(original);
    expect(host.querySelector("dialog")).toBeNull();
    expect(text()).not.toContain("Selected");
    expect((host.querySelector("#panel-text") as HTMLTextAreaElement).value).toBe(
      "None of these: we need sync",
    );
    expect(text()).toContain("None of these. What's wrong with them");
  });

  it("close on Esc and keep what was typed as a draft", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("m", document.body);
    await typeInto(host.querySelector("#panel-text"), "Ask Sam first");
    button("Close")?.focus();
    await press("Escape");
    await settle();
    expect(host.querySelector("#panel-text")).toBeNull();
    expect(pathname()).toBe("/card/demo/0001");
    expect(text()).toContain("kept as a draft");
    await press("m", document.body);
    expect((host.querySelector("#panel-text") as HTMLTextAreaElement).value).toBe("Ask Sam first");
    // Discard is the explicit way to throw it away.
    await act(async () => button("Discard")?.click());
    await press("m", document.body);
    expect((host.querySelector("#panel-text") as HTMLTextAreaElement).value).toBe("");
  });

  it("never defers a card over a typed reason, and keeps it when leaving", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    const original = await io(() => readFile(file, "utf8"));
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await typeInto(host.querySelector(".decision-note"), "Works offline");
    button("Decide")?.focus();
    await press("d");
    await settle();
    expect(posts).toEqual([]);
    expect(await io(() => readFile(file, "utf8"))).toBe(original);
    expect(text()).toContain("isn't sent");
    // Esc still goes back to the queue, and nothing typed is lost.
    await press("Escape");
    await until(() => pathname() === "/", "the queue");
    await until(() => text().includes("What you typed on #0001 is kept"), "the kept toast");
    await act(async () => navigate("/card/demo/0001"));
    await until(() => text().includes(CARD_TITLE), "the card again");
    expect(text()).toContain("Selected");
    expect((host.querySelector(".decision-note") as HTMLInputElement).value).toBe("Works offline");
  });
});

describe("changes under the human (R2-7, R2-8, R2-12)", () => {
  it("refuses a note written against options an agent has since rewritten", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("n", document.body);
    const panel = host.querySelector("#panel-text");
    await typeInto(panel, "I reject: ");
    await agentEdits(file, "title: IndexedDB through Dexie", "title: REWRITTEN OPTION");
    await until(() => text().includes("An agent changed this card"), "the change notice");
    expect(text()).toContain('Option 1 ("REWRITTEN OPTION") changed: title.');
    const before = await io(() => readFile(file, "utf8"));
    await act(async () => {
      host
        .querySelector("#panel-text")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
        );
    });
    await until(() => text().includes("nothing was sent"), "the refusal");
    expect(await io(() => readFile(file, "utf8"))).toBe(before);
    expect((host.querySelector("#panel-text") as HTMLTextAreaElement).value).toBe("I reject: ");
    // Once they have read the change, the same note goes through.
    await act(async () => button("I've read it")?.click());
    await act(async () => {
      host
        .querySelector("#panel-text")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
        );
    });
    await until(() => text().includes("Asked for new options on #0001"), "the neither toast");
    expect(await io(() => readFile(file, "utf8"))).toMatch(/type: neither\n\s+note: "I reject:"\n/);
  });

  it("never blames an agent for the human's own undo, from any view", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await press("Enter", document.body);
    await until(() => text().includes("Decided #0001"), "the decision toast");
    // Open the decided card again (as from the Decisions page), then undo.
    await act(async () => navigate("/card/demo/0001"));
    await until(() => text().includes("This decision is made"), "the decided card");
    await press("u", document.body);
    await until(() => text().includes("Undone"), "the undo toast");
    await until(() => host.querySelector(".decision-note") !== null, "the reopened card");
    await settle();
    expect(text()).not.toContain("An agent changed");
  });

  it("says a change came from another president tab, not an agent", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await otherTabAddsNote("0001", "from tab 2");
    socket()?.emit({
      type: "cards",
      project: "demo",
    } satisfies HubEvent);
    await until(() => text().includes("another president tab"), "the notice");
    expect(text()).not.toContain("An agent changed");
    expect(text()).toContain("A note was added.");
  });

  it("knows the human's own change from another tab even when this tab missed it (R3-6)", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await whileDisconnected(() => otherTabAddsNote("0001", "while this tab was offline"));
    await until(() => text().includes("another president tab"), "the notice");
    expect(text()).not.toContain("An agent changed");
    expect(text()).toContain("A note was added.");
  });

  it("says an agent changed the card even when this tab missed the event", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await whileDisconnected(() =>
      editFile(file, "title: IndexedDB through Dexie", "title: RENAMED"),
    );
    await until(() => text().includes("An agent changed"), "the notice");
    expect(text()).toContain('Option 1 ("RENAMED") changed: title.');
  });

  it("drops a card's undo once the human acts on that card again", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await press("Enter", document.body);
    await until(() => text().includes("Decided #0001"), "the decision toast");
    await act(async () => navigate("/card/demo/0001"));
    await until(() => text().includes("This decision is made"), "the decided card");
    await act(async () => button("Reopen")?.click());
    await until(() => text().includes("Reopened #0001"), "the reopen toast");
    // Only the reopen can be undone now: the decision's Undo is gone.
    expect(
      [...host.querySelectorAll("button")].filter((b) => b.textContent?.includes("Undo")),
    ).toHaveLength(1);
    const undos = () => posts.filter((p) => p.endsWith("/undo")).length;
    await press("u", document.body);
    await until(() => text().includes("This decision is made"), "the decision, back");
    expect(undos()).toBe(1);
    await press("u", document.body);
    await settle();
    expect(undos()).toBe(1);
  });
});

describe("undo puts back what was written (R3-4)", () => {
  const ctrlEnter = () =>
    act(async () => {
      host
        .querySelector("#panel-text")
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
        );
    });

  it("reopens the Neither panel with its text", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("n", document.body);
    await typeInto(host.querySelector("#panel-text"), "None of these work offline");
    await ctrlEnter();
    await until(() => text().includes("Asked for new options on #0001"), "the neither toast");
    expect(pathname()).not.toBe("/card/demo/0001");
    await press("u", document.body);
    await until(
      () =>
        pathname() === "/card/demo/0001" &&
        (host.querySelector("#panel-text") as HTMLTextAreaElement | null)?.value ===
          "None of these work offline",
      "the panel with the text",
    );
    expect(text()).toContain("with what you wrote");
    expect(text()).not.toContain("An agent changed");
  });

  it("reopens the Note panel with its text, and takes the note back from the card (R4-10)", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    const original = await io(() => readFile(file, "utf8"));
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("m", document.body);
    await typeInto(host.querySelector("#panel-text"), "Sent too soon");
    await ctrlEnter();
    await until(() => text().includes("Note added."), "the note toast");
    expect(await io(() => readFile(file, "utf8"))).toContain("Sent too soon");
    expect(host.querySelector("#panel-text")).toBeNull();
    await press("u", document.body);
    await until(
      () =>
        (host.querySelector("#panel-text") as HTMLTextAreaElement | null)?.value ===
        "Sent too soon",
      "the Note panel with the text",
    );
    expect(text()).toContain("with what you wrote");
    expect(await io(() => readFile(file, "utf8"))).toBe(original);
  });

  it("undoes a reopen (R4-10)", async () => {
    const file = join(demo, "decisions", "0004-map-tiles.md");
    const original = await io(() => readFile(file, "utf8"));
    await open("/card/demo/0004", () => text().includes("This decision is made"), "the card");
    await act(async () => button("Reopen")?.click());
    await until(() => text().includes("Reopened #0004"), "the reopen toast");
    expect(await io(() => readFile(file, "utf8"))).not.toBe(original);
    await press("u", document.body);
    await until(() => text().includes("Undone"), "the undo toast");
    await until(() => text().includes("This decision is made"), "the decision, back");
    expect(await io(() => readFile(file, "utf8"))).toBe(original);
  });

  it("brings back the choice and the why of a decision", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await typeInto(host.querySelector(".decision-note"), "Works offline");
    await press("Enter", document.body);
    await until(() => text().includes("Decided #0001"), "the decision toast");
    await press("u", document.body);
    await until(
      () =>
        (host.querySelector(".decision-note") as HTMLInputElement | null)?.value ===
        "Works offline",
      "the why",
    );
    expect(text()).toContain("Selected");
  });
});

describe("the change notice and focus (R3-5)", () => {
  it("takes focus to the notice when a send is refused, and back to the text after", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("m", document.body);
    await typeInto(host.querySelector("#panel-text"), "my note");
    await agentEdits(file, "title: IndexedDB through Dexie", "title: RENAMED");
    await until(() => text().includes("An agent changed"), "the change notice");
    const textarea = host.querySelector<HTMLTextAreaElement>("#panel-text");
    textarea?.focus();
    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    await until(() => text().includes("nothing was sent"), "the refusal");
    await until(
      () => document.activeElement?.textContent === "I've read it",
      "focus on the notice's button",
    );
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    await settle();
    expect(text()).not.toContain("An agent changed");
    expect(document.activeElement?.id).toBe("panel-text");
    expect((document.activeElement as HTMLTextAreaElement).value).toBe("my note");
  });
});

describe("what counts as a change to read again (R3-8)", () => {
  it("clears the choice when an agent changes the priority", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await agentEdits(file, "priority: high", "priority: low");
    await until(() => text().includes("Your choice was cleared"), "the notice");
    expect(text()).toContain("It is now low priority (was high priority).");
    expect(text()).not.toContain("Selected");
  });
});

describe("defer with unsent text (R3-9)", () => {
  it("refuses from the Defer button as it does from d", async () => {
    const file = join(demo, "decisions", "0001-offline-storage.md");
    const original = await io(() => readFile(file, "utf8"));
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("1", document.body);
    await typeInto(host.querySelector(".decision-note"), "Works offline");
    await act(async () => button("Defer")?.click());
    await settle();
    expect(posts).toEqual([]);
    expect(await io(() => readFile(file, "utf8"))).toBe(original);
    expect(text()).toContain("isn't sent");
    expect(pathname()).toBe("/card/demo/0001");
  });
});

describe("focus after leaving a card (R2-15)", () => {
  it("lands on the queue's heading, not on the page body", async () => {
    await open("/card/demo/0001", () => text().includes(CARD_TITLE), "the card");
    await press("Escape", document.body);
    await until(() => pathname() === "/", "the queue");
    await until(() => document.activeElement?.tagName === "H1", "focus on the heading");
    expect(document.activeElement?.textContent).toBe("Queue");
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

describe("the connection indicator (R5-7)", () => {
  it("is a status region whose explanation screen readers get, not a tooltip", async () => {
    await open("/", () => text().includes("Live"), "the live indicator");
    const status = host.querySelector(".connection");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.hasAttribute("title")).toBe(false);
    expect(status?.textContent).toBe("Live: changes on disk show up automatically");
    expect(status?.querySelector(".sr-only")?.textContent).toMatch(/^: changes on disk/);
    FakeWebSocket.autoReady = false;
    socket()?.drop();
    // The same element changes, so it is announced.
    expect(host.querySelector(".connection")).toBe(status);
    expect(status?.textContent).toMatch(/^Offline: not connected to the server, retrying/);
  });
});

describe("the queue after a reconnect (R5-4)", () => {
  it("shows a card an agent added while the socket was down", async () => {
    await open("/", () => host.querySelectorAll(".queue-link").length >= 2, "the queue");
    const before = host.querySelectorAll(".queue-link").length;
    // A file write while the tab is offline: no event reaches it, only the new "ready".
    await whileDisconnected(() =>
      io(() =>
        writeFile(
          join(demo, "decisions", "0009-new-question.md"),
          cardText({ id: '"0009"', title: "A question added while offline" }),
        ),
      ),
    );
    await until(() => text().includes("A question added while offline"), "the new card");
    expect(host.querySelectorAll(".queue-link")).toHaveLength(before + 1);
  });
});

describe("errors", () => {
  it("says so when a refresh fails, while keeping the cards on screen", async () => {
    await open("/", () => host.querySelectorAll(".queue-link").length >= 2, "the queue");
    await io(() => writeFile(registryEntry, "{ not json"));
    socket()?.emit({ type: "projects" } satisfies HubEvent);
    await until(() => text().includes("Couldn't refresh"), "the error banner");
    expect(host.querySelector("[role=alert]")?.textContent).toMatch(/demo\.json is not valid JSON/);
    expect(host.querySelectorAll(".queue-link").length).toBeGreaterThanOrEqual(2);
  });

  it("says on the Projects page when a project's folder is gone (R5-21)", async () => {
    await io(() => rm(demo, { recursive: true }));
    await open("/projects", () => text().includes("is missing"), "the missing folder");
    expect(host.querySelector(".project .notice-warn")?.textContent).toBe(
      `the project folder ${demo} is missing. If it moved, remove this project and add it again from its new place.`,
    );
  });
});

describe("routing", () => {
  it("shows a not-found page for a malformed address instead of crashing", async () => {
    await open("/card/%E0%A4%A/x", () => text().includes("nothing at this address"), "not found");
  });
});
