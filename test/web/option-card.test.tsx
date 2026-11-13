// @vitest-environment happy-dom
/** An option's Choose button shows the key that picks it, and none past the 9th (oew6). */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { OptionCard } from "../../src/web/components/OptionCard.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function chooseButton(index: number, kind: "choice" | "ab" = "choice"): HTMLButtonElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <OptionCard
        option={{ id: "x", title: "X", pros: [], cons: [] }}
        index={index}
        kind={kind}
        details={undefined}
        recommended={false}
        selected={false}
        chosen={false}
        selectable
        onSelect={() => {}}
      />,
    ),
  );
  const button = container.querySelector("button");
  if (!button) throw new Error("no Choose button");
  return button;
}

describe("OptionCard key hint", () => {
  it.each(["1", "9"])("shows key %s", (key) => {
    expect(chooseButton(Number(key) - 1).querySelector("kbd")?.textContent).toBe(key);
  });

  it("shows no key for the 10th option, which no key picks", () => {
    const button = chooseButton(9);
    expect(button.textContent).toBe("Choose 10");
    expect(button.querySelector("kbd")).toBeNull();
  });

  it("shows the number key on an A/B card", () => {
    expect(chooseButton(1, "ab").querySelector("kbd")?.textContent).toBe("2");
  });
});
