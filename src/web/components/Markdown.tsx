import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const components: Components = {
  // Links in cards point at sources; open them without leaving the queue.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

/**
 * Renders card markdown (GitHub flavoured, with highlighted code).
 * Raw HTML in cards is not rendered, only shown as text.
 */
export const Markdown = memo(function Markdown(props: { children: string; className?: string }) {
  if (!props.children.trim()) return null;
  return (
    <div className={`markdown ${props.className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {props.children}
      </ReactMarkdown>
    </div>
  );
});
