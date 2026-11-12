/**
 * Hub state shared by every view: the card list, projects, the project filter, and a
 * live connection that refetches when agents change files on disk.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BrokenCardDto, CardDto, ProjectDto } from "../core/api.ts";
import { api } from "./api.ts";
import { connectLive, type LiveState } from "./live.ts";

export type Connection = LiveState;

interface HubState {
  loaded: boolean;
  loadError: string | undefined;
  cards: CardDto[];
  broken: BrokenCardDto[];
  projectErrors: { project: string; error: string }[];
  projects: ProjectDto[];
  connection: Connection;
  /** Bumped whenever a project's cards change on disk; card views refetch on change. */
  versions: Record<string, number>;
  /**
   * Bumped when the live socket reconnects after the first time (the connection dropped, or
   * the hub restarted): changes may have been missed, so card views refetch too.
   */
  reconnects: number;
  /** Bumped when a Sync starts or finishes (in any tab); the Sync control refetches. */
  syncEvents: number;
  projectFilter: string | undefined;
  setProjectFilter: (project: string | undefined) => void;
  refresh: () => Promise<void>;
  /** Makes open card views of the project reload (after an action, before the event). */
  cardsChanged: (project: string) => void;
}

const HubContext = createContext<HubState | null>(null);

const FILTER_KEY = "president.projectFilter";

function readStoredFilter(): string | undefined {
  try {
    return window.localStorage.getItem(FILTER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function HubProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [cards, setCards] = useState<CardDto[]>([]);
  const [broken, setBroken] = useState<BrokenCardDto[]>([]);
  const [projectErrors, setProjectErrors] = useState<HubState["projectErrors"]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [reconnects, setReconnects] = useState(0);
  const [syncEvents, setSyncEvents] = useState(0);
  const [projectFilter, setFilterState] = useState<string | undefined>(readStoredFilter);
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    // Coalesce bursts of events into at most one extra fetch.
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const run = async () => {
      do {
        again.current = false;
        try {
          // One request: the card list carries the projects and their counts.
          const list = await api.cards();
          setCards(list.cards);
          setBroken(list.broken);
          setProjectErrors(list.projectErrors);
          setProjects(list.projects);
          setLoadError(undefined);
        } catch (error) {
          setLoadError((error as Error).message);
        }
      } while (again.current);
      setLoaded(true);
    };
    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, []);

  const cardsChanged = useCallback((project: string) => {
    setVersions((v) => ({ ...v, [project]: (v[project] ?? 0) + 1 }));
  }, []);

  useEffect(() => {
    void refresh();
    let connected = false;
    // One socket per tab (see live.ts).
    return connectLive({
      onState: setConnection,
      onEvent: (event) => {
        if (event.type === "sync") {
          // Card files a pull changed arrive as "cards" events of their own.
          setSyncEvents((n) => n + 1);
          return;
        }
        if (event.type === "cards") cardsChanged(event.project);
        if (event.type === "ready") {
          if (connected) setReconnects((n) => n + 1);
          connected = true;
        }
        void refresh();
      },
    });
  }, [refresh, cardsChanged]);

  const setProjectFilter = useCallback((project: string | undefined) => {
    setFilterState(project);
    try {
      if (project) window.localStorage.setItem(FILTER_KEY, project);
      else window.localStorage.removeItem(FILTER_KEY);
    } catch {
      // Storage can be unavailable (private mode); the filter just won't persist.
    }
  }, []);

  // Drop a filter for a project that no longer exists.
  useEffect(() => {
    if (loaded && projectFilter && !projects.some((p) => p.name === projectFilter)) {
      setProjectFilter(undefined);
    }
  }, [loaded, projects, projectFilter, setProjectFilter]);

  const value = useMemo<HubState>(
    () => ({
      loaded,
      loadError,
      cards,
      broken,
      projectErrors,
      projects,
      connection,
      versions,
      reconnects,
      syncEvents,
      projectFilter,
      setProjectFilter,
      refresh,
      cardsChanged,
    }),
    [
      loaded,
      loadError,
      cards,
      broken,
      projectErrors,
      projects,
      connection,
      versions,
      reconnects,
      syncEvents,
      projectFilter,
      setProjectFilter,
      refresh,
      cardsChanged,
    ],
  );
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}

export function useHub(): HubState {
  const hub = useContext(HubContext);
  if (!hub) throw new Error("useHub must be used inside <HubProvider>");
  return hub;
}
