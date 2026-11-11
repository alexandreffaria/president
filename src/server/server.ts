/**
 * Starts the hub: registry + watcher + HTTP server on 127.0.0.1, with live events on a
 * WebSocket (/api/events).
 *
 * A WebSocket, not a server-sent events stream: browsers allow 6 HTTP/1.1 connections per
 * host, and each open stream held one, so a few president windows used them all up and
 * every API call hung. Browsers keep WebSockets out of that pool.
 */
import { mkdir } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ServerType, serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { HEARTBEAT_MS, type LiveMessage } from "../core/api.ts";
import { createApp } from "./app.ts";
import { fileError, UserError } from "./errors.ts";
import { Registry } from "./registry.ts";
import { EventBus, HubWatcher } from "./watcher.ts";

export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 4747;

export function portFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PRESIDENT_PORT;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new UserError(`PRESIDENT_PORT must be a port number, got "${raw}"`);
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
  options: { port?: number; registry?: Registry; staticDir?: string; heartbeatMs?: number } = {},
): Promise<RunningHub> {
  const registry = options.registry ?? new Registry();
  const port = options.port ?? portFromEnv();
  try {
    await mkdir(registry.dir, { recursive: true });
  } catch (error) {
    throw fileError("create", registry.dir, error);
  }
  const bus = new EventBus();
  const watcher = new HubWatcher(registry, bus);
  await watcher.start();
  const app = createApp({ registry, bus, staticDir: options.staticDir ?? BUILT_UI_DIR });

  // The upgrade request goes through the app (and its Host and Origin checks) first.
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const stopHeartbeat = heartbeat(sockets, options.heartbeatMs ?? HEARTBEAT_MS);

  let server: ServerType;
  const connections = new Set<Socket>();
  try {
    server = await new Promise<ServerType>((resolve, reject) => {
      const s = serve(
        {
          fetch: app.fetch,
          hostname: HOST,
          port,
          websocket: { server: sockets },
          // Only WebSocket upgrades go to the upgrade handler. Any other (curl --http2 sends
          // "Upgrade: h2c") is served as a plain request: the handler ignores them, so they
          // would never get an answer, and they would keep the hub from shutting down.
          serverOptions: { shouldUpgradeCallback: isWebSocketUpgrade },
        },
        () => resolve(s),
      );
      s.once("error", reject);
      // Every connection, to close them all on shutdown. Not an "upgrade" listener: the
      // WebSocket handler only answers refused handshakes when it is the only one.
      s.on("connection", (socket: Socket) => {
        connections.add(socket);
        socket.once("close", () => connections.delete(socket));
      });
    });
  } catch (error) {
    stopHeartbeat();
    await watcher.close();
    throw error;
  }
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${HOST}:${actualPort}`,
    async close() {
      stopHeartbeat();
      for (const socket of sockets.clients) socket.terminate();
      await watcher.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        if ("closeAllConnections" in server) server.closeAllConnections();
        // closeAllConnections() skips sockets handed to the upgrade handler: a handshake
        // still in progress, or one refused that the client hasn't hung up on.
        for (const socket of connections) socket.destroy();
      });
    },
  };
}

/**
 * Pings every socket each `ms` and drops the ones that didn't answer the last ping (a
 * browser that went away without closing). Browsers answer pings by themselves, but a page
 * can't see them, so each ping also goes out as a "ping" message: a page that hears nothing
 * for a while knows the hub stopped answering (see web/live.ts).
 */
function heartbeat(sockets: WebSocketServer, ms: number): () => void {
  const ping = JSON.stringify({ type: "ping" } satisfies LiveMessage);
  const answered = new WeakSet<object>();
  sockets.on("connection", (socket) => {
    answered.add(socket);
    socket.on("pong", () => answered.add(socket));
  });
  const timer = setInterval(() => {
    for (const socket of sockets.clients) {
      if (!answered.delete(socket)) {
        socket.terminate();
      } else {
        socket.ping();
        socket.send(ping);
      }
    }
  }, ms);
  timer.unref();
  return () => clearInterval(timer);
}

export function isWebSocketUpgrade(request: IncomingMessage): boolean {
  return request.headers.upgrade?.toLowerCase() === "websocket";
}

type Output = { log: (line: string) => void; error: (line: string) => void };

/**
 * Runs the hub until SIGINT or SIGTERM, for `npm start` and `president serve`. Expected
 * failures (port in use, a broken config file) are printed as one line; returns the exit code.
 */
export async function runServer(out: Output = console): Promise<number> {
  let hub: RunningHub;
  try {
    hub = await startHub();
  } catch (error) {
    out.error(`president: ${startupError(error)}`);
    return 1;
  }
  out.log(`president is running at ${hub.url}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await hub.close();
  return 0;
}

function startupError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EADDRINUSE") {
    return "the port is already in use (is president already running?). Set PRESIDENT_PORT to use another one.";
  }
  if (code === "EACCES")
    return "not allowed to listen on that port. Set PRESIDENT_PORT to another one.";
  return (error as Error).message;
}
