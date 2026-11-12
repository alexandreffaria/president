// @vitest-environment happy-dom
/**
 * The conversation on the card page (E): the panel (#0002, 20261111sblu), the hub's copy
 * shown again (#0018), the reminder and Write summary (#0024, 20261111paot), saving and
 * undoing a summary (#0003, #0020). The whole UI against the real API in process, with
 * test/fake-claude.mjs standing in for Claude Code.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveMessage } from "../../src/core/api.ts";
import { createApp } from "../../src/server/app.ts";
import { ChatService } from "../../src/server/chat/service.ts";
import { Registry } from "../../src/server/registry.ts";
import { EventBus } from "../../src/server/watcher.ts";
import { App } from "../../src/web/App.tsx";
import {
  clearWrites,
  decidedRecently,
  recordDecision,
  UNDO_WINDOW_MS,
} from "../../src/web/app-writes.ts";
import { clearDrafts } from "../../src/web/drafts.ts";
import { clearHeldUndos } from "../../src/web/new-options.ts";
import { navigate } from "../../src/web/router.tsx";
import { copyDemoProject, tempDir } from "../helpers.ts";

// Not an act() environment: a reply streams in from a child process and the page refetches
// on live events, so updates land at any time. The tests let React render on its own and
// wait for what they expect to show (until).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
vi.setConfig({ testTimeout: 20_000 });
const WAIT_MS = 8000;
const FAKE = join(import.meta.dirname, "..", "fake-claude.mjs");

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit({ type: "ready" }));
  }
  emit(message: LiveMessage) {
    if (this.closed) return;
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }
  close() {
    this.closed = true;
  }
}

let root: Root;
let host: HTMLElement;
let demo: string;
let fakeDir: string;
let claudeDir: string;
let wideScreen = false;
const inFlight = new Set<Promise<Response>>();

beforeEach(async () => {
  const dir = await tempDir();
  const registry = new Registry(join(dir, "config"));
  demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  fakeDir = join(dir, "fake");
  claudeDir = join(dir, "claude");
  await mkdir(fakeDir);
  const bus = new EventBus();
  const chat = new ChatService(registry, bus, {
    stateDir: join(dir, "state"),
    claudeBin: FAKE,
    claudeDir,
    env: { ...process.env, FAKE_CLAUDE_DIR: fakeDir, CLAUDE_CONFIG_DIR: claudeDir },
  });
  const app = createApp({ registry, bus, chat, staticDir: undefined });
  bus.subscribe((event) => {
    for (const socket of FakeWebSocket.instances) socket.emit(event);
  });
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const request = new Request(`http://127.0.0.1:4747${input}`, init);
    request.headers.set("origin", "http://127.0.0.1:4747");
    const response = Promise.resolve(app.fetch(request));
    inFlight.add(response);
    response.finally(() => inFlight.delete(response)).catch(() => {});
    return response;
  });
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  wideScreen = false;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wideScreen && query === "(min-width: 1100px)",
    addEventListener() {},
    removeEventListener() {},
  }));
  clearDrafts();
  clearWrites();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  root.unmount();
  for (let quiet = 0; quiet < 3; ) {
    if (inFlight.size > 0) {
      quiet = 0;
      await Promise.allSettled([...inFlight]);
    } else {
      quiet++;
      await pause();
    }
  }
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const text = () => host.textContent ?? "";
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label)) as
    | HTMLButtonElement
    | undefined;

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}: ${text().slice(0, 800)}`);
    }
    await pause();
  }
}

async function open(path: string) {
  window.history.replaceState(null, "", path);
  root.render(<App />);
  await until(
    () => text().includes("Ask about this card") || !!host.querySelector(".chat"),
    "the card",
  );
  // The page's key handlers attach in effects, which run after the render shows.
  await pause();
  await pause();
}

/** Renders the page again, as after a reload. */
async function reload(path: string) {
  root.unmount();
  root = createRoot(host);
  clearDrafts();
  await open(path);
}

/** A key press, once the effects of what just showed (its key handlers) have run. */
async function press(key: string, target: EventTarget = document.body) {
  await pause();
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  await pause();
}

async function typeInto(field: Element | null, value: string) {
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no such field");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => field.value === value, "the typed text");
}

async function click(label: string) {
  const b = button(label);
  if (!b) throw new Error(`no button "${label}": ${text().slice(0, 600)}`);
  b.click();
  await pause();
}

const messageBox = () => host.querySelector('textarea[aria-label="Message to the card\'s agent"]');

async function sendMessage(message: string) {
  await until(() => messageBox() !== null, "the message box");
  await typeInto(messageBox(), message);
  await press("Enter", messageBox() as Element);
  await until(() => text().includes(`Echo: ${message}`), "the agent's reply");
  await until(() => !text().includes("The agent is answering"), "the run to end");
}

const io = <T,>(work: () => Promise<T>): Promise<T> => work();

const calls = async () =>
  (await io(() => readFile(join(fakeDir, "calls.jsonl"), "utf8").catch(() => "")))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; stdin: string });

describe("the conversation panel", () => {
  it("is closed on a card without a conversation and opens with c", async () => {
    await open("/card/demo/0002");
    expect(host.querySelector(".chat")).toBeNull();
    expect(button("Ask about this card")).toBeDefined();
    await press("c");
    await until(() => text().includes("It reads the project and searches the web"), "the panel");
    await press("c");
    await until(() => host.querySelector(".chat") === null, "the panel to hide");
  });

  it("sends a message, shows the reply and offers a summary", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does our HTTP client throw on 404?");
    expect(text()).toContain("you,");
    expect(text()).toContain("Conversation not summarized yet.");
    expect(button("Write summary")).toBeDefined();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the conversation again after a reload, open by default (#0002, #0018)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Why not both?");
    await reload("/card/demo/0002");
    await until(() => text().includes("Echo: Why not both?"), "the kept conversation");
    expect(host.querySelector(".chat")).not.toBeNull();
    expect(text()).toContain("Conversation not summarized yet.");
  });

  it("sits beside the card on a wide window, below the options on a narrow one", async () => {
    await open("/card/demo/0002");
    await press("c");
    await until(() => host.querySelector(".chat-inline") !== null, "the panel in the flow");
    expect(host.querySelector(".card-page-chat")).toBeNull();
    wideScreen = true;
    await reload("/card/demo/0002");
    await press("c");
    await until(() => host.querySelector(".chat-side") !== null, "the side panel");
    expect(host.querySelector(".card-page-chat")).not.toBeNull();
  });

  it("tells the session whether the pick is revealed (20261111mby8)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Which one?");
    await press("r");
    await until(() => text().includes("The agent's take"), "the pick");
    await sendMessage("And now?");
    const [first, second] = await calls();
    expect(first?.stdin).toMatch(/^\(president: The human has not revealed the card's pick\./);
    expect(second?.stdin).toMatch(/^\(president: The human has revealed the card's pick;/);
  });

  it("reminds you on leaving that the conversation isn't summarized (#0024)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await press("Escape");
    await until(
      () =>
        text().includes(
          "Your conversation on #0002 isn't summarized; it's there when you come back.",
        ),
      "the leave notice",
    );
  });
});

describe("summaries", () => {
  it("are written by the agent, edited, saved on the card, and come back on undo", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() =>
      writeFile(
        join(fakeDir, "script.json"),
        JSON.stringify([{ text: "Discussed with the card's agent. It throws." }]),
      ),
    );
    await click("Write summary");
    const box = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
    await until(
      () => box()?.value === "Discussed with the card's agent. It throws.",
      "the summary",
    );
    await typeInto(box(), "Discussed with the card's agent. It throws on 404.");
    await click("Save summary");
    await until(() => text().includes("Summary saved."), "the save");
    expect(text()).toContain("Conversation summary");
    expect(text()).toContain("It throws on 404.");
    await until(() => !text().includes("Conversation not summarized yet."), "the reminder to go");
    const file = await io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"));
    expect(file).toMatch(
      /type: chat\n\s+note: Discussed with the card's agent\. It throws on 404\./,
    );

    await press("u");
    await until(() => text().includes("Undone."), "the undo");
    await until(
      () => box()?.value === "Discussed with the card's agent. It throws on 404.",
      "the summary back",
    );
    await until(
      () => text().includes("Conversation not summarized yet.") || !!box(),
      "the reminder",
    );
    expect(
      await io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8")),
    ).not.toMatch(/type: chat/);
  });

  it("are written from the hub's copy once the agent no longer remembers (20261111paot)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() => rm(join(claudeDir, "projects"), { recursive: true, force: true }));
    await reload("/card/demo/0002");
    await until(
      () => text().includes("The agent no longer remembers this conversation"),
      "the no-longer-remembers line",
    );
    expect(text()).toContain("Not summarized yet.");
    await click("Write summary from these messages");
    await until(() => !!host.querySelector(".chat-summary textarea"), "the summary");
    expect((await calls()).at(-1)?.args).toContain("--no-session-persistence");
  });

  it("can be cancelled with Esc, leaving the conversation unsummarized", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await click("Write summary");
    await until(() => !!host.querySelector(".chat-summary textarea"), "the summary");
    await press("Escape");
    await until(() => host.querySelector(".chat-summary") === null, "the box to close");
    await until(() => text().includes("Conversation not summarized yet."), "the reminder");
    expect(window.location.pathname).toBe("/card/demo/0002");
  });

  it("are never saved inside a decision's Undo window (#0020)", () => {
    recordDecision("demo", "0002", 1000);
    expect(decidedRecently("demo", "0002", 1000 + UNDO_WINDOW_MS - 1)).toBe(true);
    expect(decidedRecently("demo", "0002", 1000 + UNDO_WINDOW_MS)).toBe(false);
    expect(decidedRecently("demo", "0001", 1000)).toBe(false);
  });
});

describe("Neither: new options right away (#0007, 202611111gpm, 20261112160s, 20261112dfik)", () => {
  const NOTE = "Both assume a server. Compare on-device storage only.";
  const ANSWER = {
    message: "Here are two on-device options.",
    options: [
      {
        id: "indexeddb",
        title: "IndexedDB",
        summary: "In the browser's database.",
        pros: ["No setup"],
        cons: ["Can be cleared"],
        details: "Uses `idb`.",
      },
      {
        id: "files",
        title: "Plain files",
        summary: "One file per error.",
        pros: ["Easy to back up"],
        cons: ["No search"],
        details: "Writes `errors/<time>.json`.",
      },
    ],
    recommendation: { option: "files", why: "Simplest to back up." },
  };
  const script = (steps: object[]) =>
    io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify(steps)));
  const dismissToast = () => {
    const close = host.querySelector<HTMLButtonElement>(".toast-close");
    if (!close) throw new Error(`no toast: ${text().slice(0, 600)}`);
    close.click();
  };

  async function askForNewOptions() {
    await open("/card/demo/0002");
    await press("n");
    await typeInto(host.querySelector("#panel-text"), NOTE);
    await click("Ask for new options");
    await until(() => text().includes("Asked for new options on #0002."), "the Undo notice");
  }

  beforeEach(() => clearHeldUndos());

  it("shows the message as pending while Undo is offered, and runs when the notice closes", async () => {
    await script([{ structured: ANSWER }]);
    await askForNewOptions();
    // Back on the card while the notice is still shown: nothing has reached the agent.
    navigate("/card/demo/0002");
    await until(() => text().includes(`Neither: ${NOTE}`), "the pending message");
    expect(text()).toContain("Sending when Undo closes");
    expect(button("Start now")).toBeUndefined();
    expect(await calls()).toEqual([]);

    dismissToast();
    await until(() => text().includes("(The options are now on the card.)"), "the run's reply");
    await until(() => text().includes("Plain files"), "the new options");
    expect(text()).toMatch(/New options, written from your note at /);
    expect(text()).not.toContain("Sending when Undo closes");
    // The new pick stays hidden (#0008, 2026111272fu).
    expect(button("Show the agent's pick")).toBeDefined();
    expect((await calls())[0]?.args).toContain("--json-schema");
  });

  it("an Undo takes the message back, and nothing reaches the agent", async () => {
    await askForNewOptions();
    await press("u");
    await until(() => text().includes("Undone. #0002 is back as it was"), "the undo");
    await until(() => !text().includes(`Neither: ${NOTE}`), "the message to leave");
    await until(
      () => (host.querySelector("#panel-text") as HTMLTextAreaElement | null)?.value === NOTE,
      "the note back in the Neither panel",
    );
    await pause();
    expect(await calls()).toEqual([]);
  });

  it("another page offers Start now, and a failed run offers Try again", async () => {
    await script([
      { lines: [{ type: "result", subtype: "error_max_budget_usd", is_error: true }] },
      { structured: ANSWER },
    ]);
    await askForNewOptions();
    // A reload is another page: it doesn't hold the Undo notice.
    clearHeldUndos();
    await reload("/card/demo/0002");
    await until(() => text().includes("hasn't started"), "the second-tab message");
    expect(text()).toMatch(
      /The run for your note at .+ hasn't started\. If another tab still shows its Undo notice, it starts when that closes\./,
    );
    await click("Start now");
    await until(() => !!button("Try again"), "Try again");
    expect(text()).toContain(
      "Couldn't write new options: the run stopped at its spending cap ($1). The card waits for the project's agent, as before.",
    );
    await click("Try again");
    await until(() => text().includes("(The options are now on the card.)"), "the run's reply");
  });

  it("holds a message sent while the Neither message waits, and sends it after", async () => {
    await script([{ structured: ANSWER }, {}]);
    await askForNewOptions();
    navigate("/card/demo/0002");
    await until(() => text().includes("Sending when Undo closes"), "the pending message");
    await typeInto(messageBox(), "Why drop the server?");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("Sent after your Neither message"), "the held message");
    expect(await calls()).toEqual([]);
    dismissToast();
    await until(() => text().includes("Echo: Why drop the server?"), "the held message's reply");
    const stdin = (await calls()).map((c) => c.stdin);
    expect(stdin[0]).toContain(NOTE);
    expect(stdin[1]).toContain("Why drop the server?");
  });
});
