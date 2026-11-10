/**
 * president only listens on 127.0.0.1, but a web page in the human's browser can still
 * send requests to it. These checks block the ways that could matter:
 *
 * - DNS rebinding: a request whose Host isn't a loopback name is refused.
 * - Cross-site and cross-origin writes: a state-changing request must say where it comes
 *   from, and that must be the hub's own origin (the scheme, host and port in the request's
 *   Host header). Other local servers (a dev server on localhost:3000) are refused too.
 *   Browsers always send Origin on these requests; scripts and curl must send it as well
 *   (`-H "Origin: http://127.0.0.1:4747"`).
 * - Cross-site WebSocket hijacking: a WebSocket handshake is a GET, but a page can read the
 *   socket it opens, so the live-events handshake (which Node passes through this same
 *   middleware) needs the hub's own origin too.
 * - Writes also need a JSON body, which a plain cross-site form can't send.
 *
 * The Vite dev server proxies /api/ without changing Host, so in `npm run dev` the page's
 * origin (127.0.0.1:5173) matches the Host the API sees, and the same rule applies.
 */
import type { MiddlewareHandler } from "hono";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function localOnly(): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host") ?? new URL(c.req.url).host;
    if (!isLoopbackHost(hostnameOf(host))) {
      return c.json({ error: "president only answers requests addressed to localhost" }, 403);
    }
    const upgrade = c.req.header("upgrade")?.toLowerCase() === "websocket";
    if (upgrade || !SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      const fetchSite = c.req.header("sec-fetch-site");
      const sameOrigin =
        origin !== undefined
          ? isOrigin(origin, host) && (fetchSite === undefined || fetchSite === "same-origin")
          : fetchSite === "same-origin";
      if (!sameOrigin) {
        return c.json(
          {
            error:
              origin === undefined
                ? `send an Origin header (http://${host}) with ${upgrade ? "WebSocket connections" : "requests that change something"}`
                : "cross-origin requests are not allowed",
          },
          403,
        );
      }
      const type = c.req.header("content-type") ?? "";
      if (
        !upgrade &&
        c.req.method !== "DELETE" &&
        !type.toLowerCase().startsWith("application/json")
      ) {
        return c.json({ error: "send a JSON body with Content-Type: application/json" }, 415);
      }
    }
    await next();
  };
}

function hostnameOf(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.replace(/:\d+$/, "");
}

/** True when `origin` is exactly http://<host>, the hub itself. */
function isOrigin(origin: string, host: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
