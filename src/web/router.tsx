/**
 * A tiny history-API router: four routes don't need a library.
 */
import { type MouseEvent, type ReactNode, useSyncExternalStore } from "react";

export type Route =
  | { name: "queue" }
  | { name: "card"; project: string; id: string }
  | { name: "log" }
  | { name: "projects" }
  | { name: "not-found" };

export function parseRoute(pathname: string): Route {
  let parts: string[];
  try {
    parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return { name: "not-found" }; // a malformed escape such as %E0%A4%A
  }
  if (parts.length === 0) return { name: "queue" };
  if (parts[0] === "card" && parts.length === 3 && parts[1] && parts[2]) {
    return { name: "card", project: parts[1], id: parts[2] };
  }
  if (parts.length === 1 && parts[0] === "log") return { name: "log" };
  if (parts.length === 1 && parts[0] === "projects") return { name: "projects" };
  return { name: "not-found" };
}

export function cardPath(project: string, id: string): string {
  return `/card/${encodeURIComponent(project)}/${encodeURIComponent(id)}`;
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === window.location.pathname) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function Link(props: {
  to: string;
  className?: string;
  children: ReactNode;
  title?: string;
  "aria-current"?: "true" | "page" | undefined;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(props.to);
  };
  return (
    <a
      href={props.to}
      className={props.className}
      title={props.title}
      aria-current={props["aria-current"]}
      onClick={onClick}
    >
      {props.children}
    </a>
  );
}
