// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Markdown } from "../../src/web/components/Markdown.tsx";

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
});

function render(text: string): HTMLElement {
  act(() => root.render(<Markdown>{text}</Markdown>));
  const code = host.querySelector("pre code");
  if (!(code instanceof HTMLElement)) throw new Error("no code block");
  return code;
}

describe("code highlighting", () => {
  it("highlights a loaded language, by name or alias", () => {
    const samples: [string, string][] = [
      ["typescript", 'const x = "a";'],
      ["ts", 'const x = "a";'],
      ["tsx", 'const x = "a";'],
      ["sh", 'echo "a"'],
      ["yml", "a: 1"],
      ["html", "<p>a</p>"],
      ["py", "def a(): pass"],
    ];
    for (const [lang, sample] of samples) {
      const code = render(`\`\`\`${lang}\n${sample}\n\`\`\``);
      expect(code.classList.contains("hljs"), lang).toBe(true);
      expect(code.classList.contains(`language-${lang}`), lang).toBe(true);
      expect(code.querySelector("[class^='hljs-']"), lang).not.toBeNull();
    }
  });

  it("keeps the code text as written", () => {
    const code = render('```ts\nconst x: number = 1; // "one"\n```');
    expect(code.textContent).toBe('const x: number = 1; // "one"\n');
  });

  it("shows a language that is not loaded as plain code", () => {
    const code = render('```haskell\nmain = putStrLn "hi"\n```');
    expect(code.classList.contains("hljs")).toBe(false);
    expect(code.children).toHaveLength(0);
    expect(code.textContent).toBe('main = putStrLn "hi"\n');
  });

  it("does not guess a language for a fence without one", () => {
    const code = render("```\nconst x = 1;\n```");
    expect(code.classList.contains("hljs")).toBe(false);
    expect(code.children).toHaveLength(0);
  });

  it("leaves inline code alone", () => {
    act(() => root.render(<Markdown>{"Run `const x = 1` now."}</Markdown>));
    const code = host.querySelector("code");
    expect(code?.children).toHaveLength(0);
    expect(code?.textContent).toBe("const x = 1");
  });
});
