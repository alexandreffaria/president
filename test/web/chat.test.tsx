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
import type { ChatDto, LiveMessage } from "../../src/core/api.ts";
import { createApp } from "../../src/server/app.ts";
import { ChatService } from "../../src/server/chat/service.ts";
import { Registry } from "../../src/server/registry.ts";
import { EventBus } from "../../src/server/watcher.ts";
import { App } from "../../src/web/App.tsx";
import { clearWrites } from "../../src/web/app-writes.ts";
import { LOST_CONNECTION } from "../../src/web/chat.ts";
import { clearDrafts } from "../../src/web/drafts.ts";
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
/** Answers a request instead of the hub when it returns a response. */
let intercept:
  | ((
      input: string,
      init: RequestInit,
      hub: () => Promise<Response>,
    ) => Promise<Response> | undefined)
  | undefined;

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
    const hub = () => Promise.resolve(app.fetch(request));
    const response = intercept?.(input, init, hub) ?? hub();
    inFlight.add(response);
    response.finally(() => inFlight.delete(response)).catch(() => {});
    return response;
  });
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  intercept = undefined;
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
  await settled();
}

/**
 * Waits until no request the page started is still out (the card, the queue and the
 * conversation load separately, in no set order), and the effects of what they showed (the
 * page's key handlers) have run.
 */
async function settled() {
  for (let quiet = 0; quiet < 3; ) {
    if (inFlight.size > 0) {
      quiet = 0;
      await Promise.allSettled([...inFlight]);
    } else {
      quiet++;
      await pause();
    }
  }
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

const socket = () => FakeWebSocket.instances.at(-1);

/** The hub's view of #0002's conversation, read past the page. */
const chatCopy = () => fetch("/api/chats/demo/0002").then((res) => res.json() as Promise<ChatDto>);

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

  it("close with Esc or Cancel and keep the edited text as a draft (R1-3)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await click("Write summary");
    const box = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
    await until(() => !!box(), "the summary");
    await until(() => document.activeElement === box(), "focus in the summary");
    await typeInto(box(), "My own summary.");
    await press("Escape", box() as Element);
    await until(() => box() === null, "the box to close");
    expect(window.location.pathname).toBe("/card/demo/0002");
    expect(text()).toContain("Your summary is kept as a draft");
    expect(text()).toContain("Summary draft kept, not saved yet.");
    await until(() => document.activeElement === button("Edit summary"), "focus on Edit summary");
    await click("Edit summary");
    await until(() => box()?.value === "My own summary.", "the draft back");
    await until(() => document.activeElement === box(), "focus in the summary");
    await click("Cancel");
    await until(() => box() === null, "the box to close");
    // The page's keys work again; leaving says the text is kept.
    await press("Escape");
    await until(() => window.location.pathname === "/", "the queue");
    await until(() => text().includes("What you typed on #0002 is kept"), "the leave notice");
  });

  it("a kept draft doesn't reopen its box on coming back or remounting (R2-1)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await click("Write summary");
    const box = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
    await until(() => !!box(), "the summary");
    await press("Escape", box() as Element);
    await until(() => box() === null, "the box to close");
    await press("Escape");
    await until(() => window.location.pathname === "/", "the queue");
    navigate("/card/demo/0002");
    await until(() => text().includes("Summary draft kept, not saved yet."), "the draft notice");
    expect(box()).toBeNull();
    // The app mounted afresh (drafts live in memory, so a page reload starts without one).
    root.unmount();
    root = createRoot(host);
    await open("/card/demo/0002");
    if (!text().includes("Hide conversation")) await press("c");
    await until(() => text().includes("Summary draft kept, not saved yet."), "the draft notice");
    expect(box()).toBeNull();
    // The page's keys aren't held by a box nobody opened.
    await press("Escape");
    await until(() => window.location.pathname === "/", "the queue");
  });

  it("aren't saved while a decision's Undo notice is shown, and saving keeps it (#0020, R1-7)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() =>
      writeFile(join(fakeDir, "script.json"), JSON.stringify([{ text: "It throws." }])),
    );
    await click("Write summary");
    const box = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
    await until(() => box()?.value === "It throws.", "the summary");
    await press("Escape", box() as Element);
    await until(() => box() === null, "the box to close");
    // Deciding with the conversation unsummarized goes through "Before deciding" (#0019),
    // which takes the kept draft as it is; Decide without summary closes the conversation
    // (20261112hq3k).
    await press("1");
    await press("Enter");
    await until(() => !!button("Decide without summary"), "the Before deciding box");
    await click("Decide without summary");
    await until(() => text().includes("Decided #0002"), "the decision");
    navigate("/card/demo/0002");
    // A question after deciding is a new stretch to summarize (#0020).
    await until(() => !!messageBox(), "the panel");
    await sendMessage("And on 500?");
    await click("Write summary");
    // The decision closed the conversation: the summary covers only the new question.
    await until(
      () => /cover only what came after it/.test(box()?.value ?? ""),
      "the summary box again",
    );
    await settled();
    await click("Save summary");
    await until(() => text().includes("can still be undone"), "the refusal");
    const undoToast = () =>
      [...document.querySelectorAll(".toast")].find((t) =>
        t.textContent?.includes("Decided #0002"),
      );
    expect(undoToast()).toBeDefined();
    (undoToast()?.querySelector(".toast-close") as HTMLButtonElement | null)?.click();
    await until(() => undoToast() === undefined, "the Undo notice to close");
    await click("Save summary");
    await until(() => text().includes("Summary saved."), "the save");
  });
});

describe("the conversation, reviewed (PR #27 R1)", () => {
  it("shows images in a reply as links, loading nothing (R1-1)", async () => {
    await io(() =>
      writeFile(
        join(fakeDir, "script.json"),
        JSON.stringify([{ text: "See ![x](http://127.0.0.1:4800/leak?secret=abc) here." }]),
      ),
    );
    await open("/card/demo/0002");
    await press("c");
    await typeInto(messageBox(), "Show me");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("Image: x"), "the reply");
    expect(host.querySelector(".chat img")).toBeNull();
    const link = [...host.querySelectorAll(".chat a")].find((a) => a.textContent === "Image: x");
    expect(link?.getAttribute("href")).toBe("http://127.0.0.1:4800/leak?secret=abc");
  });

  it("puts a message back in the box only when the hub refused it (R1-2)", async () => {
    await open("/card/demo/0002");
    await press("c");
    intercept = (input, init) =>
      init.method === "POST" && input.endsWith("/messages")
        ? Promise.resolve(
            Response.json(
              { error: "the agent is still answering on this card", code: "chat_busy" },
              { status: 409 },
            ),
          )
        : undefined;
    await typeInto(messageBox(), "Refused?");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("the agent is still answering"), "the refusal");
    await until(() => (messageBox() as HTMLTextAreaElement).value === "Refused?", "the text back");

    // Accepted, then the stream breaks: the message is in the conversation, not in the box.
    intercept = (input, init, hub) => {
      if (init.method !== "POST" || !input.endsWith("/messages")) return undefined;
      return hub().then((response) => {
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            const { value } = await reader.read();
            if (value) controller.enqueue(value);
            controller.error(new Error("network error"));
            void reader.cancel();
          },
        });
        return new Response(body, { status: 200, headers: response.headers });
      });
    };
    await typeInto(messageBox(), "Will it survive?");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes(LOST_CONNECTION), "the lost-connection notice");
    expect((messageBox() as HTMLTextAreaElement).value).toBe("");
    expect(text()).toContain("Will it survive?");
    intercept = undefined;
    // The reply is saved on the hub all the same, and shows once the copy is read again.
    await until(() => text().includes("Echo: Will it survive?"), "the saved reply");
  });

  it("moves focus to the message box on c, and back to the button on hiding (R1-4)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await until(() => document.activeElement === messageBox(), "focus in the message box");
    await click("Hide conversation");
    await until(() => host.querySelector(".chat") === null, "the panel to hide");
    await until(
      () => document.activeElement === button("Ask about this card"),
      "focus on the button",
    );
    await click("Ask about this card");
    await until(() => document.activeElement === messageBox(), "focus in the message box");
  });

  it("reminds you on leaving during the first reply (R1-5)", async () => {
    await io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify([{ delayMs: 600 }])));
    await open("/card/demo/0002");
    await press("c");
    await typeInto(messageBox(), "Quick question");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("you"), "your message");
    await press("Escape");
    await until(
      () => text().includes("Your conversation on #0002 isn't summarized"),
      "the leave notice",
    );
  });

  it("reads a streamed reply out once: busy while it streams, status apart (R1-6, R1-9)", async () => {
    await io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify([{ pauseMs: 400 }])));
    await open("/card/demo/0002");
    await press("c");
    const list = () => host.querySelector(".chat-messages") as HTMLElement;
    const status = () => host.querySelector('.chat [role="status"]') as HTMLElement;
    expect(list().getAttribute("aria-live")).toBe("polite");
    expect(list().getAttribute("aria-busy")).toBe("false");
    expect(list().contains(status())).toBe(false);
    await typeInto(messageBox(), "Slowly");
    await press("Enter", messageBox() as Element);
    await until(() => list().getAttribute("aria-busy") === "true", "the list busy");
    expect(status().textContent).not.toBe("");
    await until(() => text().includes("Echo: Slowly"), "the reply");
    const reply = [...list().querySelectorAll("li")].find((li) =>
      li.textContent?.includes("Echo: Slowly"),
    );
    await until(() => list().getAttribute("aria-busy") === "false", "the run to end");
    // The reply that streamed in is the item the saved reply took over, not a second one.
    expect(reply?.isConnected).toBe(true);
    expect(status().textContent).toBe("");
    expect(text().match(/you,/g)).toHaveLength(1);
  });

  it("says a summary is being written while one runs (R1-9)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() =>
      writeFile(
        join(fakeDir, "script.json"),
        JSON.stringify([{ delayMs: 400, text: "A summary." }]),
      ),
    );
    await click("Write summary");
    await until(() => text().includes("The agent is writing a summary…"), "the status");
    await until(() => !!host.querySelector(".chat-summary textarea"), "the summary");
    expect(text()).not.toContain("The agent is answering");
  });

  it("never shows your message twice when a read of the copy crosses a send (R1-10)", async () => {
    await io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify([{ pauseMs: 400 }])));
    await open("/card/demo/0002");
    await press("c");
    // A read of the copy that the hub answers only after the message is saved.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldRead = false;
    intercept = (input, init, hub) => {
      if (init.method || !input.startsWith("/api/chats/")) return undefined;
      intercept = undefined;
      heldRead = true;
      return held.then(hub);
    };
    socket()?.emit({ type: "chat", project: "demo", id: "0002" });
    await pause();
    await typeInto(messageBox(), "Once");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("you,"), "your message");
    release();
    await pause();
    await pause();
    expect(heldRead).toBe(true);
    expect(text().match(/you,/g)).toHaveLength(1);
    // And the reply still streams in.
    expect(host.querySelector(".chat-messages")?.getAttribute("aria-busy")).toBe("true");
    await until(() => text().includes("Echo: Once"), "the reply");
    await until(() => !text().includes("The agent is answering"), "the run to end");
    expect(text().match(/you,/g)).toHaveLength(1);
  });

  it("follows new messages only while the list is scrolled to the bottom (R1-11)", async () => {
    wideScreen = true;
    await open("/card/demo/0002");
    await press("c");
    const list = host.querySelector(".chat-messages") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { configurable: true, get: () => 1000 });
    Object.defineProperty(list, "clientHeight", { configurable: true, get: () => 100 });
    await sendMessage("First");
    expect(list.scrollTop).toBe(1000);
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));
    await sendMessage("Second");
    expect(list.scrollTop).toBe(0);
  });

  it("can be closed without a summary: the reminder goes, the card stays as it was (202611111ky9)", async () => {
    const path = join(demo, "decisions", "0002-api-errors.md");
    const before = await io(() => readFile(path, "utf8"));
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await click("Write summary");
    await until(() => !!host.querySelector(".chat-summary textarea"), "the summary");
    // Enabled once the page has heard that the summary run ended.
    await until(() => button("Close without summary")?.disabled === false, "the button");
    await click("Close without summary");
    await until(() => host.querySelector(".chat-summary") === null, "the box to close");
    await until(() => text().includes("Conversation closed without a summary."), "the notice");
    expect(text()).not.toContain("Conversation not summarized yet.");
    expect(await io(() => readFile(path, "utf8"))).toBe(before);
    // The only button that drops the draft.
    expect(button("Edit summary")).toBeUndefined();
    // Leaving now says nothing about the conversation.
    await press("Escape");
    await until(() => window.location.pathname === "/", "the queue");
    await pause();
    expect(text()).not.toContain("isn't summarized");
  });

  it("Close without summary can be undone: the reminder, the draft and what the next summary covers come back", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() =>
      writeFile(join(fakeDir, "script.json"), JSON.stringify([{ text: "It throws." }])),
    );
    await click("Write summary");
    const box = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
    await until(() => box()?.value === "It throws.", "the summary");
    await until(() => button("Close without summary")?.disabled === false, "the button");
    await click("Close without summary");
    await until(() => text().includes("Conversation closed without a summary."), "the notice");
    const notice = [...document.querySelectorAll(".toast")].find((t) =>
      t.textContent?.includes("Conversation closed without a summary."),
    );
    expect(notice?.querySelector("button")?.textContent).toContain("Undo");
    expect((await io(() => chatCopy())).unsummarized).toBe(false);

    await press("u");
    await until(() => text().includes("The conversation isn't summarized again."), "the undo");
    expect((await io(() => chatCopy())).unsummarized).toBe(true);
    // The draft is back in its box.
    await until(() => box()?.value === "It throws.", "the draft in the box");
    // The next summary covers the whole conversation again, not only what comes after.
    await click("Cancel");
    await io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify([{ text: "Again." }])));
    const summary = await io(() =>
      fetch("/api/chats/demo/0002/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(summary.status).toBe(200);
    expect((await calls()).at(-1)?.stdin).not.toMatch(/cover only what came after it/);
  });
});

describe("Teach me and More info (#0005, 20261111fauj)", () => {
  it("are buttons in the panel; the button's name shows as your message", async () => {
    await open("/card/demo/0002");
    await press("c");
    await click("Teach me");
    await until(() => text().includes("Echo: Keep to this one scenario"), "the lesson");
    await until(() => !text().includes("The agent is answering"), "the run to end");
    expect(host.querySelector(".chat-you .chat-text")?.textContent).toBe("Teach me");
    await click("More info");
    await until(() => text().includes("Echo: More info: research"), "the research");
    const asked = [...host.querySelectorAll(".chat-you .chat-text")].map((p) => p.textContent);
    expect(asked).toEqual(["Teach me", "More info"]);
  });

  it("Teach me on a card with no options asks what you'd want, not which option (20261111fauj)", async () => {
    await open("/card/demo/0003");
    await press("c");
    await click("Teach me");
    await until(() => text().includes("Echo: Keep to this one scenario"), "the lesson");
    const [call] = await calls();
    expect(call?.stdin).toMatch(/what I would want to happen in it/);
  });
});

describe("deciding while a conversation is open (#0019, 20261111is21)", () => {
  const file = () => io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"));
  const deciding = () =>
    host.querySelector("#before-deciding-summary") as HTMLTextAreaElement | null;

  /** A conversation on #0002, then the next run (the summary) answers `summary`. */
  async function talkThenScript(summary: string) {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify([{ text: summary }])));
  }

  it("writes a summary first; Save and decide saves both in one write, and Undo takes both back", async () => {
    await talkThenScript("Discussed with the card's agent. It throws.");
    await press("2");
    await press("Enter");
    await until(() => text().includes("Before deciding: summary of your conversation"), "the box");
    await until(() => deciding()?.value === "Discussed with the card's agent. It throws.", "it");
    expect((await file()).includes("status: open")).toBe(true);
    await typeInto(deciding(), "Discussed with the card's agent. It throws on 404.");
    await click("Save and decide");
    await until(() => text().includes("with the conversation's summary"), "the decision");
    const decided = await file();
    expect(decided).toMatch(/status: resolved/);
    expect(decided).toMatch(/choice: result/);
    expect(decided).toMatch(
      /type: chat\n\s+note: Discussed with the card's agent\. It throws on 404\./,
    );
    await pause();
    expect(text()).not.toContain("isn't summarized");

    await press("u");
    await until(() => text().includes("Undone."), "the undo");
    const undone = await file();
    expect(undone).toMatch(/status: open/);
    expect(undone).not.toMatch(/type: chat/);
    // The summary is back as a kept draft (behind Edit summary, PR #27 R2-1), and the
    // conversation is unsummarized again.
    const box = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
    await until(() => !!button("Edit summary"), "the kept draft");
    await click("Edit summary");
    await until(
      () => box()?.value === "Discussed with the card's agent. It throws on 404.",
      "the summary back",
    );

    // Deciding again (the pick is back too) uses that summary as it is: no second run. The
    // panel's summary box holds the page's keys, so this is the Decide button. The panel's
    // box steps aside while "Before deciding" holds the summary.
    const runs = (await calls()).length;
    await click("Decide");
    await until(
      () => deciding()?.value === "Discussed with the card's agent. It throws on 404.",
      "the box with the kept summary",
    );
    expect(box()).toBeNull();
    expect((await calls()).length).toBe(runs);
    // Esc: back to the card, with the panel's box and its draft as they were.
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    await until(
      () => box()?.value === "Discussed with the card's agent. It throws on 404.",
      "the kept draft again",
    );
  });

  it("Decide without summary also closes the conversation; Undo brings the reminder back (20261112hq3k)", async () => {
    await talkThenScript("A summary.");
    await press("2");
    await press("Enter");
    await until(() => deciding()?.value === "A summary.", "the box");
    await click("Decide without summary");
    await until(() => text().includes("Decided #0002"), "the decision");
    const decided = await file();
    expect(decided).toMatch(/status: resolved/);
    expect(decided).not.toMatch(/type: chat/);
    // No reminder on leaving: the conversation is closed, as Close without summary does.
    await pause();
    await settled();
    expect(text()).not.toContain("isn't summarized");
    const copy = await io(() => chatCopy());
    expect(copy.unsummarized).toBe(false);

    // Undo takes the decision back and the conversation is "not summarized" again, with the
    // summary that was in the box kept as a draft.
    await press("u");
    await until(() => text().includes("Undone."), "the undo");
    await until(() => window.location.pathname === "/card/demo/0002", "the card");
    expect(await file()).toMatch(/status: open/);
    const reopened = await io(() => chatCopy());
    expect(reopened.unsummarized).toBe(true);
    await until(() => !!button("Edit summary"), "the kept draft");
    await press("Escape");
    await until(() => window.location.pathname === "/", "the queue");
    await until(
      () => text().includes("Your conversation on #0002 isn't summarized"),
      "the leave reminder",
    );
  });

  it("Esc goes back to the card without deciding", async () => {
    await talkThenScript("A summary.");
    await press("2");
    await press("Enter");
    await until(() => deciding()?.value === "A summary.", "the box");
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    expect(window.location.pathname).toBe("/card/demo/0002");
    expect(await file()).toMatch(/status: open/);
  });

  it("Decide this as my answer waits for the summary too (20261111is21)", async () => {
    await talkThenScript("Asked about 404s.");
    await press("n");
    const panelText = host.querySelector("#panel-text");
    await typeInto(panelText, "Throw for bugs, results for network failures.");
    await click("Decide this as my answer");
    await until(() => deciding()?.value === "Asked about 404s.", "the box");
    await press("Enter");
    await until(() => text().includes("Decided #0002"), "the decision");
    const decided = await file();
    expect(decided).toMatch(/choice: custom/);
    expect(decided).toMatch(/Throw for bugs, results for network failures\./);
    expect(decided).toMatch(/type: chat\n\s+note: Asked about 404s\./);
  });

  it("decides at once when the conversation is summarized or there is none", async () => {
    await open("/card/demo/0002");
    await press("2");
    await press("Enter");
    await until(() => text().includes("Decided #0002"), "the decision");
    expect(await calls()).toEqual([]);
  });

  it("offers to write one yourself when the summary can't be written", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await io(() =>
      writeFile(
        join(fakeDir, "script.json"),
        JSON.stringify([{ text: "", exit: 1, stderr: "boom" }]),
      ),
    );
    await press("2");
    await press("Enter");
    await until(() => text().includes("Couldn't write the summary"), "the error");
    await typeInto(deciding(), "My own summary.");
    await click("Save and decide");
    await until(() => text().includes("Decided #0002"), "the decision");
    expect(await file()).toMatch(/type: chat\n\s+note: My own summary\./);
  });
});
