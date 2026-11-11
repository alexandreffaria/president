/**
 * The dev server's proxy errors (R5-6, R6-5): the live socket hanging up when a tab closes
 * prints nothing; every other error, http proxy errors included, is printed as it was.
 */
import type { Logger } from "vite";
import { describe, expect, it } from "vitest";
import { quietProxyErrors } from "../vite.config.ts";

function errno(message: string, code?: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), code ? { code } : {});
}

/** What Vite logs for a proxy error: the red heading, then the stack. */
function viteMessage(heading: string, error: Error): string {
  return `\x1b[31m${heading}\x1b[39m\n${error.stack}`;
}

function logger() {
  const printed: { message: string; error: unknown }[] = [];
  const base = {
    error: (message: string, options?: { error?: unknown }) =>
      printed.push({ message, error: options?.error }),
  } as unknown as Logger;
  return { quiet: quietProxyErrors(base), printed };
}

describe("quietProxyErrors", () => {
  it("drops only the live socket hanging up", () => {
    const { quiet, printed } = logger();
    for (const [heading, code] of [
      ["ws proxy error:", "EPIPE"],
      ["ws proxy socket error:", "ECONNRESET"],
    ] as const) {
      const error = errno(`write ${code}`, code);
      quiet.error(viteMessage(heading, error), { timestamp: true, error });
    }
    expect(printed).toEqual([]);
  });

  it("prints every other error whole, http proxy hang-ups included", () => {
    const { quiet, printed } = logger();
    const cases = [
      ["http proxy error: /api/cards/demo/0002/actions", errno("socket hang up", "ECONNRESET")],
      ["http proxy error: /api/cards", errno("Parse Error: Invalid header value char", "HPE_X")],
      ["ws proxy error:", errno("connect ECONNREFUSED 127.0.0.1:4747", "ECONNREFUSED")],
      ["ws proxy error:", errno("Something without an errno code")],
    ] as const;
    for (const [heading, error] of cases) {
      quiet.error(viteMessage(heading, error), { timestamp: true, error });
    }
    expect(printed).toEqual(
      cases.map(([heading, error]) => ({ message: viteMessage(heading, error), error })),
    );
    quiet.error("Internal server error: something\n  at x");
    expect(printed.at(-1)?.message).toBe("Internal server error: something\n  at x");
  });
});
