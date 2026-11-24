/**
 * Sync (cards #0001 and 20261116d34o, pull-only): the top bar's Sync button (and the `s`
 * key), which pulls main into every project folder and never commits or pushes; the "3
 * card changes on the remote, press Sync to pull them" count; and the report of the last
 * Sync of each project. The server does the git work (server/sync/); every tab shows the
 * same state, refetched when cards change or a Sync starts or ends.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SyncResultDto, SyncStatusResponse } from "../../core/api.ts";
import { api } from "../api.ts";
import { useHub } from "../hub.tsx";
import { useKeyboard } from "../keyboard.ts";
import { useToast } from "../toast.tsx";

interface SyncState {
  status: SyncStatusResponse | undefined;
  /** This tab asked for a Sync and is waiting for it, or another tab's Sync is running. */
  busy: boolean;
  run: () => void;
  /** Results and start-up fetch errors this tab hasn't dismissed. */
  report: ReportItem[];
  dismiss: () => void;
}

export interface ReportItem {
  key: string;
  project: string;
  tone: "done" | "warn" | "muted";
  message: string;
  action?: string | undefined;
  gitError?: string | undefined;
}

const SyncContext = createContext<SyncState | null>(null);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 card changes on the remote, press Sync to pull them". */
export function remoteText(n: number): string {
  return `${plural(n, "card change", "card changes")} on the remote, press Sync to pull ${n === 1 ? "it" : "them"}`;
}

/** The Sync button's tooltip: what it does, and what it doesn't. */
export const SYNC_TITLE =
  "Pull main into each project folder, to bring in merged cards and answers. Sync never commits or pushes.";

/**
 * Shows the summary only where it fits (S4-6): `data-squeezed` on `.sync` hides it and puts
 * the count on the button when, with the summary shown, the top bar's end group no longer
 * fits on the nav's line. Set on the element directly, so measuring never re-renders.
 */
function fitSummary(sync: HTMLElement): void {
  const end = sync.closest(".topbar-end");
  const nav = sync.closest(".topbar")?.querySelector(".nav");
  sync.removeAttribute("data-squeezed");
  if (!end || !nav || !sync.querySelector(".sync-summary")) return;
  const endBox = end.getBoundingClientRect();
  // Wrapped: the end group's middle is below the nav's line.
  if ((endBox.top + endBox.bottom) / 2 > nav.getBoundingClientRect().bottom) {
    sync.setAttribute("data-squeezed", "");
  }
}

function resultItem(result: SyncResultDto): ReportItem {
  return {
    key: `result:${result.project}:${result.at}`,
    project: result.project,
    tone:
      result.outcome === "pulled" ? "done" : result.outcome === "unavailable" ? "muted" : "warn",
    message: result.message,
    action: result.action,
    gitError: result.gitError,
  };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const hub = useHub();
  const toast = useToast();
  const [status, setStatus] = useState<SyncStatusResponse>();
  const [running, setRunning] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const load = useCallback(async () => {
    // Coalesce bursts (every card change asks) into at most one extra request.
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const fetchStatus = async () => {
      do {
        again.current = false;
        try {
          setStatus(await api.syncStatus());
        } catch {
          // The hub is unreachable; the connection indicator and the card list say so.
        }
      } while (again.current);
    };
    inFlight.current = fetchStatus().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  // The card list is refetched after every card change and reconnect; Sync events come
  // separately. Each can change the counts.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers
  useEffect(() => {
    void load();
  }, [load, hub.cards, hub.syncEvents]);

  const busy = running || (status?.running ?? false);
  const runningRef = useRef(false);

  const run = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    api
      .sync()
      .then(({ results }) => {
        if (results.every((r) => r.outcome === "nothing")) {
          toast("Nothing to pull: no card changes on the remote.");
        }
      })
      .catch((error: Error) => toast(`Couldn't sync: ${error.message}`, { tone: "error" }))
      .finally(() => {
        runningRef.current = false;
        setRunning(false);
        void load();
        void hub.refresh();
      });
  }, [toast, load, hub.refresh]);

  const report = useMemo(() => {
    const items: ReportItem[] = [];
    for (const project of status?.projects ?? []) {
      if (project.fetchError) {
        items.push({
          key: `fetch:${project.project}:${project.fetchError}`,
          project: project.project,
          tone: "warn",
          message: `Couldn't fetch from the remote of ${project.project} since the hub started, so its count of card changes on the remote may be out of date`,
          action: project.fetchRetrying
            ? "The hub keeps trying on its own for a while; press Sync to fetch now."
            : "Press Sync to fetch again.",
          gitError: project.fetchError,
        });
      }
      if (project.last && project.last.outcome !== "nothing") items.push(resultItem(project.last));
    }
    return items.filter((item) => !dismissed.has(item.key));
  }, [status, dismissed]);

  const dismiss = useCallback(() => {
    setDismissed((set) => new Set([...set, ...report.map((item) => item.key)]));
  }, [report]);

  const value = useMemo<SyncState>(
    () => ({ status, busy, run, report, dismiss }),
    [status, busy, run, report, dismiss],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncState {
  const sync = useContext(SyncContext);
  if (!sync) throw new Error("useSync must be used inside <SyncProvider>");
  return sync;
}

/** The counts and the Sync button, in the top bar. */
export function SyncControl() {
  const { status, busy, run } = useSync();
  useKeyboard({ s: () => (busy ? undefined : run()) });
  const remote = (status?.projects ?? []).reduce((n, p) => n + p.remoteChanges, 0);
  const summary = remote > 0 ? remoteText(remote) : "";
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the summary's text changes its width
  useLayoutEffect(() => {
    const sync = ref.current;
    if (sync) fitSummary(sync);
  }, [summary]);
  useEffect(() => {
    const sync = ref.current;
    const bar = sync?.closest(".topbar");
    const end = sync?.closest(".topbar-end");
    const nav = bar?.querySelector(".nav");
    if (!sync || !bar || !end || !nav || typeof ResizeObserver === "undefined") return;
    // The bar's width, the end group's (the connection label changes it) and the nav's (the
    // Queue count comes and goes; the bar and the end group may keep their size when it goes).
    const observer = new ResizeObserver(() => fitSummary(sync));
    observer.observe(bar);
    observer.observe(end);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="sync" ref={ref}>
      {summary && (
        <span className="sync-summary" id="sync-summary">
          {summary}
        </span>
      )}
      <button
        type="button"
        className="button button-quiet sync-button"
        onClick={run}
        disabled={busy}
        aria-busy={busy}
        aria-keyshortcuts="s"
        aria-describedby={summary ? "sync-summary" : undefined}
        title={SYNC_TITLE}
      >
        {busy ? "Pulling…" : "Sync"}
        {!busy && remote > 0 && (
          <span className="count sync-count" aria-hidden="true">
            {remote}
          </span>
        )}
        <kbd>s</kbd>
      </button>
    </div>
  );
}

/** What the last Sync did in each project, and start-up fetch failures. */
export function SyncReport() {
  const { report, dismiss } = useSync();
  const warn = report.some((item) => item.tone === "warn");
  return (
    // Always in the page, so screen readers announce what appears in it.
    <div className="sync-report-region" role="status" aria-live="polite">
      {report.length > 0 && (
        <section
          className={`notice notice-dismissable sync-report ${warn ? "notice-warn" : "notice-done"}`}
          aria-label="Sync"
        >
          <ul className="notice-body sync-results">
            {report.map((item) => (
              <li key={item.key} className={`sync-result sync-result-${item.tone}`}>
                <strong className="sync-project">{item.project}</strong>{" "}
                <span>{item.message}.</span>
                {item.action && <span> {item.action}</span>}
                {item.gitError && (
                  <pre className="sync-git-error">
                    <span className="sr-only">Git said: </span>
                    {item.gitError}
                  </pre>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="button button-quiet" onClick={dismiss}>
            Dismiss
          </button>
        </section>
      )}
    </div>
  );
}
