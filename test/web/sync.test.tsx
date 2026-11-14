// @vitest-environment happy-dom
/**
 * The Sync control in the top bar: the counts in the card's wording, the button and its
 * `s` key, "Syncing…" while one runs, and the report of each project's result. The API is
 * a stub here; test/sync.test.ts and test/sync-api.test.ts cover the git side.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CardListResponse,
  ProjectSyncStatus,
  SyncResultDto,
  SyncStatusResponse,
} from "../../src/core/api.ts";
import { App } from "../../src/web/App.tsx";
import { remoteText, skippedText, unsyncedText } from "../../src/web/components/Sync.tsx";
import { FakeWebSocket, press, setWaitMs, until } from "./harness.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.setConfig({ testTimeout: 15_000 });
setWaitMs(10_000);

const EMPTY: CardListResponse = { cards: [], broken: [], projectErrors: [], projects: [] };

let root: Root;
let host: HTMLElement;
let projects: ProjectSyncStatus[];
let syncPosts: number;
/** Resolves the pending POST /api/sync with these results. */
let finishSync: ((results: SyncResultDto[]) => void) | undefined;

function project(overrides: Partial<ProjectSyncStatus> = {}): ProjectSyncStatus {
  return {
    project: "shop",
    unsynced: 0,
    remoteChanges: 0,
    fetchRetrying: false,
    running: false,
    ...overrides,
  };
}

function result(overrides: Partial<SyncResultDto> = {}): SyncResultDto {
  return {
    project: "shop",
    outcome: "synced",
    message: "Synced: sent 0001",
    sent: ["0001"],
    received: [],
    at: new Date().toISOString(),
    ...overrides,
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

beforeEach(() => {
  projects = [project()];
  syncPosts = 0;
  finishSync = undefined;
  FakeWebSocket.install();
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    if (input === "/api/cards") return json(EMPTY);
    if (input === "/api/sync" && init.method === "POST") {
      syncPosts++;
      const results = await new Promise<SyncResultDto[]>((resolve) => {
        finishSync = resolve;
      });
      return json({ results });
    }
    if (input === "/api/sync") {
      const status: SyncStatusResponse = { projects, running: projects.some((p) => p.running) };
      return json(status);
    }
    return new Response("{}", { status: 404 });
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = () => host.textContent ?? "";
const syncButton = () =>
  host.querySelector<HTMLButtonElement>(".sync-button") ?? expect.fail("no Sync button");

async function render() {
  window.history.replaceState(null, "", "/");
  act(() => root.render(<App />));
  await until(() => text().includes("Nothing waiting for you"), "the queue");
}

/** Another tab, or the hub start, changed the Sync state. */
async function syncEvent() {
  FakeWebSocket.last()?.emit({ type: "sync" });
}

describe("the Sync control", () => {
  it("uses the card's wording for the counts", () => {
    expect(unsyncedText(3)).toBe("3 answers not synced");
    expect(unsyncedText(1)).toBe("1 answer not synced");
    expect(remoteText(3)).toBe("3 card changes on the remote, press Sync");
    expect(remoteText(1)).toBe("1 card change on the remote, press Sync");
  });

  it("shows how many answers aren't synced and what waits on the remote", async () => {
    projects = [project({ unsynced: 2, remoteChanges: 1 }), project({ project: "b", unsynced: 1 })];
    await render();
    await until(() => text().includes("3 answers not synced"), "the count");
    expect(text()).toContain("1 card change on the remote, press Sync");
    expect(syncButton().getAttribute("aria-describedby")).toBe("sync-summary");
    expect(syncButton().getAttribute("aria-keyshortcuts")).toBe("s");

    projects = [project()];
    await syncEvent();
    await until(() => !text().includes("not synced"), "the count to go");
    expect(host.querySelector("#sync-summary")).toBeNull();
  });

  it("syncs with the s key, says Syncing… meanwhile, and reports each project", async () => {
    projects = [project({ unsynced: 1 })];
    await render();
    await press("s");
    await until(() => syncButton().disabled, "the button to be busy");
    expect(syncPosts).toBe(1);
    expect(syncButton().textContent).toContain("Syncing…");
    expect(syncButton().getAttribute("aria-busy")).toBe("true");
    await press("s"); // no second Sync while one runs
    expect(syncPosts).toBe(1);

    const results = [
      result({
        project: "shop",
        outcome: "not-synced",
        message: "Not synced: 0001 changed on both machines",
        action: "Fixing the conflict is a manual git step; pressing Sync again retries.",
      }),
      result({
        project: "app",
        outcome: "not-now",
        message: "Not now: an agent in app has commits it hasn't pushed",
      }),
      result({
        project: "web",
        outcome: "not-pushed",
        message: "Not pushed: git push failed in web",
        gitError: "! [rejected] main -> main (fetch first)",
      }),
    ];
    projects = results.map((r) => project({ project: r.project, last: r }));
    await act(async () => finishSync?.(results));
    await until(() => !syncButton().disabled, "the Sync to end");

    const report = host.querySelector(".sync-report") ?? expect.fail("no report");
    expect(report.closest("[role=status]")).not.toBeNull();
    expect(report.className).toContain("notice-warn");
    expect(report.textContent).toContain(
      "shop Not synced: 0001 changed on both machines. Fixing the conflict",
    );
    expect(report.textContent).toContain(
      "app Not now: an agent in app has commits it hasn't pushed.",
    );
    expect(report.querySelector(".sync-git-error")?.textContent).toContain(
      "Git said: ! [rejected] main -> main (fetch first)",
    );

    const dismiss = [...report.querySelectorAll("button")].find((b) => b.textContent === "Dismiss");
    await act(async () => dismiss?.click());
    expect(host.querySelector(".sync-report")).toBeNull();
  });

  it("says when there was nothing to sync", async () => {
    await render();
    await act(async () => syncButton().click());
    await until(() => finishSync !== undefined, "the request");
    await act(async () =>
      finishSync?.([result({ outcome: "nothing", message: "Nothing to sync" })]),
    );
    await until(
      () => text().includes("Nothing to sync: no card changes here or on the remote."),
      "the toast",
    );
    expect(host.querySelector(".sync-report")).toBeNull();
  });

  it("shows a fetch that failed since the hub started", async () => {
    projects = [
      project({ fetchError: "fatal: unable to access 'https://example/': Could not resolve host" }),
    ];
    await render();
    await until(() => text().includes("Couldn't fetch from the remote of shop"), "the notice");
    expect(text()).toContain("Couldn't fetch from the remote of shop since the hub started");
    expect(text()).toContain("Press Sync to fetch again.");
    expect(text()).toContain("Could not resolve host");
  });

  it("says the hub keeps trying while it retries a failed fetch", async () => {
    projects = [project({ fetchError: "Could not resolve host: github.com", fetchRetrying: true })];
    await render();
    await until(() => text().includes("Couldn't fetch from the remote of shop"), "the notice");
    expect(text()).toContain(
      "The hub keeps trying on its own for a while; press Sync to fetch now.",
    );
    expect(text()).not.toContain("Press Sync to fetch again.");
  });

  it("shows a rebase left in progress when the hub starts, and how to get the files back (S-8)", async () => {
    projects = [
      project({
        rebase: {
          message:
            "A rebase is in progress in shop, and Sync waits until it is finished or aborted",
          action:
            "The rebase has set aside the uncommitted changes to lib.js: until it is finished or aborted, that file shows its last committed content. If no agent is running this rebase (a Sync cut short by the hub stopping leaves one behind), git rebase --abort in /work/shop puts everything back as it was.",
        },
      }),
    ];
    await render();
    await until(() => text().includes("A rebase is in progress in shop"), "the notice");
    expect(text()).toContain("set aside the uncommitted changes to lib.js");
    expect(text()).toContain("git rebase --abort in /work/shop");
  });

  it("is busy while another tab's Sync runs", async () => {
    await render();
    projects = [project({ running: true })];
    await syncEvent();
    await until(() => syncButton().disabled, "the button to be busy");
    await press("s");
    expect(syncPosts).toBe(0);
  });

  it("counts a skipped project's answers on a line of their own, never on the button (B2)", async () => {
    expect(skippedText("web", 2)).toBe("web: 2 answers not synced (Sync skips it)");
    expect(skippedText("web", 1)).toBe("web: 1 answer not synced (Sync skips it)");
    const skipped = (n: number) =>
      project({
        project: "web",
        unavailable: "it isn't the top folder of a git repository",
        skippedUnsynced: n,
      });
    projects = [
      project({ unsynced: 1 }),
      skipped(2),
      project({ project: "plain", unavailable: "it isn't …", skippedUnsynced: 0 }),
    ];
    await render();
    await until(() => text().includes("web: 2 answers not synced (Sync skips it)"), "the line");
    expect(host.querySelector("#sync-summary")?.textContent).toBe("1 answer not synced");
    expect(syncButton().querySelector(".sync-count")?.textContent).toBe("1");
    expect(host.querySelectorAll(".sync-skipped li")).toHaveLength(1);

    // Sync moved shop's answer; the skipped project's line stays.
    projects = [project(), skipped(2), projects[2] as ProjectSyncStatus];
    await syncEvent();
    await until(() => host.querySelector("#sync-summary") === null, "the summary to go");
    expect(syncButton().querySelector(".sync-count")).toBeNull();
    expect(text()).toContain("web: 2 answers not synced (Sync skips it)");

    projects = [project(), skipped(0)];
    await syncEvent();
    await until(() => host.querySelector(".sync-skipped") === null, "the line to go");
  });

  it("shows the summary only where it fits next to the nav, measured (S4-6)", async () => {
    const observers: (() => void)[] = [];
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback);
        }
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    // A narrow bar: with the summary shown, the end group wraps below the nav's line.
    let narrow = false;
    const box = (top: number) => ({ top, bottom: top + 30 }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const shown = !host.querySelector(".sync")?.hasAttribute("data-squeezed");
      if (this.classList.contains("topbar-end")) return box(narrow && shown ? 40 : 0);
      return box(0);
    });
    const squeezed = () => host.querySelector(".sync")?.hasAttribute("data-squeezed");
    projects = [project({ unsynced: 2 })];
    await render();
    await until(() => text().includes("2 answers not synced"), "the count");
    expect(squeezed()).toBe(false);
    // The bar, the end group and the nav: each can change size alone.
    for (const selector of [".topbar", ".topbar-end", ".nav"]) {
      expect(observed).toContain(host.querySelector(selector));
    }

    // The window gets narrower.
    narrow = true;
    act(() => {
      for (const observer of observers) observer();
    });
    expect(squeezed()).toBe(true);
    // Measured again with nothing changed, it stays: it measures with the summary shown, not
    // in the state it is in, so it doesn't switch back and forth.
    act(() => {
      for (const observer of observers) observer();
    });
    expect(squeezed()).toBe(true);

    // Wider again.
    narrow = false;
    act(() => {
      for (const observer of observers) observer();
    });
    expect(squeezed()).toBe(false);

    // A longer summary no longer fits.
    narrow = true;
    projects = [project({ unsynced: 2, remoteChanges: 3 })];
    await syncEvent();
    await until(() => text().includes("3 card changes"), "the new count");
    expect(squeezed()).toBe(true);
  });

  it("doesn't take the s key while typing", async () => {
    await render();
    const field = document.createElement("textarea");
    document.body.append(field);
    field.focus();
    await press("s", field);
    expect(syncPosts).toBe(0);
  });
});
