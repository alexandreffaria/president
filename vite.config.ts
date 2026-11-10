import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.PRESIDENT_PORT ?? 4747);

export default defineConfig({
  root: "src/web",
  plugins: [react()],
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
