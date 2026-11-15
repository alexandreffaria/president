import { type RefObject, useEffect, useRef } from "react";

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

/**
 * Focus that goes somewhere once a change has rendered: set the returned flag where the
 * change is made, and once `trigger` changes with `due` true, `focus` runs and the flag is
 * cleared. The effect runs whenever `trigger` changes, as one written inline would.
 */
export function useFocusReturn(
  trigger: unknown,
  due: boolean,
  focus: () => void,
): RefObject<boolean> {
  const pending = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `trigger` is what reruns it
  useEffect(() => {
    if (!due || !pending.current) return;
    pending.current = false;
    focus();
  }, [trigger]);
  return pending;
}
