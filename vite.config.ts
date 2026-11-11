import react from "@vitejs/plugin-react";
import { createLogger, defineConfig, type Logger } from "vite";

const apiPort = Number(process.env.PRESIDENT_PORT ?? 4747);

/**
 * The dev server's logger, without one known-harmless error: Vite prints every proxy error
 * with a stack trace, and the live socket (/api/events, the only WebSocket the proxy
 * carries) hangs up each time a tab closes or reloads, or the hub restarts. Only that is
 * dropped: a "ws proxy" error with code EPIPE or ECONNRESET. Everything else, http proxy
 * errors included, is printed as Vite gives it.
 */
export function quietProxyErrors(logger: Logger): Logger {
  const error = logger.error.bind(logger);
  logger.error = (message, options) => {
    const code = (options?.error as NodeJS.ErrnoException | null | undefined)?.code;
    if (/ws proxy (socket )?error:/.test(message) && (code === "EPIPE" || code === "ECONNRESET")) {
      return;
    }
    error(message, options);
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
