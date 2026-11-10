import { useState } from "react";
import { buildQueue } from "../core/queue.ts";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { HelpOverlay } from "./components/HelpOverlay.tsx";
import { HubProvider, useHub } from "./hub.tsx";
import { useKeyboard } from "./keyboard.ts";
import { Link, parseRoute, usePathname } from "./router.tsx";
import { ToastProvider } from "./toast.tsx";
import { CardView } from "./views/CardView.tsx";
import { LogView } from "./views/LogView.tsx";
import { ProjectsView } from "./views/ProjectsView.tsx";
import { QueueView } from "./views/QueueView.tsx";

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <HubProvider>
          <Shell />
        </HubProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

function Shell() {
  const pathname = usePathname();
  const route = parseRoute(pathname);
  const [help, setHelp] = useState(false);
  // While the help is open it handles `?` itself (and every other shortcut is off).
  useKeyboard({ "?": () => setHelp(true) });

  return (
    <>
      <Header current={route.name} onHelp={() => setHelp(true)} />
      <LoadErrorBanner />
      <main className="main">
        <ErrorBoundary key={pathname}>
          <Route route={route} />
        </ErrorBoundary>
      </main>
      {help && <HelpOverlay onClose={() => setHelp(false)} />}
    </>
  );
}

/** Shown whenever the last refresh failed, even if older cards are still on screen. */
function LoadErrorBanner() {
  const { loaded, loadError, cards } = useHub();
  if (!loaded || !loadError) return null;
  return (
    <p className="notice notice-warn load-error" role="alert">
      {cards.length > 0 ? "Couldn't refresh; what you see may be out of date. " : ""}
      {loadError}
    </p>
  );
}

function Route({ route }: { route: ReturnType<typeof parseRoute> }) {
  return (
    <>
      {route.name === "queue" && <QueueView />}
      {route.name === "card" && (
        <CardView key={`${route.project}/${route.id}`} project={route.project} id={route.id} />
      )}
      {route.name === "log" && <LogView />}
      {route.name === "projects" && <ProjectsView />}
      {route.name === "not-found" && (
        <div className="empty">
          <p>There's nothing at this address.</p>
          <Link to="/">Go to the queue</Link>
        </div>
      )}
    </>
  );
}

function Header(props: { current: string; onHelp: () => void }) {
  const { cards, connection, projectFilter } = useHub();
  const queued = buildQueue(cards, projectFilter).length;
  const nav: [string, string, string][] = [
    ["queue", "/", "Queue"],
    ["log", "/log", "Decisions"],
    ["projects", "/projects", "Projects"],
  ];
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        president
      </Link>
      <nav className="nav" aria-label="Main">
        {nav.map(([name, to, label]) => (
          <Link
            key={name}
            to={to}
            className={
              props.current === name || (name === "queue" && props.current === "card")
                ? "nav-link nav-link-active"
                : "nav-link"
            }
          >
            {label}
            {name === "queue" && queued > 0 && <span className="count">{queued}</span>}
          </Link>
        ))}
      </nav>
      <div className="topbar-end">
        <span
          className={`connection connection-${connection}`}
          title={
            connection === "live"
              ? "Live: changes on disk show up automatically"
              : "Not connected to the server; retrying"
          }
        >
          <span className="connection-dot" aria-hidden="true" />
          <span className="connection-label">
            {connection === "live"
              ? "Live"
              : connection === "connecting"
                ? "Connecting"
                : "Offline"}
          </span>
        </span>
        <button type="button" className="button button-quiet" onClick={props.onHelp}>
          <kbd>?</kbd>
          <span className="sr-only">Keyboard shortcuts</span>
        </button>
      </div>
    </header>
  );
}
