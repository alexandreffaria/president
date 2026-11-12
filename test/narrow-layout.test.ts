/**
 * The top bar on a narrow screen (375 px): its padding is the margin at the screen's
 * edges, so when its contents don't fit on one line (large counts, a larger font) the end
 * group (Sync, the connection dot, ?) wraps to its own line instead of running into that
 * margin. Measured in Chrome at 375 px with two-digit counts: the ? button ends 12 px from
 * the edge, and with small counts the bar stays on one line.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = await readFile(join(import.meta.dirname, "..", "src", "web", "styles.css"), "utf8");

/** The declarations of `selector` inside the `@media (max-width: 40rem)` block. */
function narrowRule(selector: string): Record<string, string> {
  const start = css.indexOf("@media (max-width: 40rem) {");
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf("\n}\n", start));
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = new RegExp(`^ {2}${escaped} \\{([^}]*)\\}`, "m").exec(block)?.[1] ?? "";
  return Object.fromEntries(
    [...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}

describe("the top bar at 375 px (S-11)", () => {
  it("wraps rather than letting ? touch the screen's edge", () => {
    const topbar = narrowRule(".topbar");
    expect(topbar["flex-wrap"]).toBe("wrap");
    // Left and right padding: the margin ? keeps from the edge.
    const [, horizontal = "0"] = (topbar.padding ?? "").split(/\s+/);
    expect(Number.parseFloat(horizontal)).toBeGreaterThan(0);
  });
});
