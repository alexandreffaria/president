/**
 * Starts the hub: registry + watcher + HTTP server on 127.0.0.1.
 */
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { Registry } from "./registry.ts";
import { EventBus, HubWatcher } from "./watcher.ts";

export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4747;

export function portFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PRESIDENT_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PRESIDENT_PORT must be a port number, got "${raw}"`);
  }
  return port;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUILT_UI_DIR = join(repoRoot, "dist", "web");

export interface RunningHub {
  url: string;
  close(): Promise<void>;
}

export async function startHub(
  options: { port?: number; registry?: Registry; staticDir?: string } = {},
): Promise<RunningHub> {
  const registry = options.registry ?? new Registry();
  await mkdir(dirname(registry.file), { recursive: true });
  const bus = new EventBus();
  const watcher = new HubWatcher(registry, bus);
  await watcher.start();
  const app = createApp({ registry, bus, staticDir: options.staticDir ?? BUILT_UI_DIR });

  const port = options.port ?? portFromEnv();
  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, hostname: HOST, port }, () => resolve(s));
    s.once("error", reject);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${HOST}:${actualPort}`,
    async close() {
      await watcher.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ("closeAllConnections" in server) server.closeAllConnections();
      });
    },
  };
}
