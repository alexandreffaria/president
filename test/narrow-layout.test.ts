/**
 * The top bar at every width (S-11, S2-3). Its padding is the margin at the screen's edges,
 * so when its contents don't fit on one line the end group (Sync, the connection dot, ?)
 * wraps to its own line instead of running into that margin or scrolling the page sideways.
 * The Sync summary stays on one line, and below 66rem it is hidden (the count moves onto
 * the Sync button); below 48rem the bar takes its compact layout.
 *
 * Measured in headless Chrome over CDP with a real hub (16 answers not synced and 3 card
 * changes on the remote, then again with "Connecting" and three-digit counts) at widths
 * from 320 to 1280 px: no sideways scroll at any of them, and the bar is one line (50-56 px)
 * except at about 398 px and below, where it wraps onto two (85 px) and ? ends 12 px from
 * the edge. From 66rem (1056 px) the summary shows: one line with those counts, two lines
 * up to about 1110 px with three-digit counts and "Connecting" (S3-7).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = await readFile(join(import.meta.dirname, "..", "src", "web", "styles.css"), "utf8");

/** The declarations of `selector` at the top level, or in the `@media (max-width: …)` block. */
function rule(selector: string, maxWidth?: string): Record<string, string> {
  let block = css;
  if (maxWidth) {
    const start = css.indexOf(`@media (max-width: ${maxWidth}) {`);
    expect(start).toBeGreaterThan(-1);
    block = css.slice(start, css.indexOf("\n}\n", start));
  }
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const indent = maxWidth ? " {2}" : "";
  const body = new RegExp(`^${indent}${escaped} \\{([^}]*)\\}`, "m").exec(block)?.[1] ?? "";
  return Object.fromEntries(
    [...body.matchAll(/([\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1] as string,
      (m[2] as string).trim(),
    ]),
  );
}

describe("the top bar (S-11, S2-3)", () => {
  it("wraps rather than scrolling sideways, at any width", () => {
    expect(rule(".topbar")["flex-wrap"]).toBe("wrap");
  });

  it("keeps the Sync summary on one line", () => {
    expect(rule(".sync-summary")["white-space"]).toBe("nowrap");
  });

  it("hides the summary and shows the count on the button below 66rem", () => {
    expect(rule(".sync-summary", "66rem")).toMatchObject({ position: "absolute", width: "1px" });
    expect(rule(".sync-button .sync-count", "66rem").display).toBe("inline-block");
  });

  it("keeps ? off the screen's edge in its compact layout below 48rem", () => {
    const topbar = rule(".topbar", "48rem");
    expect(topbar["flex-wrap"]).toBe("wrap");
    // Left and right padding: the margin ? keeps from the edge.
    const [, horizontal = "0"] = (topbar.padding ?? "").split(/\s+/);
    expect(Number.parseFloat(horizontal)).toBeGreaterThan(0);
    expect(rule(".brand", "48rem").display).toBe("none");
  });
});
