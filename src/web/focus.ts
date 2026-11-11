import { type RefObject, useEffect } from "react";

/**
 * Puts focus on a page's heading once the page is ready, if focus was lost (it is on
 * `<body>`, as after leaving a card whose buttons are gone). Keyboard and screen reader users
 * then start at the top of the new page instead of nowhere. Focus that is somewhere real is
 * left alone.
 */
export function useHeadingFocus(heading: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const active = document.activeElement;
    if (!active || active === document.body) heading.current?.focus();
  }, [ready, heading]);
}
