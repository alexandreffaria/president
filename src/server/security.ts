/**
 * president only listens on 127.0.0.1, but a web page in the human's browser can still
 * send requests to it. These checks block the two ways that could matter:
 *
 * - DNS rebinding: a request whose Host isn't a loopback name is refused.
 * - Cross-site writes: state-changing requests must come from a loopback origin (when the
 *   browser says where they come from) and carry a JSON body, which a plain cross-site
 *   form can't send without a CORS preflight (and we never answer preflights).
 */
import type { MiddlewareHandler } from "hono";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function localOnly(): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    const hostname = host ? hostnameOf(host) : new URL(c.req.url).hostname;
    if (!isLoopbackHost(hostname)) {
      return c.json({ error: "president only answers requests addressed to localhost" }, 403);
    }
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && origin !== "null" && !isLoopbackOrigin(origin)) {
        return c.json({ error: "cross-origin requests are not allowed" }, 403);
      }
      if (origin === "null" || c.req.header("sec-fetch-site") === "cross-site") {
        return c.json({ error: "cross-origin requests are not allowed" }, 403);
      }
      const type = c.req.header("content-type") ?? "";
      if (c.req.method !== "DELETE" && !type.toLowerCase().startsWith("application/json")) {
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

function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}
