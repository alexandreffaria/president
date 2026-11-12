/**
 * Card conversations (E): the session's flags (#0004), the per-machine stores (#0018, #0021,
 * #0024, 202611114wet), the neutral pick line (20261111mby8, 2026111272fu), summaries (#0003,
 * #0019, #0020, 20261111paot). Claude Code is the stand-in test/fake-claude.mjs; the real
 * `claude` is never run.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  CardResponse,
  ChatDto,
  ChatStreamEvent,
  ChatSummaryResponse,
  HubEvent,
} from "../src/core/api.ts";
import { createApp } from "../src/server/app.ts";
import { claudeArgs, describeTool, runClaude } from "../src/server/chat/runner.ts";
import { ChatService, KEEP_MISSING_MS } from "../src/server/chat/service.ts";
import { defaultStateDir } from "../src/server/chat/store.ts";
import { Registry } from "../src/server/registry.ts";
import { EventBus } from "../src/server/watcher.ts";
import { copyDemoProject, tempDir } from "./helpers.ts";

const FAKE = join(import.meta.dirname, "fake-claude.mjs");
const ORIGIN = "http://127.0.0.1:4747";
const READONLY_FLAGS = [
  "--restricted",
  "--strict-mcp-config",
  "--tools",
  "Read,Grep,Glob,WebSearch,WebFetch",
  "--allowedTools",
  "WebSearch,WebFetch",
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  "--max-budget-usd",
  "1",
];

interface Call {
  args: string[];
  stdin: string;
  cwd: string;
}

async function setup() {
  const root = await tempDir();
  const registry = new Registry(join(root, "config"));
  const demo = await copyDemoProject();
  await registry.add({ path: demo, name: "demo" });
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const fakeDir = join(root, "fake");
  const claudeDir = join(root, "claude");
  await mkdir(fakeDir, { recursive: true });
  let now = new Date("2026-11-12T10:00:00Z");
  const chat = new ChatService(registry, bus, {
    stateDir: join(root, "state"),
    claudeBin: FAKE,
    claudeDir,
    env: { ...process.env, FAKE_CLAUDE_DIR: fakeDir, CLAUDE_CONFIG_DIR: claudeDir },
    now: () => now,
  });
  const app = createApp({ registry, bus, chat, staticDir: undefined });
  const request = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:4747${path}`, init);
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    });
  const card = async (id = "0002") => {
    const body = (await (await request(`/api/cards/demo/${id}`)).json()) as CardResponse;
    if (!body.ok) throw new Error("broken card");
    return body.card;
  };
  /** Sends a message and reads the whole stream. */
  const send = async (text: string, extra: object = {}, id = "0002") => {
    const response = await post(`/api/chats/demo/${id}/messages`, { text, ...extra });
    expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split("\n");
    return lines.map((line) => JSON.parse(line) as ChatStreamEvent);
  };
  const conversation = async (id = "0002") =>
    (await (await request(`/api/chats/demo/${id}`)).json()) as ChatDto;
  const calls = async (): Promise<Call[]> => {
    const text = await readFile(join(fakeDir, "calls.jsonl"), "utf8").catch(() => "");
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call);
  };
  const script = (steps: object[]) =>
    writeFile(join(fakeDir, "script.json"), JSON.stringify(steps));
  const sessions = async () =>
    JSON.parse(await readFile(join(root, "state", "sessions.json"), "utf8")) as Record<
      string,
      { session?: string; unsummarized?: boolean; revealed?: string; summarized?: number }
    >;
  const deleteTranscripts = () => rm(join(claudeDir, "projects"), { recursive: true, force: true });
  const setNow = (date: Date) => {
    now = date;
  };
  return {
    root,
    demo,
    registry,
    chat,
    events,
    request,
    post,
    card,
    send,
    conversation,
    calls,
    script,
    sessions,
    deleteTranscripts,
    setNow,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("the session's command line (#0004)", () => {
  it("has exactly the read-only flags, the session first", () => {
    expect(claudeArgs({ session: { start: "s-1" } })).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--session-id",
      "s-1",
      ...READONLY_FLAGS,
    ]);
    expect(claudeArgs({ session: { resume: "s-1" } }).slice(4, 6)).toEqual(["--resume", "s-1"]);
    expect(claudeArgs({ session: { oneOff: true } })).toContain("--no-session-persistence");
  });

  it("never puts the message on the command line", async () => {
    const t = await setup();
    await t.send("--why-not-both");
    const [call] = await t.calls();
    expect(call?.args).not.toContain("--why-not-both");
    expect(call?.args.some((a) => a.includes("why-not-both"))).toBe(false);
    expect(call?.stdin).toMatch(/\n\n--why-not-both$/);
  });

  it("runs in the card's project folder", async () => {
    const t = await setup();
    await t.send("Hello");
    expect((await t.calls())[0]?.cwd).toBe(t.demo);
  });

  it("describes tool calls in a few words", () => {
    expect(describeTool("Read", { file_path: "/p/src/http.ts" }, "/p")).toBe("Reading src/http.ts");
    expect(describeTool("WebSearch", { query: "dexie safari" }, "/p")).toBe(
      'Searching the web for "dexie safari"',
    );
  });

  it("says when Claude Code isn't installed", async () => {
    const result = await runClaude({
      bin: join(await tempDir(), "no-such-claude"),
      cwd: await tempDir(),
      session: { oneOff: true },
      message: "hi",
    });
    expect(result).toMatchObject({ ok: false, started: false });
    expect(result.error).toMatch(/couldn't find the `claude` command/);
  });
});

describe("a conversation", () => {
  it("starts a session with an id chosen up front, streams the reply and keeps a copy", async () => {
    const t = await setup();
    const before = await readFile(join(t.demo, "decisions", "0002-api-errors.md"), "utf8");
    const events = await t.send("Does our HTTP client throw on 404?");
    expect(events.map((e) => e.type)).toEqual(["message", "activity", "text", "done"]);
    expect(events[1]).toEqual({ type: "activity", text: "Reading README.md" });
    expect(events[2]).toMatchObject({
      type: "text",
      text: "Echo: Does our HTTP client throw on 404?",
    });

    const [call] = await t.calls();
    const session = call?.args[call.args.indexOf("--session-id") + 1];
    expect(session).toMatch(UUID);
    expect(call?.args).toContain("--append-system-prompt");
    expect(call?.args.join(" ")).toMatch(/decisions\/0002-api-errors\.md/);
    expect((await t.sessions())["demo/0002"]).toEqual({ session, unsummarized: true });

    const chat = await t.conversation();
    expect(chat).toMatchObject({ unsummarized: true, remembers: true, running: false });
    expect(chat.messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "Does our HTTP client throw on 404?"],
      ["agent", "Echo: Does our HTTP client throw on 404?"],
    ]);
    // Chatting never changes the card (#0021).
    expect(await readFile(join(t.demo, "decisions", "0002-api-errors.md"), "utf8")).toBe(before);
    expect(t.events).toContainEqual({ type: "chat", project: "demo", id: "0002" });
  });

  it("resumes the same session for the next message, without new instructions", async () => {
    const t = await setup();
    await t.send("One");
    await t.send("Two");
    const [first, second] = await t.calls();
    const session = first?.args[first.args.indexOf("--session-id") + 1];
    expect(second?.args.slice(4, 6)).toEqual(["--resume", session]);
    expect(second?.args).not.toContain("--append-system-prompt");
    expect((await t.conversation()).messages).toHaveLength(4);
  });

  it("refuses a second message while the agent is answering", async () => {
    const t = await setup();
    await t.script([{ delayMs: 400 }]);
    const slow = t.post("/api/chats/demo/0002/messages", { text: "slow" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const busy = await t.post("/api/chats/demo/0002/messages", { text: "again" });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "chat_busy" });
    expect((await t.conversation()).running).toBe(true);
    await (await slow).text();
    expect((await t.conversation()).running).toBe(false);
  });

  it("keeps a failed run's message and says why", async () => {
    const t = await setup();
    await t.script([
      {
        lines: [
          { type: "system", subtype: "init" },
          { type: "assistant", message: { content: [{ type: "text", text: "Partly..." }] } },
          { type: "result", subtype: "error_max_budget_usd", is_error: true },
        ],
      },
    ]);
    const events = await t.send("Research everything");
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: "The run stopped at its spending cap ($1).",
    });
    expect((await t.conversation()).messages.map((m) => [m.from, m.text])).toEqual([
      ["you", "Research everything"],
      ["agent", "Partly..."],
      ["hub", "No reply: The run stopped at its spending cap ($1)."],
    ]);
  });

  it("validates the message and the card", async () => {
    const t = await setup();
    expect((await t.post("/api/chats/demo/0002/messages", { text: " " })).status).toBe(400);
    expect((await t.post("/api/chats/demo/0099/messages", { text: "x" })).status).toBe(404);
    expect((await t.request("/api/chats/demo/..%2Fx")).status).toBe(400);
    expect((await t.request("/api/chats/nope/0002")).status).toBe(404);
  });

  it("shows nothing for a card without a conversation", async () => {
    const t = await setup();
    expect(await t.conversation()).toEqual({
      messages: [],
      unsummarized: false,
      remembers: true,
      running: false,
    });
  });
});

describe("the pick line (20261111mby8, 2026111272fu)", () => {
  const NOT_REVEALED = /^\(president: The human has not revealed the card's pick\./;
  const REVEALED = /^\(president: The human has revealed the card's pick;/;
  const REPLACED =
    /^\(president: The human revealed an earlier pick on this card, which the new options replaced; they have not revealed the new one\./;

  it("is neutral until the page says the pick was revealed, then free for the conversation", async () => {
    const t = await setup();
    const { revision } = await t.card();
    await t.send("Which one?");
    await t.send("And now?", { revealed: true, revision });
    // The page hides the pick again on the next visit; the conversation stays revealed.
    await t.send("Still?", { revealed: false, revision });
    const stdin = (await t.calls()).map((c) => c.stdin);
    expect(stdin[0]).toMatch(NOT_REVEALED);
    expect(stdin[1]).toMatch(REVEALED);
    expect(stdin[2]).toMatch(REVEALED);
  });

  it("ignores a reveal sent with a revision the card no longer has", async () => {
    const t = await setup();
    await t.send("Which one?", { revealed: true, revision: "stale" });
    expect((await t.calls())[0]?.stdin).toMatch(NOT_REVEALED);
  });

  it("is neutral about a new pick that replaced the revealed one", async () => {
    const t = await setup();
    await t.send("Which one?", { revealed: true, revision: (await t.card()).revision });
    const path = join(t.demo, "decisions", "0002-api-errors.md");
    const text = await readFile(path, "utf8");
    await writeFile(path, text.replace("option: result", "option: throw"));
    await t.send("And now?");
    expect((await t.calls())[1]?.stdin).toMatch(REPLACED);
    // Revealing the new pick frees the chat again.
    await t.send("Now?", { revealed: true, revision: (await t.card()).revision });
    expect((await t.calls())[2]?.stdin).toMatch(REVEALED);
  });
});

describe("when Claude Code no longer has the session (#0018, #0021)", () => {
  it("says the agent no longer remembers, then starts over from the summaries", async () => {
    const t = await setup();
    await t.send("One");
    const old = (await t.sessions())["demo/0002"]?.session;
    await t.deleteTranscripts();
    expect((await t.conversation()).remembers).toBe(false);

    const events = await t.send("Two");
    expect(events[0]).toMatchObject({
      type: "message",
      message: { from: "hub", text: expect.stringMatching(/isn't available on this machine/) },
    });
    const call = (await t.calls())[1];
    expect(call?.args).toContain("--session-id");
    expect(call?.args).not.toContain(old);
    expect(call?.stdin).toMatch(/An earlier conversation about this card isn't available here/);
    const fresh = (await t.sessions())["demo/0002"]?.session;
    expect(fresh).toMatch(UUID);
    expect(fresh).not.toBe(old);
    expect((await t.conversation()).remembers).toBe(true);
  });

  it("starts over when --resume fails although the transcript seemed to be there", async () => {
    const t = await setup();
    await t.send("One");
    await t.script([{ stderr: "No conversation found with session ID: x\n", exit: 1, lines: [] }]);
    const events = await t.send("Two");
    expect(events.flatMap((e) => (e.type === "message" ? [e.message.from] : []))).toEqual([
      "you",
      "hub",
    ]);
    expect(events.at(-1)?.type).toBe("done");
    const [, failed, retried] = await t.calls();
    expect(failed?.args).toContain("--resume");
    expect(retried?.args).toContain("--session-id");
  });

  it("gives the card's summaries to a first conversation on this machine", async () => {
    const t = await setup();
    const path = join(t.demo, "decisions", "0002-api-errors.md");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace(
        /^---\n/,
        "---\nfeedback:\n  - at: 2026-11-10T09:00:00Z\n    type: chat\n    note: Asked about 404s on the laptop.\n",
      ),
    );
    const events = await t.send("Hello");
    expect(events[0]).toMatchObject({ type: "message", message: { from: "hub" } });
    expect((await t.calls())[0]?.stdin).toMatch(/Asked about 404s on the laptop\./);
  });
});

describe("summaries (#0003, #0019, #0020, #0024, 20261111paot)", () => {
  it("asks the session for a summary and saves nothing", async () => {
    const t = await setup();
    await t.send("Does our client throw?");
    const before = await t.card();
    await t.script([{ text: "Discussed with the card's agent. I now see it throws." }]);
    const response = await t.post("/api/chats/demo/0002/summary", {});
    expect(response.status).toBe(200);
    expect((await response.json()) as ChatSummaryResponse).toEqual({
      summary: "Discussed with the card's agent. I now see it throws.",
      fromCopy: false,
    });
    const call = (await t.calls())[1];
    expect(call?.args).toContain("--resume");
    expect(call?.stdin).toMatch(/what the human concluded and what they asked for/);
    expect((await t.card()).revision).toBe(before.revision);
    expect((await t.conversation()).unsummarized).toBe(true);
    // The summary request isn't a message of the conversation.
    expect((await t.conversation()).messages).toHaveLength(2);
  });

  it("writes it from the hub's copy when Claude Code deleted the session", async () => {
    const t = await setup();
    await t.send("Does our client throw?");
    await t.deleteTranscripts();
    const body = (await (
      await t.post("/api/chats/demo/0002/summary", {})
    ).json()) as ChatSummaryResponse;
    expect(body.fromCopy).toBe(true);
    const call = (await t.calls())[1];
    expect(call?.args).toContain("--no-session-persistence");
    expect(call?.args).not.toContain("--resume");
    expect(call?.stdin).toMatch(/Human, .*:\nDoes our client throw\?/);
    expect(call?.stdin).toMatch(/Agent, .*:\nEcho: Does our client throw\?/);
    // Nothing goes to the session store for that run.
    expect(Object.keys(await t.sessions())).toEqual(["demo/0002"]);
  });

  it("has nothing to summarize without new messages", async () => {
    const t = await setup();
    const response = await t.post("/api/chats/demo/0002/summary", {});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "nothing_to_summarize" });
  });

  it("counts the conversation as summarized once the summary is saved", async () => {
    const t = await setup();
    await t.send("Does our client throw?");
    await t.post("/api/chats/demo/0002/summary", {});
    const { revision } = await t.card();
    const saved = await t.post("/api/cards/demo/0002/actions", {
      type: "chat",
      note: "I now see it throws.",
      revision,
    });
    expect(saved.status).toBe(200);
    const after = ((await saved.json()) as CardResponse & { ok: true }).card;
    expect(after.frontmatter.feedback.at(-1)).toMatchObject({
      type: "chat",
      note: "I now see it throws.",
    });
    expect((await t.conversation()).unsummarized).toBe(false);
    expect((await t.sessions())["demo/0002"]?.summarized).toBe(2);

    // A later message makes it unsummarized again; the next summary covers only it.
    await t.send("And on 500?");
    expect((await t.conversation()).unsummarized).toBe(true);
    await t.post("/api/chats/demo/0002/summary", {});
    expect((await t.calls()).at(-1)?.stdin).toMatch(/cover only what came after it/);
  });

  it("undoing a saved summary makes the conversation unsummarized again", async () => {
    const t = await setup();
    await t.send("Does our client throw?");
    const { revision } = await t.card();
    const saved = (await (
      await t.post("/api/cards/demo/0002/actions", { type: "chat", note: "Summary.", revision })
    ).json()) as CardResponse & { ok: true };
    expect((await t.conversation()).unsummarized).toBe(false);
    await t.post("/api/cards/demo/0002/undo", { revision: saved.card.revision });
    expect((await t.conversation()).unsummarized).toBe(true);
    expect((await t.sessions())["demo/0002"]?.summarized).toBeUndefined();
  });

  it("saves the summary and the decision in one write, and undo takes both back (#0019)", async () => {
    const t = await setup();
    await t.send("Does our client throw?");
    const { revision } = await t.card();
    const decided = (await (
      await t.post("/api/cards/demo/0002/actions", {
        type: "resolve",
        choice: "result",
        summary: "I now see it throws.",
        revision,
      })
    ).json()) as CardResponse & { ok: true };
    expect(decided.card.frontmatter.status).toBe("resolved");
    expect(decided.card.frontmatter.feedback.at(-1)).toMatchObject({ type: "chat" });
    expect((await t.conversation()).unsummarized).toBe(false);

    const undone = (await (
      await t.post("/api/cards/demo/0002/undo", { revision: decided.card.revision })
    ).json()) as CardResponse & { ok: true };
    expect(undone.card.frontmatter.status).toBe("open");
    expect(undone.card.frontmatter.feedback.map((f) => f.type)).toEqual(["undo"]);
    expect((await t.conversation()).unsummarized).toBe(true);
  });

  it("saves a summary on a decided card (#0020)", async () => {
    const t = await setup();
    await t.send("Does the README use the new name?", {}, "0004");
    const { revision } = await t.card("0004");
    const saved = await t.post("/api/cards/demo/0004/actions", {
      type: "chat",
      note: "Checked the README.",
      revision,
    });
    expect(saved.status).toBe(200);
    const card = ((await saved.json()) as CardResponse & { ok: true }).card;
    expect(card.frontmatter.status).toBe("resolved");
    expect(card.frontmatter.resolution?.choice).toBe("protomaps");
  });
});

describe("keeping the hub's copy (202611114wet)", () => {
  it("deletes a copy 30 days after its card was first found gone, unless it came back", async () => {
    const t = await setup();
    await t.send("One");
    await t.send("Hello", {}, "0001");
    const path = join(t.demo, "decisions", "0002-api-errors.md");
    const text = await readFile(path, "utf8");
    await rm(path);

    await t.chat.cleanup();
    const missing = JSON.parse(await readFile(join(t.root, "state", "missing.json"), "utf8"));
    expect(missing).toEqual({ "demo/0002": "2026-11-12T10:00:00Z" });

    t.setNow(new Date(Date.parse("2026-11-12T10:00:00Z") + KEEP_MISSING_MS - 1000));
    await t.chat.cleanup();
    expect(await readdir(join(t.root, "state", "chats", "demo"))).toEqual([
      "0001.jsonl",
      "0002.jsonl",
    ]);

    t.setNow(new Date(Date.parse("2026-11-12T10:00:00Z") + KEEP_MISSING_MS));
    await t.chat.cleanup();
    expect(await readdir(join(t.root, "state", "chats", "demo"))).toEqual(["0001.jsonl"]);
    expect(Object.keys(await t.sessions())).toEqual(["demo/0001"]);

    // A card that comes back in time keeps its conversation.
    await rm(join(t.demo, "decisions", "0001-offline-storage.md"));
    await t.chat.cleanup();
    await writeFile(path, text);
    await writeFile(
      join(t.demo, "decisions", "0001-offline-storage.md"),
      text.replace('id: "0002"', 'id: "0001"'),
    );
    await t.chat.cleanup();
    expect(JSON.parse(await readFile(join(t.root, "state", "missing.json"), "utf8"))).toEqual({});
  });

  it("counts an unregistered project's cards as gone", async () => {
    const t = await setup();
    await t.send("One");
    await t.registry.remove("demo");
    await t.chat.cleanup();
    const missing = JSON.parse(await readFile(join(t.root, "state", "missing.json"), "utf8"));
    expect(Object.keys(missing)).toEqual(["demo/0002"]);
  });
});

describe("the state folder", () => {
  it("is $XDG_STATE_HOME/president, or ~/.local/state/president", () => {
    expect(defaultStateDir({ XDG_STATE_HOME: "/x/state" })).toBe("/x/state/president");
    expect(defaultStateDir({ XDG_STATE_HOME: "relative" })).toMatch(/\.local\/state\/president$/);
  });

  it("starts over from a sessions file it can't read, and keeps it aside", async () => {
    const t = await setup();
    await mkdir(join(t.root, "state"), { recursive: true });
    await writeFile(join(t.root, "state", "sessions.json"), "{ not json");
    await t.send("Hello");
    const names = await readdir(join(t.root, "state"));
    expect(names.some((n) => n.startsWith("sessions.json.broken-"))).toBe(true);
    expect((await t.sessions())["demo/0002"]?.session).toMatch(UUID);
  });
});

describe("Neither: new options right away (#0007, 202611111gpm, 2026111272fu, 20261112160s, 20261112dfik)", () => {
  type T = Awaited<ReturnType<typeof setup>>;
  const NOTE = "Both assume a server. Compare on-device storage only.";
  const ANSWER = {
    message: "Here are two on-device options: IndexedDB and plain files.",
    options: [
      {
        id: "indexeddb",
        title: "IndexedDB",
        summary: "Keep errors in the browser's database.",
        pros: ["No setup"],
        cons: ["The browser can clear it"],
        details: "```ts\nawait db.put(error);\n```",
      },
      {
        id: "files",
        title: "Plain files",
        summary: "One file per error.",
        pros: ["Easy to back up"],
        cons: ["No search"],
        details: "Each error is written to `errors/<time>.json`.",
      },
    ],
    recommendation: { option: "files", why: "Simplest to back up." },
  };
  const cardPath = (t: T) => join(t.demo, "decisions", "0002-api-errors.md");

  async function neither(t: T, note = NOTE) {
    const { revision } = await t.card();
    const response = await t.post("/api/cards/demo/0002/actions", {
      type: "neither",
      note,
      revision,
    });
    expect(response.status).toBe(200);
    const card = ((await response.json()) as CardResponse & { ok: true }).card;
    const at = card.frontmatter.feedback.at(-1)?.at as string;
    return { card, at };
  }
  const start = (t: T, note: string, extra: object = {}) =>
    t.post("/api/chats/demo/0002/new-options", { note, ...extra });
  /** Waits for the run to end. */
  async function settled(t: T): Promise<ChatDto> {
    for (let i = 0; i < 250; i++) {
      const chat = await t.conversation();
      if (!chat.running && chat.newOptions?.state !== "started") return chat;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("the run never ended");
  }

  it("records the run as to start and sends nothing until a page starts it", async () => {
    const t = await setup();
    const { at } = await neither(t);
    expect(await t.calls()).toEqual([]);
    const chat = await t.conversation();
    expect(chat.newOptions).toEqual({ note: at, state: "to-start" });
    expect(chat.messages).toEqual([]);
    expect(t.events).toContainEqual({ type: "chat", project: "demo", id: "0002" });
  });

  it("writes the options with update's checks, as a turn in the conversation", async () => {
    const t = await setup();
    await t.send("Is IndexedDB available in the webview?");
    // The human had looked at the old pick in this conversation.
    await t.send("Why that one?", { revealed: true, revision: (await t.card()).revision });
    const before = await t.card();
    const { at } = await neither(t);
    // Summarized since: the run doesn't make it "not summarized" again (shown-no-reminder).
    await t.chat.store.updateEntry({ project: "demo", id: "0002" }, (e) => ({
      ...e,
      unsummarized: false,
    }));
    await t.script([{ structured: ANSWER }]);
    const response = await start(t, at);
    expect(await response.json()).toEqual({ started: true });
    const chat = await settled(t);

    const call = (await t.calls()).at(-1) as Call;
    const session = (await t.sessions())["demo/0002"]?.session as string;
    expect(call.args.slice(4, 6)).toEqual(["--resume", session]);
    expect(call.args).toEqual(expect.arrayContaining(READONLY_FLAGS));
    const schema = JSON.parse(call.args[call.args.indexOf("--json-schema") + 1] as string);
    expect(schema.required).toEqual(["message", "options", "recommendation"]);
    expect(schema.properties.options).toMatchObject({ minItems: 2, maxItems: 2 });
    // The run gets the pick line: this conversation had revealed the pick it replaces.
    expect(call.stdin).toMatch(/^\(president: The human has revealed the card's pick;/);
    expect(call.stdin).toContain(NOTE);
    expect(call.stdin).toContain("don't say which you recommend");

    const card = await t.card();
    expect(card.frontmatter.options.map((o) => o.id)).toEqual(["indexeddb", "files"]);
    expect(card.frontmatter.recommendation).toEqual(ANSWER.recommendation);
    expect(card.frontmatter.needs_new_options).toBeUndefined();
    expect(card.frontmatter.feedback.map((f) => f.type)).toEqual(["neither"]);
    // The hub doesn't run `preside seen`: the working agent still finds the note unread.
    expect(card.frontmatter.seen_at).toBeUndefined();
    expect(card.sections.options.map((s) => [s.id, s.heading, s.markdown])).toEqual([
      ["indexeddb", "IndexedDB", ANSWER.options[0]?.details],
      ["files", "Plain files", ANSWER.options[1]?.details],
    ]);
    expect(card.sections.context).toBe(before.sections.context);
    expect(card.sections.appendix).toBe(before.sections.appendix);
    expect(card.frontmatter.title).toBe(before.frontmatter.title);

    expect(chat.messages.slice(-2).map((m) => [m.from, m.text])).toEqual([
      ["you", `Neither: ${NOTE}`],
      ["agent", `${ANSWER.message}\n\n(The options are now on the card.)`],
    ]);
    expect(chat.unsummarized).toBe(false);
    expect(chat.newOptions).toEqual({ note: at, state: "written" });
    expect(t.events).toContainEqual({ type: "cards", project: "demo" });

    // The new pick is hidden again in the conversation, until r on the new options.
    await t.send("Which one now?");
    expect((await t.calls()).at(-1)?.stdin).toMatch(
      /^\(president: The human revealed an earlier pick on this card, which the new options replaced;/,
    );
    expect((await t.conversation()).unsummarized).toBe(true);
  });

  it("starts a session for a card without a conversation", async () => {
    const t = await setup();
    const { at } = await neither(t);
    await t.script([{ structured: ANSWER }]);
    await start(t, at);
    await settled(t);
    const [call] = await t.calls();
    expect(call?.args[call.args.indexOf("--session-id") + 1]).toMatch(UUID);
    expect(call?.args).toContain("--append-system-prompt");
    expect(call?.stdin).toMatch(/^\(president: The human has not revealed the card's pick\./);
    expect((await t.sessions())["demo/0002"]?.session).toMatch(UUID);
  });

  it("starts at most one run for a note", async () => {
    const t = await setup();
    const { at } = await neither(t);
    await t.script([{ structured: ANSWER, delayMs: 200 }]);
    const responses = await Promise.all([start(t, at), start(t, at)]);
    const started = await Promise.all(
      responses.map(async (r) => ((await r.json()) as { started: boolean }).started),
    );
    expect(started.sort()).toEqual([false, true]);
    await settled(t);
    // The first tab's notice closing after the run started never starts a second one.
    expect(await (await start(t, at)).json()).toEqual({ started: false });
    expect(await t.calls()).toHaveLength(1);
  });

  it("an Undo before the run starts leaves nothing, and no run starts for that note", async () => {
    const t = await setup();
    await t.send("Is IndexedDB available?");
    const { card, at } = await neither(t);
    const undo = await t.post("/api/cards/demo/0002/undo", { revision: card.revision });
    expect(undo.status).toBe(200);
    expect((await t.conversation()).newOptions).toBeUndefined();
    expect(await (await start(t, at)).json()).toEqual({ started: false });
    expect(await t.calls()).toHaveLength(1);
    expect((await t.conversation()).messages).toHaveLength(2);
  });

  it("refuses the Undo once the run started from another tab (refuse-undo)", async () => {
    const t = await setup();
    const { card, at } = await neither(t);
    await t.script([{ structured: ANSWER, delayMs: 300 }]);
    await start(t, at);
    const undo = await t.post("/api/cards/demo/0002/undo", { revision: card.revision });
    expect(undo.status).toBe(409);
    expect(await undo.json()).toMatchObject({
      code: "run_started",
      error: "the run for this note already started from another tab",
    });
    expect((await t.card()).frontmatter.needs_new_options).toBe(true);
    await settled(t);
  });

  it("writes nothing when the options don't pass the card checks, and Try again runs again", async () => {
    const t = await setup();
    const { at } = await neither(t);
    const broken = {
      ...ANSWER,
      options: [ANSWER.options[0], { ...ANSWER.options[1], title: " " }],
    };
    await t.script([{ structured: broken }, { structured: ANSWER }]);
    await start(t, at);
    const failed = await settled(t);
    expect(failed.newOptions).toMatchObject({ note: at, state: "failed" });
    expect(failed.newOptions?.error).toMatch(/^the agent's options didn't pass the card checks \(/);
    expect(failed.messages.at(-1)?.from).toBe("hub");
    expect(failed.messages.at(-1)?.text).toMatch(
      /^Couldn't write new options: the agent's options didn't pass the card checks .*The card waits for the project's agent, as before\.$/s,
    );
    const waiting = await t.card();
    expect(waiting.frontmatter.needs_new_options).toBe(true);
    expect(waiting.frontmatter.options.map((o) => o.id)).toEqual(["throw", "result"]);

    // Try again: the same note, and the session hears why the last answer was refused.
    expect(await (await start(t, at)).json()).toEqual({ started: true });
    const done = await settled(t);
    expect((await t.calls())[1]?.stdin).toContain("Your previous answer couldn't be written");
    expect(done.newOptions?.state).toBe("written");
    expect(done.messages.map((m) => m.from)).toEqual(["you", "hub", "hub", "agent"]);
  });

  it("says why when the run fails or answers without options", async () => {
    const t = await setup();
    const { at } = await neither(t);
    await t.script([
      { lines: [{ type: "result", subtype: "error_max_budget_usd", is_error: true }] },
      {},
    ]);
    await start(t, at);
    expect((await settled(t)).newOptions?.error).toBe("the run stopped at its spending cap ($1)");
    await start(t, at);
    expect((await settled(t)).newOptions?.error).toBe("the agent answered without the options");
  });

  it("refuses to write over a note added while the run was writing", async () => {
    const t = await setup();
    const { at } = await neither(t);
    await t.script([{ structured: ANSWER, delayMs: 400 }]);
    await start(t, at);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { revision } = await t.card();
    await t.post("/api/cards/demo/0002/actions", {
      type: "note",
      note: "Also: Android.",
      revision,
    });
    const chat = await settled(t);
    // The note is now the card's latest feedback; the run is still about the same "neither".
    expect((await t.chat.store.entry({ project: "demo", id: "0002" }))?.newOptions).toMatchObject({
      state: "failed",
      error: "the card changed while the agent was writing them",
    });
    expect(chat.newOptions?.state).toBe("failed");
    expect((await t.card()).frontmatter.needs_new_options).toBe(true);
  });

  it("holds a message sent during the run until the run is over", async () => {
    const t = await setup();
    const { at } = await neither(t);
    await t.script([{ structured: ANSWER, delayMs: 300 }]);
    await start(t, at);
    const events = await t.send("Why drop the server?");
    expect(events.at(-1)?.type).toBe("done");
    const chat = await t.conversation();
    expect(chat.messages.map((m) => m.from)).toEqual(["you", "agent", "you", "agent"]);
    expect(chat.messages[2]?.text).toBe("Why drop the server?");
  });

  it("offers Try again for a run president was shut down during", async () => {
    const t = await setup();
    const { at } = await neither(t);
    await t.chat.store.updateEntry({ project: "demo", id: "0002" }, (e) => ({
      ...e,
      newOptions: { note: at, state: "started" },
    }));
    expect((await t.conversation()).newOptions).toEqual({
      note: at,
      state: "failed",
      error: "the run stopped when president was shut down",
    });
    await t.script([{ structured: ANSWER }]);
    expect(await (await start(t, at)).json()).toEqual({ started: true });
    expect((await settled(t)).newOptions?.state).toBe("written");
  });

  it("no longer shows the record once the card moved on", async () => {
    const t = await setup();
    const { at } = await neither(t);
    // An agent rewrote the options itself before any run started.
    const text = await readFile(cardPath(t), "utf8");
    await writeFile(cardPath(t), text.replace("needs_new_options: true\n", ""));
    expect((await t.conversation()).newOptions).toBeUndefined();
    expect(await (await start(t, at)).json()).toEqual({ started: false });
  });
});
