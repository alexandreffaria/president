import react from "@vitejs/plugin-react";
import { createLogger, defineConfig, type Logger } from "vite";

const apiPort = Number(process.env.PRESIDENT_PORT ?? 4747);

/** Socket errors that only mean the other end went away (a tab closed its live socket). */
const HANGUPS = new Set(["EPIPE", "ECONNRESET"]);

/**
 * The dev server's logger, with its proxy errors made quiet. Vite prints every proxy error
 * with a stack trace: two for each page load (React's StrictMode opens and closes a socket
 * at once), and one for each reconnect while the hub restarts. Here a hang-up prints
 * nothing, and any other proxy error prints its first line once (the same line again only
 * after `repeatMs`), e.g. "ws proxy error: (ECONNREFUSED)" while the hub is down.
 */
export function quietProxyErrors(logger: Logger, repeatMs = 10_000, now = Date.now): Logger {
  const error = logger.error.bind(logger);
  const lastSaid = new Map<string, number>();
  logger.error = (message, options) => {
    if (!/proxy (socket )?error/.test(message)) return error(message, options);
    const code = (options?.error as NodeJS.ErrnoException | null | undefined)?.code;
    if (code && HANGUPS.has(code)) return;
    const line = `${message.split("\n")[0]}${code ? ` (${code})` : ""}`;
    const at = now();
    if (at - (lastSaid.get(line) ?? Number.NEGATIVE_INFINITY) < repeatMs) return;
    lastSaid.set(line, at);
    error(line, { ...options, error: null });
  };
  return logger;
}

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  customLogger: quietProxyErrors(createLogger()),
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    // Served from localhost, so one ~200 kB (gzipped) bundle is fine; most of it is
    // syntax highlighting for the languages agents put in code examples.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // Trailing slash: "/api" alone would also capture the module /api.ts.
      // ws: live events are a WebSocket on /api/events.
      "/api/": { target: `http://127.0.0.1:${apiPort}`, ws: true },
    },
  },
});
