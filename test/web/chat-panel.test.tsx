// @vitest-environment happy-dom
/**
 * The conversation on the card page (E): the panel (#0002, 20261111sblu), the hub's copy
 * shown again (#0018), the reminder and Write summary (#0024, 20261111paot), saving and
 * undoing a summary (#0003, #0020), New conversation (20261112lvbu) and Teach me
 * (20261111fauj). The page and its hub are in chat-page.tsx; deciding while a conversation
 * is open is in chat-deciding.test.tsx, results that land after their view has gone in
 * chat-gone-views.test.tsx.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOST_CONNECTION } from "../../src/web/chat.ts";
import { navigate } from "../../src/web/router.tsx";
import {
  button,
  calls,
  chatCopy,
  claudeDir,
  click,
  demo,
  fakeDir,
  host,
  io,
  messageBox,
  open,
  reload,
  remount,
  renderApp,
  sendMessage,
  setIntercept,
  setWideScreen,
  socket,
  text,
  typeInto,
} from "./chat-page.tsx";
import { pause, press, settled, until } from "./harness.ts";

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
    setWideScreen(true);
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

describe("hiding the panel only hides it (20261112m6dx hide)", () => {
  it("leaves the conversation open and unsummarized, runs nothing, and comes back as it was", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await press("c");
    await until(() => host.querySelector(".chat") === null, "the panel to hide");
    expect(text()).toContain("Conversation not summarized yet.");
    await pause();
    expect(await calls()).toHaveLength(1);
    expect((await io(() => chatCopy())).unsummarized).toBe(true);
    await press("c");
    await until(() => button("Write summary") !== undefined, "Write summary");
    expect(text()).toContain("Echo: Does it throw?");
  });
});

describe("a card without a pick (20261112irpn r-asks)", () => {
  it("keeps the chat's view out until r, which asks for it; the page says it's in the chat", async () => {
    await open("/card/demo/0003");
    expect(button("Ask for the agent's view")).toBeDefined();
    expect(text()).not.toContain("Show the agent's pick");
    await press("c");
    await sendMessage("Which wording?");
    await press("r");
    await until(() => text().includes("The agent's view is in the chat."), "the line");
    expect(button("Ask for the agent's view")).toBeUndefined();
    await sendMessage("What would you write?");
    const [first, second] = await calls();
    expect(first?.stdin).toMatch(/^\(president: This card has no pick/);
    expect(first?.stdin).toMatch(/keep your own view out of it so the answer is theirs/);
    expect(first?.stdin).not.toMatch(/behind r/);
    expect(second?.stdin).toMatch(/has just pressed r to ask for your own view: give it/);
  });

  it("r opens the panel to ask in, its message box focused", async () => {
    await open("/card/demo/0003");
    expect(host.querySelector(".chat")).toBeNull();
    await press("r");
    await until(() => host.querySelector(".chat") !== null, "the panel");
    expect(text()).toContain("The agent's view is in the chat.");
    await until(() => document.activeElement === messageBox(), "focus in the message box");
  });
});

describe("a card without a pick, more (20261112irpn r-asks)", () => {
  const withoutPick = async () => {
    const path = join(demo, "decisions", "0002-api-errors.md");
    const text = (await io(() => readFile(path, "utf8"))).replace(
      /^recommendation:\n(?: {2}.*\n| {4}.*\n)+/m,
      "",
    );
    await io(() => writeFile(path, text));
    return { path, text };
  };

  it("r on an A/B card without a pick asks for the agent's view", async () => {
    await withoutPick();
    await open("/card/demo/0002");
    expect(text()).not.toContain("Show the agent's pick");
    await press("r");
    await until(() => text().includes("The agent's view is in the chat."), "the line");
    await sendMessage("Which one?");
    expect((await calls())[0]?.stdin).toMatch(/has just pressed r to ask for your own view/);
  });

  it("new options hide the view again, so r asks again", async () => {
    const { path, text: card } = await withoutPick();
    await open("/card/demo/0002");
    await press("r");
    await until(() => text().includes("The agent's view is in the chat."), "the line");
    await io(() =>
      writeFile(path, card.replace("title: Throw typed errors", "title: Throw errors")),
    );
    socket()?.emit({ type: "cards", project: "demo" });
    await until(() => button("Ask for the agent's view") !== undefined, "the button again");
    expect(text()).not.toContain("The agent's view is in the chat.");
    await sendMessage("And now?");
    expect((await calls())[0]?.stdin).toMatch(/^\(president: This card has no pick/);
    expect((await calls())[0]?.stdin).not.toMatch(/asked for your own view/);
  });

  it("New conversation after r forgets the view, and the page offers r again", async () => {
    await open("/card/demo/0003");
    await press("r");
    await sendMessage("What would you write?");
    expect(text()).toContain("The agent's view is in the chat.");
    await click("New conversation");
    await until(() => button("Ask for the agent's view") !== undefined, "the button again");
    await sendMessage("And now?");
    expect((await calls())[1]?.stdin).toMatch(/^\(president: This card has no pick/);
    expect((await calls())[1]?.stdin).not.toMatch(/asked for your own view/);
  });

  it("r does nothing, and nothing says the view is in the chat, while there is no conversation", async () => {
    setIntercept((input, init) =>
      !init.method && input.startsWith("/api/chats/demo/0003")
        ? Promise.resolve(new Response("{}", { status: 500 }))
        : undefined,
    );
    window.history.replaceState(null, "", "/card/demo/0003");
    renderApp();
    await until(() => text().includes("What should the app say"), "the card");
    await settled();
    expect(button("Ask for the agent's view")).toBeUndefined();
    await press("r");
    await pause();
    expect(text()).not.toContain("The agent's view is in the chat.");
    expect(host.querySelector(".chat")).toBeNull();
  });
});

describe("New conversation (20261112lvbu choose)", () => {
  const DIVIDER = "── New conversation. It starts from the card and its summaries. ──";

  it("isn't offered before there is a conversation", async () => {
    await open("/card/demo/0002");
    await press("c");
    await until(() => messageBox() !== null, "the panel");
    expect(button("New conversation")).toBeUndefined();
  });

  it("ends the session below a divider, the earlier messages above it, and hides the pick again", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("One");
    await press("r");
    await until(() => text().includes("The agent's take"), "the pick");
    await click("New conversation");
    await until(() => text().includes(DIVIDER), "the divider");
    expect(host.querySelector(".chat-divider")?.textContent).toBe(DIVIDER);
    expect(text()).toContain("Echo: One");
    // Neutral again: the page hides the pick, and the new session hears it isn't revealed.
    await until(() => button("Show the agent's pick") !== undefined, "the pick hidden again");
    expect(text()).not.toContain("The agent's take");
    // Nothing to end until the next message.
    expect(button("New conversation")?.disabled).toBe(true);

    await sendMessage("Two");
    const [first, second] = await calls();
    const old = first?.args[first.args.indexOf("--session-id") + 1];
    expect(second?.args).toContain("--session-id");
    expect(second?.args).not.toContain(old);
    expect(second?.stdin).toMatch(/^\(president: The human has not revealed the card's pick\./);
    expect(second?.stdin).toMatch(/The human started a new conversation about this card/);
    const items = [...host.querySelectorAll(".chat-messages > li")].map((li) => li.textContent);
    expect(items.indexOf(DIVIDER)).toBe(2);
    expect(button("New conversation")?.disabled).toBe(false);
  });

  it("is off while a reply streams in", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("One");
    await io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify([{}, { pauseMs: 400 }])));
    await typeInto(messageBox(), "Slowly");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("The agent is answering"), "the reply streaming");
    expect(button("New conversation")?.disabled).toBe(true);
    await until(() => !text().includes("The agent is answering"), "the run to end");
    await until(() => button("New conversation")?.disabled === false, "New conversation again");
  });

  it("is off while a summary is written, edited or waits as a draft, so saving it ends the reminder", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("One");
    await io(() =>
      writeFile(
        join(fakeDir, "script.json"),
        JSON.stringify([{}, { delayMs: 400, text: "A summary." }]),
      ),
    );
    await click("Write summary");
    await until(() => text().includes("The agent is writing a summary…"), "the status");
    expect(button("New conversation")?.disabled).toBe(true);
    await until(() => !!host.querySelector(".chat-summary textarea"), "the summary box");
    expect(button("New conversation")?.disabled).toBe(true);
    // Closed with Esc, the draft waits behind Edit summary: still off.
    await press("Escape", host.querySelector(".chat-summary textarea") as Element);
    await until(() => button("Edit summary") !== undefined, "the draft");
    expect(button("New conversation")?.disabled).toBe(true);
    await click("Edit summary");
    await until(() => button("Save summary") !== undefined, "the box again");
    await click("Save summary");
    await until(() => !text().includes("Conversation not summarized yet."), "the reminder to end");
    await until(() => button("New conversation")?.disabled === false, "New conversation again");
    await click("New conversation");
    await until(() => text().includes(DIVIDER), "the divider");
    expect((await io(() => chatCopy())).unsummarized).toBe(false);
  });

  it("keeps the divider after a reload", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("One");
    await click("New conversation");
    await until(() => text().includes(DIVIDER), "the divider");
    await reload("/card/demo/0002");
    await until(() => text().includes(DIVIDER), "the divider after the reload");
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
    remount();
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
    setIntercept((input, init) =>
      init.method === "POST" && input.endsWith("/messages")
        ? Promise.resolve(
            Response.json(
              { error: "the agent is still answering on this card", code: "chat_busy" },
              { status: 409 },
            ),
          )
        : undefined,
    );
    await typeInto(messageBox(), "Refused?");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes("the agent is still answering"), "the refusal");
    await until(() => (messageBox() as HTMLTextAreaElement).value === "Refused?", "the text back");

    // Accepted, then the stream breaks: the message is in the conversation, not in the box.
    setIntercept((input, init, hub) => {
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
    });
    await typeInto(messageBox(), "Will it survive?");
    await press("Enter", messageBox() as Element);
    await until(() => text().includes(LOST_CONNECTION), "the lost-connection notice");
    expect((messageBox() as HTMLTextAreaElement).value).toBe("");
    expect(text()).toContain("Will it survive?");
    setIntercept(undefined);
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
    setIntercept((input, init, hub) => {
      if (init.method || !input.startsWith("/api/chats/")) return undefined;
      setIntercept(undefined);
      heldRead = true;
      return held.then(hub);
    });
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
    setWideScreen(true);
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
