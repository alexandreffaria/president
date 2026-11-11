// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpOverlay } from "../../src/web/components/HelpOverlay.tsx";
import { type KeyMap, shortcutAllowed, useKeyboard, useKeyLayer } from "../../src/web/keyboard.ts";
import { parseRoute } from "../../src/web/router.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function Page(props: { keys: KeyMap; children?: React.ReactNode }) {
  useKeyboard(props.keys);
  return <>{props.children}</>;
}

describe("shortcutAllowed", () => {
  const event = (key: string, target: Element, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, ...init });
    Object.defineProperty(e, "target", { value: target });
    return e;
  };
  const make = (html: string) => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    document.body.append(wrapper);
    return wrapper.firstElementChild as Element;
  };

  it("leaves Enter and Space to buttons, links, summaries and ARIA widgets", () => {
    for (const html of [
      "<button>x</button>",
      '<a href="/x">x</a>',
      "<details><summary>x</summary></details>",
      '<div role="button" tabindex="0">x</div>',
      '<span role="link" tabindex="0">x</span>',
    ]) {
      const el = make(html);
      const target = el.tagName === "DETAILS" ? (el.firstElementChild as Element) : el;
      expect(shortcutAllowed(event("Enter", target)), html).toBe(false);
      expect(shortcutAllowed(event(" ", target)), html).toBe(false);
      // Other keys still work there.
      expect(shortcutAllowed(event("j", target)), html).toBe(true);
    }
    expect(shortcutAllowed(event("Enter", document.body))).toBe(true);
    expect(shortcutAllowed(event("Enter", make("<a>no href</a>")))).toBe(true);
  });

  it("ignores every key while typing", () => {
    for (const html of [
      "<input>",
      "<textarea></textarea>",
      "<select><option>a</option></select>",
      '<div contenteditable="true">x</div>',
    ]) {
      const el = make(html);
      if (el instanceof HTMLElement && el.hasAttribute("contenteditable")) {
        Object.defineProperty(el, "isContentEditable", { value: true });
      }
      for (const key of ["j", "1", "Enter", "Escape", "?"]) {
        expect(shortcutAllowed(event(key, el)), `${key} in ${html}`).toBe(false);
      }
    }
  });

  it("ignores modified keys and anything behind an open modal", () => {
    expect(shortcutAllowed(event("j", document.body, { ctrlKey: true }))).toBe(false);
    expect(shortcutAllowed(event("j", document.body, { metaKey: true }))).toBe(false);
    expect(shortcutAllowed(event("j", document.body, { altKey: true }))).toBe(false);
    expect(shortcutAllowed(event("?", document.body, { shiftKey: true }))).toBe(true);
    make("<dialog open><p>help</p></dialog>");
    expect(shortcutAllowed(event("d", document.body))).toBe(false);
  });
});

describe("useKeyboard", () => {
  it("doesn't steal Enter from a focused button, and handles it on the page", () => {
    const enter = vi.fn();
    const clicked = vi.fn();
    act(() =>
      root.render(
        <Page keys={{ enter }}>
          <button type="button" onClick={clicked}>
            Neither…
          </button>
        </Page>,
      ),
    );
    const button = host.querySelector("button") as HTMLButtonElement;
    button.focus();
    const onButton = press(button, "Enter");
    expect(enter).not.toHaveBeenCalled();
    // Not cancelled, so the browser still activates the button.
    expect(onButton.defaultPrevented).toBe(false);

    const onPage = press(document.body, "Enter");
    expect(enter).toHaveBeenCalledTimes(1);
    expect(onPage.defaultPrevented).toBe(true);
  });

  it("doesn't steal Enter from a focused link", () => {
    const enter = vi.fn();
    act(() =>
      root.render(
        <Page keys={{ enter }}>
          <a href="/card/demo/0002">second card</a>
        </Page>,
      ),
    );
    const link = host.querySelector("a") as HTMLAnchorElement;
    expect(press(link, "Enter").defaultPrevented).toBe(false);
    expect(enter).not.toHaveBeenCalled();
  });

  it("lets a handler decline a key by returning false", () => {
    act(() => root.render(<Page keys={{ enter: () => false }} />));
    expect(press(document.body, "Enter").defaultPrevented).toBe(false);
  });
});

function Help(props: { keys: KeyMap; open: boolean; onClose: () => void }) {
  useKeyboard(props.keys);
  return (
    <>
      <button type="button" id="opener">
        ?
      </button>
      {props.open && <HelpOverlay onClose={props.onClose} />}
    </>
  );
}

describe("the help dialog", () => {
  function open(keys: KeyMap) {
    const onClose = vi.fn();
    act(() => root.render(<Help keys={keys} open={false} onClose={onClose} />));
    const opener = host.querySelector("#opener") as HTMLButtonElement;
    opener.focus();
    act(() => root.render(<Help keys={keys} open onClose={onClose} />));
    return { onClose, opener };
  }

  it("turns page shortcuts off while it is open", () => {
    const defer = vi.fn();
    const back = vi.fn();
    const { onClose } = open({ d: defer, escape: back });
    const dialog = host.querySelector("dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    press(document.activeElement ?? dialog, "d");
    press(document.body, "d");
    expect(defer).not.toHaveBeenCalled();
    press(document.activeElement ?? dialog, "Escape");
    expect(back).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on ? without the page reopening it", () => {
    const help = vi.fn();
    const { onClose } = open({ "?": help });
    const event = press(document.activeElement ?? document.body, "?", { shiftKey: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(help).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("moves focus in, keeps Tab inside, and gives focus back when it closes", () => {
    const { opener } = open({});
    const dialog = host.querySelector("dialog") as HTMLDialogElement;
    const close = dialog.querySelector("button") as HTMLButtonElement;
    expect(document.activeElement).toBe(close);
    // The only control: Tab and Shift+Tab stay on it.
    expect(press(close, "Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(press(close, "Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    act(() => root.render(<Help keys={{}} open={false} onClose={() => {}} />));
    expect(document.activeElement).toBe(opener);
  });
});

function Panel(props: { page: KeyMap; layer: KeyMap; open: boolean }) {
  useKeyboard(props.page);
  useKeyLayer(props.layer, props.open);
  return props.open ? (
    <div>
      <textarea />
      <button type="button">Close</button>
    </div>
  ) : null;
}

describe("key layers (panels holding input)", () => {
  it("turn page shortcuts off wherever focus is, and get Esc even from a text field", () => {
    const page = { j: vi.fn(), d: vi.fn(), escape: vi.fn() };
    const layer = { escape: vi.fn(), j: vi.fn() };
    act(() => root.render(<Panel page={page} layer={layer} open />));
    const button = host.querySelector("button") as HTMLButtonElement;
    for (const target of [button, document.body]) {
      press(target, "j");
      press(target, "d");
    }
    expect(page.j).not.toHaveBeenCalled();
    expect(page.d).not.toHaveBeenCalled();
    // The layer's own keys follow the usual rules (here, focus on a button is fine)...
    expect(layer.j).toHaveBeenCalledTimes(2);
    // ...and Esc reaches it from the textarea, while the page's Esc does not run.
    press(host.querySelector("textarea") as HTMLTextAreaElement, "Escape");
    expect(layer.escape).toHaveBeenCalledTimes(1);
    expect(page.escape).not.toHaveBeenCalled();

    act(() => root.render(<Panel page={page} layer={layer} open={false} />));
    press(document.body, "j");
    expect(page.j).toHaveBeenCalledTimes(1);
  });
});

describe("parseRoute", () => {
  it("treats a malformed escape as an unknown page instead of crashing", () => {
    expect(parseRoute("/card/%E0%A4%A/x")).toEqual({ name: "not-found" });
    expect(parseRoute("/card/my%20project/0001")).toEqual({
      name: "card",
      project: "my project",
      id: "0001",
    });
    expect(parseRoute("/")).toEqual({ name: "queue" });
  });
});
