/** The built UI (dist/web) and its client-side routes, or a note when it isn't built. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

export function registerStaticRoutes(app: Hono, staticDir: string | undefined): void {
  if (staticDir && existsSync(join(staticDir, "index.html"))) {
    app.use("/assets/*", serveStatic({ root: staticDir }));
    app.use("*", serveStatic({ root: staticDir }));
    // Client-side routes (/card/..., /log, /projects) all get the app shell.
    app.get("*", async (c) => c.html(await readFile(join(staticDir, "index.html"), "utf8")));
  } else {
    app.get("/", (c) =>
      c.text(
        "president API is running, but the UI is not built. Run `npm run build`, or use `npm run dev` and open the Vite URL.",
      ),
    );
  }
}
