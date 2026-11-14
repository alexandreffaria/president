// @vitest-environment happy-dom
/**
 * Results that land after their view of the card has gone (PR #28 R4, R5): a summary, a
 * close, a refused message or a decision changes only what it was for, never what was typed
 * since. The page and its hub are in chat-page.tsx.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navigate } from "../../src/web/router.tsx";
import {
  button,
  click,
  fakeDir,
  host,
  io,
  messageBox,
  open,
  sendMessage,
  setIntercept,
  text,
  typeInto,
  WAIT_MS,
} from "./chat-page.tsx";
import { pause, press, settled, until } from "./harness.ts";

describe("a result for a view of the card that has gone writes only into an empty summary (PR #28 R4)", () => {
  const deciding = () =>
    host.querySelector("#before-deciding-summary") as HTMLTextAreaElement | null;
  const script = (steps: object[]) =>
    io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify(steps)));
  const panelBox = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
  const NOT_USED = "The agent's summary wasn't used: the summary box already has text.";

  /** Leaves #0002 for #0003 and comes back: a new view of the card. */
  async function leaveAndComeBack() {
    navigate("/card/demo/0003");
    await until(() => window.location.pathname === "/card/demo/0003", "#0003");
    await pause();
    await pause();
    navigate("/card/demo/0002");
    await until(() => messageBox() !== null, "the conversation again");
    await pause();
    await pause();
  }

  it("a Write summary that finishes after leaving and coming back keeps what you typed (R4-1)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "Agent summary.", delayMs: 3000 }]);
    await click("Write summary");
    await until(() => text().includes("The agent is writing a summary…"), "the run");
    await leaveAndComeBack();
    await typeInto(messageBox(), "Unsent message.");
    await press("2");
    await click("Decide");
    await until(() => deciding() !== null && !text().includes("Writing a summary"), "the box");
    await typeInto(deciding(), "My own summary.");
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    await until(() => text().includes(NOT_USED), "the notice that it wasn't used");
    await leaveAndComeBack();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
    await press("2");
    await click("Decide");
    await until(() => deciding() !== null, "the box");
    expect(deciding()?.value).toBe("My own summary.");
  });

  it("a Write summary that finishes after leaving and coming back fills an empty box, keeping the rest", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "Agent summary.", delayMs: 1500 }]);
    await click("Write summary");
    await until(() => text().includes("The agent is writing a summary…"), "the run");
    await leaveAndComeBack();
    await typeInto(messageBox(), "Unsent message.");
    await until(() => panelBox()?.value === "Agent summary.", "the summary in the open view");
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
    await leaveAndComeBack();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
  });

  it("Close without summary's Undo after leaving and coming back keeps what you typed since (R4-2)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "It throws." }]);
    await click("Write summary");
    await until(() => panelBox()?.value === "It throws.", "the summary");
    await until(() => button("Close without summary")?.disabled === false, "the button");
    await click("Close without summary");
    await until(() => text().includes("Conversation closed without a summary."), "the notice");
    await leaveAndComeBack();
    await typeInto(messageBox(), "Unsent message.");
    await press("u");
    await until(() => text().includes("The conversation isn't summarized again."), "the undo");
    // The open view shows the summary put back.
    await until(() => panelBox()?.value === "It throws.", "the restored summary");
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
    await leaveAndComeBack();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
  });

  it("Decide right after Write summary says the agent is already writing one (R4-3)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "Agent summary.", delayMs: 1500 }]);
    // The page reads the conversation again only late: it doesn't know from the hub yet.
    setIntercept((input, init, hub) =>
      input === "/api/chats/demo/0002" && (init.method ?? "GET") === "GET"
        ? new Promise((resolve) => setTimeout(resolve, 2000)).then(hub)
        : undefined,
    );
    await click("Write summary");
    await press("2");
    await click("Decide");
    await until(() => text().includes("The agent is already writing a summary"), "the box");
    expect(text()).not.toContain("Couldn't write the summary");
    await until(() => deciding()?.value === "Agent summary.", "the summary in the box");
  });

  it("Close without summary's Undo doesn't replace a summary typed since", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "It throws." }, {}, { text: "Second summary." }]);
    await click("Write summary");
    await until(() => panelBox()?.value === "It throws.", "the summary");
    await until(() => button("Close without summary")?.disabled === false, "the button");
    await click("Close without summary");
    await until(() => text().includes("Conversation closed without a summary."), "the notice");
    await leaveAndComeBack();
    // A new message makes Decide wait for a summary again: its run fills the empty box, and
    // you rewrite it.
    await sendMessage("And then?");
    await press("2");
    await click("Decide");
    await until(() => deciding()?.value === "Second summary.", "the box");
    await typeInto(deciding(), "My own summary.");
    await press("Escape");
    await until(() => deciding() === null, "the box to close");
    await press("u");
    await until(() => text().includes("The conversation isn't summarized again."), "the undo");
    expect(text()).toContain("Your earlier summary wasn't put back");
    await leaveAndComeBack();
    await press("2");
    await click("Decide");
    await until(() => deciding() !== null, "the box");
    expect(deciding()?.value).toBe("My own summary.");
  });
});

describe("a request that ends after its view of the card has gone changes only what it sent (PR #28 R5)", () => {
  const panelBox = () => host.querySelector(".chat-summary textarea") as HTMLTextAreaElement | null;
  const deciding = () =>
    host.querySelector("#before-deciding-summary") as HTMLTextAreaElement | null;
  const script = (steps: object[]) =>
    io(() => writeFile(join(fakeDir, "script.json"), JSON.stringify(steps)));
  /** Holds back the first request `matches` picks, by `ms`. */
  const delay = (matches: (input: string, method: string) => boolean, ms: number) => {
    let held = false;
    setIntercept((input, init, hub) => {
      if (held || !matches(input, init.method ?? "GET")) return undefined;
      held = true;
      return new Promise((resolve) => setTimeout(resolve, ms)).then(hub);
    });
  };

  /** Leaves #0002 for #0003 and comes back: a new view of the card. */
  async function leaveAndComeBack() {
    navigate("/card/demo/0003");
    await until(() => window.location.pathname === "/card/demo/0003", "#0003");
    await pause();
    await pause();
    navigate("/card/demo/0002");
    await until(
      () => messageBox() !== null || button("Ask about this card") !== undefined,
      "the card again",
    );
    await pause();
    await pause();
    // A card without a conversation shows the panel closed: open it again. `c` does nothing
    // until the conversation has loaded, so press it again until the panel opens.
    // (Not settled(): a request held back by the test is still out.)
    const deadline = Date.now() + WAIT_MS;
    while (messageBox() === null && Date.now() < deadline) {
      await press("c");
      await pause();
    }
    await until(() => messageBox() !== null, "the conversation again");
  }

  async function writeSummaryThenClose() {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    await script([{ text: "It throws." }]);
    await click("Write summary");
    await until(() => panelBox()?.value === "It throws.", "the summary");
    await until(() => button("Close without summary")?.disabled === false, "the button");
    delay((input, method) => method === "POST" && input === "/api/chats/demo/0002/close", 1500);
    await click("Close without summary");
  }

  it("Close without summary that lands after leaving and coming back keeps a message typed since (R5-1)", async () => {
    await writeSummaryThenClose();
    await leaveAndComeBack();
    await typeInto(messageBox(), "Unsent message.");
    await until(() => text().includes("Conversation closed without a summary."), "the close");
    await pause();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
    await leaveAndComeBack();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
    // The summary it dropped is gone.
    expect(button("Edit summary")).toBeUndefined();
  });

  it("Close without summary that lands later doesn't clear a summary edited since (R5-1)", async () => {
    await writeSummaryThenClose();
    await leaveAndComeBack();
    await click("Edit summary");
    await until(() => panelBox() !== null, "the summary box");
    await typeInto(panelBox(), "My own summary.");
    await until(() => text().includes("Conversation closed without a summary."), "the close");
    await pause();
    expect(panelBox()?.value).toBe("My own summary.");
    await leaveAndComeBack();
    await click("Edit summary");
    await until(() => panelBox() !== null, "the summary box");
    expect(panelBox()?.value).toBe("My own summary.");
  });

  it("a refused message put back after leaving and coming back keeps what was typed since (R5-2 send)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await until(() => messageBox() !== null, "the message box");
    // Refused at once; the conversation read again after it is slow, so the human has left
    // and come back by the time the text is put back.
    let reread = false;
    setIntercept((input, init, hub) => {
      if (input === "/api/chats/demo/0002/messages" && init.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: "the agent is still answering on this card",
              code: "chat_busy",
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (reread || input !== "/api/chats/demo/0002" || (init.method ?? "GET") !== "GET") {
        return undefined;
      }
      reread = true;
      return new Promise((resolve) => setTimeout(resolve, 1500)).then(hub);
    });
    await typeInto(messageBox(), "First message.");
    await press("Enter", messageBox() as Element);
    await until(() => (messageBox() as HTMLTextAreaElement).value === "", "the box to empty");
    await leaveAndComeBack();
    await typeInto(messageBox(), "Second message.");
    await until(
      () => (messageBox() as HTMLTextAreaElement).value === "First message.\n\nSecond message.",
      "the refused message put back, ahead of the new one",
    );
  });

  it("a decision that lands after leaving and coming back keeps a message typed since and doesn't move on (R5-2 act)", async () => {
    await open("/card/demo/0002");
    await press("2");
    delay((input, method) => method === "POST" && input === "/api/cards/demo/0002/actions", 1500);
    await click("Decide");
    await leaveAndComeBack();
    await typeInto(messageBox(), "Unsent message.");
    await until(() => text().includes("Decided #0002"), "the decision");
    await settled();
    // The view that decided has gone: it doesn't take the human on to the next card.
    expect(window.location.pathname).toBe("/card/demo/0002");
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
    await leaveAndComeBack();
    expect((messageBox() as HTMLTextAreaElement).value).toBe("Unsent message.");
  });

  it("the Before deciding box stops promising the panel's summary once its run fails (R5-3)", async () => {
    await open("/card/demo/0002");
    await press("c");
    await sendMessage("Does it throw?");
    // The hub refuses the panel's run, late; the page doesn't know from the hub it is going.
    setIntercept((input, init, hub) => {
      if (input === "/api/chats/demo/0002/summary" && init.method === "POST") {
        return new Promise((resolve) => setTimeout(resolve, 1000)).then(
          () =>
            new Response(JSON.stringify({ error: "the hub broke", code: "internal" }), {
              status: 500,
              headers: { "content-type": "application/json" },
            }),
        );
      }
      return input === "/api/chats/demo/0002" && (init.method ?? "GET") === "GET"
        ? new Promise((resolve) => setTimeout(resolve, 2000)).then(hub)
        : undefined;
    });
    await click("Write summary");
    await press("2");
    await click("Decide");
    await until(() => text().includes("The agent is already writing a summary"), "the box");
    await until(() => text().includes("Couldn't write the summary"), "the failure in the box");
    expect(text()).not.toContain("it appears here when it's done");
    expect(deciding()?.value).toBe("");
  });
});
