/** GET /api/events: a WebSocket of live events (server.ts serves it, web/live.ts connects). */
import { upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";
import type { ApiError, LiveMessage } from "../../core/api.ts";
import type { RouteDeps } from "./http.ts";

export function registerEventRoutes(api: Hono, { bus }: RouteDeps): void {
  // Live events. Each socket gets "ready" once it is subscribed, then every hub event.
  api.get(
    "/events",
    upgradeWebSocket(() => {
      let unsubscribe = () => {};
      return {
        onOpen(_event, ws) {
          const send = (message: LiveMessage) => ws.send(JSON.stringify(message));
          unsubscribe = bus.subscribe(send);
          send({ type: "ready" });
        },
        onClose() {
          unsubscribe();
        },
      };
    }),
    (c) =>
      c.json({ error: "/api/events is a WebSocket; connect with one" } satisfies ApiError, 426),
  );
}
