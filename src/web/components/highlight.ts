import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import shell from "highlight.js/lib/languages/shell";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

/**
 * Only the languages cards realistically show, each with its usual aliases (ts, tsx, js,
 * sh, zsh, console, yml, md, py, html, svg, patch...). Kept to these on purpose: highlight.js
 * with all its common languages was most of the web bundle.
 */
const lowlight = createLowlight({
  bash,
  css,
  diff,
  javascript,
  json,
  markdown,
  python,
  shell,
  typescript,
  xml,
  yaml,
});

type Root = ReturnType<typeof lowlight.highlight>;
type Node = Root | Root["children"][number];
type Element = Extract<Node, { type: "element" }>;

function textOf(node: Node): string {
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(textOf).join("") : "";
}

function languageOf(code: Element): string | undefined {
  const classes = code.properties.className;
  if (!Array.isArray(classes)) return undefined;
  for (const name of classes) {
    if (typeof name === "string" && name.startsWith("language-")) return name.slice(9);
  }
  return undefined;
}

function visit(node: Node, parent: Node | undefined): void {
  if (node.type === "element" && node.tagName === "code" && parent?.type === "element") {
    if (parent.tagName === "pre") highlightCode(node);
    return;
  }
  if ("children" in node) for (const child of node.children) visit(child, node);
}

function highlightCode(code: Element): void {
  const lang = languageOf(code);
  // No language, or one not loaded: left as it is, plain code.
  if (!lang || !lowlight.registered(lang)) return;
  const result = lowlight.highlight(lang, textOf(code), { prefix: "hljs-" });
  const classes = code.properties.className as unknown[];
  if (!classes.includes("hljs")) classes.unshift("hljs");
  if (result.children.length > 0) code.children = result.children as Element["children"];
}

/**
 * Rehype plugin: highlights fenced code whose language is one of the few loaded above (what
 * rehype-highlight does with `detect: false, ignoreMissing: true`, without pulling in every
 * highlight.js language). Code in any other language, or none, stays plain.
 */
export function rehypeHighlightSome() {
  return (tree: Root) => visit(tree, undefined);
}
