/**
 * The card page for the chat tests (chat-*.test.tsx): the whole UI against the real API in
 * process, with test/fake-claude.mjs standing in for Claude Code, and what the tests do on
 * it. Each test file that imports this gets its own page (vitest loads it per file), set up
 * before each test and taken down after.
 */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import type { ChatDto } from "../../src/core/api.ts";
import { createApp } from "../../src/server/app.ts";
import { ChatService } from "../../src/server/chat/service.ts";
import { Registry } from "../../src/server/registry.ts";
import { EventBus } from "../../src/server/watcher.ts";
import { App } from "../../src/web/App.tsx";
import { clearWrites } from "../../src/web/app-writes.ts";
import { clearDrafts } from "../../src/web/drafts.ts";
import { copyDemoProject, tempDir } from "../helpers.ts";
import {
  FakeWebSocket,
  type Intercept,
  pause,
  press,
  settled,
  setWaitMs,
  stubHub,
  until,
} from "./harness.ts";

// Not an act() environment: a reply streams in from a child process and the page refetches
// on live events, so updates land at any time. The tests let React render on its own and
// wait for what they expect to show (until).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
vi.setConfig({ testTimeout: 20_000 });
export const WAIT_MS = 8000;
setWaitMs(WAIT_MS);
const FAKE = join(import.meta.dirname, "..", "fake-claude.mjs");

let root: Root;
export let host: HTMLElement;
export let demo: string;
export let fakeDir: string;
export let claudeDir: string;
let wideScreen = false;
let chat: ChatService;
/** Answers a request instead of the hub when it returns a response. */
let intercept: Intercept | undefined;

/** Answers the page's requests with `next` first (undefined: the hub answers them all). */
export function setIntercept(next: Intercept | undefined): void {
  intercept = next;
}

/** A window wide enough for the panel to sit beside the card, from now on in this test. */
export function setWideScreen(wide: boolean): void {
  wideScreen = wide;
}

beforeEach(async () => {
  const dir = await tempDir();
  const registry = new Registry(join(dir, "config"));
  demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  fakeDir = join(dir, "fake");
  claudeDir = join(dir, "claude");
  await mkdir(fakeDir);
  const bus = new EventBus();
  chat = new ChatService(registry, bus, {
    stateDir: join(dir, "state"),
    claudeBin: FAKE,
    claudeDir,
    env: { ...process.env, FAKE_CLAUDE_DIR: fakeDir, CLAUDE_CONFIG_DIR: claudeDir },
  });
  const app = createApp({ registry, bus, chat, staticDir: undefined });
  bus.subscribe((event) => {
    for (const socket of FakeWebSocket.instances) socket.emit(event);
  });
  stubHub(app, (input, init, hub) => intercept?.(input, init, hub));
  FakeWebSocket.install();
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
  await settled();
  // Before helpers.ts removes the temp folder (hooks run as a stack): a fake-claude run
  // still going never writes into a folder that is gone.
  await chat.close();
  // A reply cut short ends its stream, and the page reads the conversation again: that read
  // still goes to the hub, not past the stub to happy-dom's own origin.
  await settled();
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

export const text = () => host.textContent ?? "";
export const button = (label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(label)) as
    | HTMLButtonElement
    | undefined;

/** Renders the app at the current URL, without waiting for anything. */
export function renderApp(): void {
  root.render(<App />);
}

export async function open(path: string) {
  window.history.replaceState(null, "", path);
  renderApp();
  await until(
    () => text().includes("Ask about this card") || !!host.querySelector(".chat"),
    "the card",
  );
  await settled();
}

/** Mounts the app afresh, keeping what lives in memory (drafts); `open` renders it. */
export function remount(): void {
  root.unmount();
  root = createRoot(host);
}

/** Renders the page again, as after a reload. */
export async function reload(path: string) {
  remount();
  clearDrafts();
  await open(path);
}

export async function typeInto(field: Element | null, value: string) {
  if (!(field instanceof HTMLTextAreaElement)) throw new Error("no such field");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await until(() => field.value === value, "the typed text");
}

export async function click(label: string) {
  const b = button(label);
  if (!b) throw new Error(`no button "${label}": ${text().slice(0, 600)}`);
  b.click();
  await pause();
}

export const messageBox = () =>
  host.querySelector('textarea[aria-label="Message to the card\'s agent"]');

export async function sendMessage(message: string) {
  await until(() => messageBox() !== null, "the message box");
  await typeInto(messageBox(), message);
  await press("Enter", messageBox() as Element);
  await until(() => text().includes(`Echo: ${message}`), "the agent's reply");
  await until(() => !text().includes("The agent is answering"), "the run to end");
}

export const io = <T,>(work: () => Promise<T>): Promise<T> => work();

export const socket = () => FakeWebSocket.last();

/** The hub's view of #0002's conversation, read past the page. */
export const chatCopy = () =>
  fetch("/api/chats/demo/0002").then((res) => res.json() as Promise<ChatDto>);

export const calls = async () =>
  (await io(() => readFile(join(fakeDir, "calls.jsonl"), "utf8").catch(() => "")))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; stdin: string });
