/**
 * The dev server's proxy errors (R5-6): a tab closing its live socket prints nothing, and a
 * hub that is down prints one short line, not a stack trace per reconnect.
 */
import type { Logger } from "vite";
import { describe, expect, it } from "vitest";
import { quietProxyErrors } from "../vite.config.ts";

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code} happened`), { code });
}

function logger() {
  const printed: string[] = [];
  const base = {
    error: (message: string) => printed.push(message),
  } as unknown as Logger;
  let clock = 0;
  const quiet = quietProxyErrors(base, 10_000, () => clock);
  return { quiet, printed, tick: (ms: number) => (clock += ms) };
}

describe("quietProxyErrors", () => {
  it("drops hang-ups and shortens other proxy errors to one line, said once", () => {
    const { quiet, printed, tick } = logger();
    const stack = "\nError: write EPIPE\n    at afterWriteDispatched (node:internal/stream_base)";
    quiet.error(`ws proxy error:${stack}`, { error: errno("EPIPE") });
    quiet.error(`ws proxy socket error:${stack}`, { error: errno("ECONNRESET") });
    expect(printed).toEqual([]);

    for (let i = 0; i < 4; i++) {
      quiet.error(`ws proxy error:${stack}`, { error: errno("ECONNREFUSED") });
      tick(1000);
    }
    expect(printed).toEqual(["ws proxy error: (ECONNREFUSED)"]);
    tick(10_000);
    quiet.error(`ws proxy error:${stack}`, { error: errno("ECONNREFUSED") });
    expect(printed).toHaveLength(2);
  });

  it("leaves every other error as it was", () => {
    const { quiet, printed } = logger();
    quiet.error("Internal server error: something\n  at x");
    quiet.error("Internal server error: something\n  at x");
    expect(printed).toEqual([
      "Internal server error: something\n  at x",
      "Internal server error: something\n  at x",
    ]);
  });
});
