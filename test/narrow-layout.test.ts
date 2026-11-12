/**
 * The top bar at every width (S-11, S2-3). Its padding is the margin at the screen's edges,
 * so when its contents don't fit on one line the end group (Sync, the connection dot, ?)
 * wraps to its own line instead of running into that margin or scrolling the page sideways.
 * The Sync summary stays on one line, and is hidden (the count moves onto the Sync button)
 * wherever it doesn't fit next to the nav: Sync.tsx measures that and sets data-squeezed,
 * with no fixed breakpoint (S4-6; test/web/sync.test.tsx tests the measuring). Below 48rem
 * the bar takes its compact layout.
 *
 * Measured in headless Chrome over CDP (the built UI with a stub API, so "Connecting"
 * shows) at 27 widths from 320 to 1280 px, in both themes, with "16 answers not synced · 3
 * card changes on the remote" plus a skipped project's line, with "1 answer not synced",
 * and with three-digit counts: no sideways scroll and nothing overlapping at any width, ?
 * 12-20 px from the edge, and wherever the summary shows, the end group stays on the nav's
 * line. "1 answer not synced" shows from 480 px up; the usual counts at 768 px (where the
 * brand is hidden) and from about 1080 px; below that the count is on the button. The bar
 * is one line (50-56 px) except at about 360 px and below, where it wraps onto two (85
 * px); a skipped project's line adds 24 px.
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

  it("hides the summary and shows the count on the button where it doesn't fit (S4-6)", () => {
    expect(rule(".sync[data-squeezed] .sync-summary")).toMatchObject({
      position: "absolute",
      width: "1px",
    });
    expect(rule(".sync[data-squeezed] .sync-button .sync-count").display).toBe("inline-block");
    expect(rule(".sync-button .sync-count").display).toBe("none");
    // Measured, not a fixed breakpoint.
    expect(css).not.toContain("66rem");
  });

  it("puts a skipped project's answers on a line of their own (B2)", () => {
    expect(rule(".sync-skipped")["flex-basis"]).toBe("100%");
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
