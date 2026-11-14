// @vitest-environment happy-dom
/**
 * Deciding while a card's conversation is open (#0019, 20261111is21): the summary first,
 * the agent never replacing what's in the summary box (PR #28 R3), and Neither's new
 * options (#0007). The page and its hub are in chat-page.tsx.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navigate } from "../../src/web/router.tsx";
import {
  button,
  calls,
  chatCopy,
  click,
  demo,
  fakeDir,
  host,
  io,
  messageBox,
  open,
  reload,
  renderApp,
  sendMessage,
  setIntercept,
  socket,
  text,
  typeInto,
} from "./chat-page.tsx";
import { pause, press, settled, until } from "./harness.ts";

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

describe("deciding while a conversation is open, reviewed (PR #28 R1)", () => {
  const file = () => io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"));
  const deciding = () =>
    host.querySelector("#before-deciding-summary") as HTMLTextAreaElement | null;
  const script = (steps: object[]) =>
    io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify(steps)));

  it("while the box is open, nothing can be asked (R1-2)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "It throws." }]);
    await press("2");
    await press("Enter");
    await until(() => deciding()?.value === "It throws.", "the box");
    expect((messageBox() as HTMLTextAreaElement).disabled).toBe(true);
    expect(button("Teach me")?.disabled).toBe(true);
    expect(button("More info")?.disabled).toBe(true);
    expect(button("Send")?.disabled).toBe(true);
    expect(text()).toContain("Finish deciding, or press Esc to keep talking.");
    // Esc: talking again.
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    expect((messageBox() as HTMLTextAreaElement).disabled).toBe(false);
    // The asks also wait for the page to read that the summary's run is over, which can come
    // after the box closes on a busy machine.
    await until(() => button("Teach me")?.disabled === false, "Teach me to be on again");
    expect(text()).not.toContain("Finish deciding");
  });

  it("focuses the text box when no summary could be written, and Esc goes back to Decide (R1-3)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "", exit: 1, stderr: "boom" }]);
    await press("2");
    // Clicking a button focuses it in a browser.
    button("Decide")?.focus();
    await click("Decide");
    await until(() => text().includes("Couldn't write the summary"), "the error");
    await until(() => document.activeElement === deciding(), "focus in the text box");
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    await until(
      () => document.activeElement === button("Decide"),
      "focus back on the Decide button",
    );
  });

  it("names the box without pointing at a text box that isn't there yet (R1-4)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "It throws.", pauseMs: 600 }]);
    await press("2");
    await press("Enter");
    await until(() => text().includes("Writing a summary…"), "the summary being written");
    const form = host.querySelector("form.before-deciding");
    expect(form?.getAttribute("aria-busy")).toBe("true");
    const label = host.querySelector("#before-deciding-label");
    expect(label?.tagName).toBe("SPAN");
    expect(label?.textContent).toBe("Before deciding: summary of your conversation");
    expect(host.querySelector('label[for="before-deciding-summary"]')).toBeNull();
    await until(() => deciding()?.value === "It throws.", "the summary");
    expect(host.querySelector('label[for="before-deciding-summary"]')).not.toBeNull();
    expect(form?.getAttribute("aria-busy")).toBe("false");
  });

  it("an early Enter waits for the conversation before deciding (R1-5)", async () => {
    // A conversation on the hub that the page hasn't read yet.
    const sent = await io(() =>
      fetch("/api/chats/demo/0002/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Does it throw?" }),
      }).then((res) => res.text()),
    );
    expect(sent).toContain('"done"');
    await script([{ text: "It throws." }]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setIntercept((input, init, hub) =>
      input === "/api/chats/demo/0002" && (init.method ?? "GET") === "GET"
        ? gate.then(hub)
        : undefined,
    );
    window.history.replaceState(null, "", "/card/demo/0002");
    renderApp();
    await until(() => text().includes("Pick an option"), "the card");
    await press("2");
    await press("Enter");
    await pause();
    expect(await file()).toMatch(/status: open/);
    expect(text()).not.toContain("Decided #0002");
    release();
    await until(() => deciding()?.value === "It throws.", "the Before deciding box");
    expect(await file()).toMatch(/status: open/);
  });
});

describe("deciding while a conversation is open, reviewed (PR #28 R2)", () => {
  const file = () => io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"));

  it("decides nothing when the view leaves the card while the conversation is read (R2-2)", async () => {
    const sent = await io(() =>
      fetch("/api/chats/demo/0002/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Does it throw?" }),
      }).then((res) => res.text()),
    );
    expect(sent).toContain('"done"');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setIntercept((input, init, hub) =>
      input === "/api/chats/demo/0002" && (init.method ?? "GET") === "GET"
        ? gate.then(hub)
        : undefined,
    );
    window.history.replaceState(null, "", "/card/demo/0002");
    renderApp();
    await until(() => text().includes("Pick an option"), "the card");
    await press("2");
    await press("Enter");
    await press("Escape");
    await until(() => window.location.pathname === "/", "the queue");
    const runs = (await calls()).length;
    release();
    await settled();
    await pause();
    expect(window.location.pathname).toBe("/");
    expect(await file()).toMatch(/status: open/);
    expect((await calls()).length).toBe(runs);
  });

  it("says to try again when the conversation can't be read (R2-3)", async () => {
    setIntercept((input, init) =>
      input === "/api/chats/demo/0002" && (init.method ?? "GET") === "GET"
        ? Promise.resolve(
            new Response(JSON.stringify({ error: "the hub broke", code: "internal" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            }),
          )
        : undefined,
    );
    window.history.replaceState(null, "", "/card/demo/0002");
    renderApp();
    await until(() => text().includes("Pick an option"), "the card");
    await press("2");
    await press("Enter");
    await until(() => text().includes("Couldn't read this card's conversation"), "the toast");
    expect(text()).toContain("so nothing was decided; try again.");
    expect(await file()).toMatch(/status: open/);
  });
});

describe("the agent never replaces text already in the summary box (PR #28 R3)", () => {
  const file = () => io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"));
  const deciding = () =>
    host.querySelector("#before-deciding-summary") as HTMLTextAreaElement | null;
  const script = (steps: object[]) =>
    io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify(steps)));
  const panelBox = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
  const NOT_USED = "The agent's summary wasn't used: the summary box already has text.";

  it("keeps a summary typed after a failed run: Esc, then Decide opens it as is", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "", exit: 1, stderr: "boom" }]);
    await press("2");
    await press("Enter");
    await until(() => text().includes("Couldn't write the summary"), "the error");
    await typeInto(deciding(), "My own summary.");
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    const runs = (await calls()).length;
    await click("Decide");
    await until(() => deciding()?.value === "My own summary.", "the box with my summary");
    await pause();
    expect((await calls()).length).toBe(runs);
    expect(deciding()?.value).toBe("My own summary.");
    await click("Save and decide");
    await until(() => text().includes("with the conversation's summary"), "the decision");
    expect(await file()).toMatch(/type: chat\n\s+note: My own summary\./);
  });

  it("keeps an edited agent summary as is when messages came after it", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    // The runs from here: the summary, the reply to the next question; no other run.
    await script([{ text: "It throws." }, {}]);
    await click("Write summary");
    await until(() => panelBox()?.value === "It throws.", "the summary");
    await typeInto(panelBox(), "It throws on 404.");
    await press("Escape", panelBox() as Element);
    await until(() => !!button("Edit summary"), "the kept draft");
    await sendMessage("And on 500?");
    const runs = (await calls()).length;
    await press("2");
    await click("Decide");
    await until(() => deciding()?.value === "It throws on 404.", "the box with my edit");
    await pause();
    expect((await calls()).length).toBe(runs);
    expect(deciding()?.value).toBe("It throws on 404.");
  });

  it("opens an untouched agent summary as is too: it isn't refreshed after more chat", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "It throws." }, {}]);
    await click("Write summary");
    await until(() => panelBox()?.value === "It throws.", "the summary");
    await press("Escape", panelBox() as Element);
    await until(() => !!button("Edit summary"), "the kept draft");
    await sendMessage("And on 500?");
    const runs = (await calls()).length;
    await press("2");
    await click("Decide");
    await until(() => deciding()?.value === "It throws.", "the box with the kept summary");
    await pause();
    expect((await calls()).length).toBe(runs);
  });

  /** Write summary in the panel, still running once the page knows the hub is writing it. */
  async function panelSummaryRunning(summary: string) {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: summary, delayMs: 3000 }]);
    await click("Write summary");
    await until(() => text().includes("The agent is writing a summary…"), "the run");
    for (let i = 0; i < 100 && (await io(() => chatCopy())).running !== "summary"; i++) {
      await pause();
    }
    expect((await io(() => chatCopy())).running).toBe("summary");
    // The message's run and this one have both started (each records its call first).
    for (let i = 0; i < 100 && (await calls()).length < 2; i++) await pause();
    expect(await calls()).toHaveLength(2);
    // The hub's event for the run, so the page reads the conversation again (not `settled`:
    // that would wait for the run too).
    let read = false;
    setIntercept((input, init, hub) =>
      input === "/api/chats/demo/0002" && (init.method ?? "GET") === "GET"
        ? hub().then((response) => {
            read = true;
            return response;
          })
        : undefined,
    );
    socket()?.emit({ type: "chat", project: "demo", id: "0002" });
    await until(() => read, "the page to read the conversation");
    await pause();
    await pause();
  }

  it("a Write summary that finishes after Decide keeps what you typed (R3-1)", async () => {
    await panelSummaryRunning("Agent summary.");
    const runs = (await calls()).length;
    await press("2");
    await click("Decide");
    // No second run: the box opens to type in, saying a summary is being written.
    await until(() => text().includes("The agent is already writing a summary"), "the box");
    expect((await calls()).length).toBe(runs);
    await typeInto(deciding(), "My own summary.");
    // The panel's run finishes: its summary is dropped, and the toast says so.
    await until(() => text().includes(NOT_USED), "the run to finish");
    expect(deciding()?.value).toBe("My own summary.");
    await click("Save and decide");
    await until(() => text().includes("with the conversation's summary"), "the decision");
    const decided = await file();
    expect(decided).toMatch(/type: chat\n\s+note: My own summary\./);
    expect(decided).not.toContain("Agent summary.");
  });

  it("a Write summary that finishes after Decide fills the box while it is empty", async () => {
    await panelSummaryRunning("Agent summary.");
    await press("2");
    await click("Decide");
    await until(() => text().includes("The agent is already writing a summary"), "the box");
    await until(() => deciding()?.value === "Agent summary.", "the summary in the box");
    expect(text()).not.toContain(NOT_USED);
    expect(text()).not.toContain("The agent is already writing a summary");
  });

  it("puts a sentence break after the hub's error (R3-2)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    setIntercept((input, init) =>
      input === "/api/chats/demo/0002/summary" && init.method === "POST"
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                error: "the agent is still answering on this card; wait for it to finish",
                code: "chat_busy",
              }),
              { status: 409, headers: { "content-type": "application/json" } },
            ),
          )
        : undefined,
    );
    await press("2");
    await press("Enter");
    await until(() => text().includes("Couldn't write the summary"), "the error");
    expect(text()).toContain(
      "Couldn't write the summary: the agent is still answering on this card; wait for it to finish. Write one yourself, or decide without it.",
    );
  });
});

describe("Neither: new options right away (#0007, 202611111gpm, 2026111459oa)", () => {
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
  const file = () => io(() => readFile(join(demo, "decisions", "0002-api-errors.md"), "utf8"));
  const script = (steps: object[]) =>
    io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify(steps)));
  const openGate = (gate: string) => io(() => writeFile(join(fakeDir, gate), ""));
  /** Waits until `check`, which reads past the page, holds. */
  async function eventually(check: () => Promise<boolean>, what: string) {
    for (let i = 0; !(await check()); i++) {
      if (i > 400) throw new Error(`never happened: ${what}`);
      await pause();
    }
  }
  const runStarted = () => eventually(async () => (await calls()).length === 1, "the run");

  async function askForNewOptions() {
    await open("/card/demo/0002");
    await press("n");
    await typeInto(host.querySelector("#panel-text"), NOTE);
    await click("Ask for new options");
    await until(() => text().includes("Asked for new options on #0002."), "the Undo notice");
  }

  it("starts the run at once, moves on, and the card says Writing new options… (202611128a05 leave)", async () => {
    await script([{ structured: ANSWER, gate: "answer" }]);
    await askForNewOptions();
    // While the Undo notice is still shown, the run has already reached the agent.
    await runStarted();
    expect((await calls())[0]?.args).toContain("--json-schema");
    // Like Decide and Defer, Ask for new options moves on (202611128a05 `leave`).
    await until(() => window.location.pathname !== "/card/demo/0002", "the next card");
    navigate("/card/demo/0002");
    await until(() => text().includes("Writing new options…"), "the run's status");
    await until(() => text().includes(`Neither: ${NOTE}`), "the Neither message");
    await openGate("answer");
    await until(() => text().includes("(The options are now on the card.)"), "the run's reply");
    await until(() => text().includes("Plain files"), "the new options");
    expect(text()).toMatch(/New options, written from your note at /);
    // The new pick stays hidden (#0008, 2026111272fu).
    expect(button("Show the agent's pick")).toBeDefined();
  });

  it("another tab just sees the run, with nothing to press", async () => {
    await script([{ structured: ANSWER, gate: "answer" }]);
    await askForNewOptions();
    // A reload is another page: it has no Undo notice.
    await reload("/card/demo/0002");
    await until(() => text().includes("Writing new options…"), "the run's status");
    expect(button("Start now")).toBeUndefined();
    expect(button("Try again")).toBeUndefined();
    expect(text()).not.toContain("hasn't started");
    await openGate("answer");
    await until(() => text().includes("(The options are now on the card.)"), "the run's reply");
    expect(await calls()).toHaveLength(1);
  });

  it("an Undo during the run stops it and puts the card back", async () => {
    const before = await file();
    await script([{ structured: ANSWER, gate: "answer" }]);
    await askForNewOptions();
    await runStarted();
    await press("u");
    await until(() => text().includes("Undone. #0002 is back as it was"), "the undo");
    await until(
      () => (host.querySelector("#panel-text") as HTMLTextAreaElement | null)?.value === NOTE,
      "the note back in the Neither panel",
    );
    expect(await file()).toBe(before);
    // The message stays in the conversation (2026111459oa accepts it), and the run ends.
    await eventually(async () => !(await chatCopy()).running, "the run to end");
    const copy = await chatCopy();
    expect(copy.newOptions).toBeUndefined();
    expect(copy.messages.map((m) => m.text)).toEqual([
      `Neither: ${NOTE}`,
      "You undid your note, so the run stopped.",
    ]);
    await openGate("answer");
    await pause();
    expect(await file()).toBe(before);
  });

  it("once the options are written, Undo is refused and they stay", async () => {
    await script([{ structured: ANSWER }]);
    await askForNewOptions();
    await eventually(
      async () => (await chatCopy()).newOptions?.state === "written",
      "the options written",
    );
    await press("u");
    await until(() => text().includes("Couldn't undo"), "the refusal");
    expect(text()).toContain(
      "Couldn't undo: the card changed since (new options may already be on it), so your note can't be taken back",
    );
    expect(await file()).toMatch(/id: indexeddb/);
  });

  it("offers no run for a neither made on another machine (20261112ah6a wait)", async () => {
    // Synced from another machine: the card waits on the note, and this hub has no record.
    const path = join(demo, "decisions", "0002-api-errors.md");
    const card = await file();
    await io(() =>
      writeFile(
        path,
        card.replace(
          "depends_on: []\n",
          `depends_on: []\nneeds_new_options: true\nfeedback:\n  - type: neither\n    at: 2026-11-12T21:00:00Z\n    note: ${NOTE}\n`,
        ),
      ),
    );
    await open("/card/demo/0002");
    await until(() => text().includes(NOTE), "the card's note");
    await press("c");
    await until(() => messageBox() !== null, "the conversation");
    await pause();
    expect(button("Try again")).toBeUndefined();
    expect(text()).not.toContain(`Neither: ${NOTE}`);
    expect(await calls()).toEqual([]);
  });

  it("a failed run offers Try again", async () => {
    await script([
      { lines: [{ type: "result", subtype: "error_max_budget_usd", is_error: true }] },
      { structured: ANSWER },
    ]);
    await askForNewOptions();
    navigate("/card/demo/0002");
    await until(() => !!button("Try again"), "Try again");
    expect(text()).toContain(
      "Couldn't write new options: the run stopped at its spending cap ($1). The card waits for the project's agent, as before.",
    );
    await click("Try again");
    await until(() => text().includes("(The options are now on the card.)"), "the run's reply");
  });

  it("New conversation, asking and sending are off while the run goes on (20261112lvbu)", async () => {
    await script([{}, { structured: ANSWER, gate: "answer" }]);
    await io(async () =>
      (
        await fetch("/api/chats/demo/0002/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "One" }),
        })
      ).text(),
    );
    await askForNewOptions();
    navigate("/card/demo/0002");
    await until(() => text().includes("Writing new options…"), "the run's status");
    if (!messageBox()) await press("c");
    await until(() => button("New conversation") !== undefined, "New conversation");
    expect(button("New conversation")?.disabled).toBe(true);
    expect(button("Teach me")?.disabled).toBe(true);
    await typeInto(messageBox(), "Why drop the server?");
    expect(button("Send")?.disabled).toBe(true);
    await openGate("answer");
    await until(() => button("New conversation")?.disabled === false, "New conversation again");
    expect(button("Send")?.disabled).toBe(false);
  });
});
