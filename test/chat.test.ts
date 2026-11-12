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

  it("closes a conversation without a summary: the reminder goes, the card isn't written (202611111ky9)", async () => {
    const t = await setup();
    await t.send("Does our client throw?");
    const path = join(t.demo, "decisions", "0002-api-errors.md");
    const before = await readFile(path, "utf8");
    const closed = await t.post("/api/chats/demo/0002/close", {});
    expect(closed.status).toBe(200);
    expect(((await closed.json()) as ChatDto).unsummarized).toBe(false);
    expect(await readFile(path, "utf8")).toBe(before);
    expect((await t.sessions())["demo/0002"]?.unsummarized).toBeUndefined();
    expect((await t.conversation()).messages).toHaveLength(2);
    expect(t.events).toContainEqual({ type: "chat", project: "demo", id: "0002" });
    const nothing = await t.post("/api/chats/demo/0002/summary", {});
    expect(await nothing.json()).toMatchObject({ code: "nothing_to_summarize" });

    // A later message is a new reminder, and its summary covers only what came after.
    await t.send("And on 500?");
    expect((await t.conversation()).unsummarized).toBe(true);
    await t.post("/api/chats/demo/0002/summary", {});
    expect((await t.calls()).at(-1)?.stdin).toMatch(/cover only what came after it/);
  });

  it("closing without a summary needs a JSON body and a card that exists", async () => {
    const t = await setup();
    expect((await t.post("/api/chats/demo/0099/close", {})).status).toBe(404);
    const noBody = await t.request("/api/chats/demo/0002/close", {
      method: "POST",
      headers: { origin: ORIGIN },
    });
    expect(noBody.status).toBeGreaterThanOrEqual(400);
  });
});

describe("Teach me and More info (#0005, 20261111fauj)", () => {
  /** Presses a panel button and reads the whole stream. */
  const ask = async (t: Awaited<ReturnType<typeof setup>>, what: string, id = "0002") => {
    const response = await t.post(`/api/chats/demo/${id}/messages`, { ask: what });
    expect(response.status).toBe(200);
    return (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ChatStreamEvent);
  };

  it("Teach me asks for a worked example comparing the options (#0005 worked)", async () => {
    const t = await setup();
    const events = await ask(t, "teach");
    expect(events.at(-1)?.type).toBe("done");
    const [call] = await t.calls();
    expect(call?.stdin).toMatch(/^\(president: The human has not revealed the card's pick\./);
    expect(call?.stdin).toMatch(/one realistic scenario from this project/);
    expect(call?.stdin).toMatch(/predict which of the options handles it better/);
    expect(call?.stdin).toMatch(/one column per option/);
    expect(call?.stdin).toMatch(/What this leaves out/);
    // The button's name is the human's message in the conversation, and it stays out of argv.
    const chat = await t.conversation();
    expect(chat.messages[0]).toMatchObject({ from: "you", text: "Teach me" });
    expect(call?.args.join(" ")).not.toMatch(/Teach me/);
    expect(chat.unsummarized).toBe(true);
  });

  it("Teach me on a card with no options drops the comparison and drafts no answers (20261111fauj scenario)", async () => {
    const t = await setup();
    await ask(t, "teach", "0003");
    const [call] = await t.calls();
    expect(call?.stdin).toMatch(/what I would want to happen in it/);
    expect(call?.stdin).toMatch(/what any answer has to cope with/);
    expect(call?.stdin).toMatch(/Don't draft candidate answers of your own/);
    expect(call?.stdin).not.toMatch(/one column per option/);
  });

  it("More info asks for research from primary sources, with quotes", async () => {
    const t = await setup();
    await ask(t, "research");
    const [call] = await t.calls();
    expect(call?.stdin).toMatch(/from primary sources/);
    expect(call?.stdin).toMatch(/quote the passage that matters/);
    expect((await t.conversation()).messages[0]).toMatchObject({
      from: "you",
      text: "More info",
    });
  });

  it("refuses an unknown button and an empty message", async () => {
    const t = await setup();
    expect((await t.post("/api/chats/demo/0002/messages", { ask: "explain" })).status).toBe(400);
    const empty = await t.post("/api/chats/demo/0002/messages", { text: "  " });
    expect(empty.status).toBe(400);
    expect(JSON.stringify(await empty.json())).toMatch(/a message is required/);
    expect(await t.calls()).toEqual([]);
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
