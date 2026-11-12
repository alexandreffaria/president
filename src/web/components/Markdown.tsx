import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

const components: Components = {
  // Links in cards point at sources; open them without leaving the queue.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

/**
 * For text an agent wrote from what it read (a page it fetched may tell it what to write):
 * an image is a plain link, so showing the text never makes the browser load anything.
 */
const noImages: Components = {
  ...components,
  img: ({ src, alt }) => {
    const label = `Image: ${alt?.trim() || (typeof src === "string" ? src : "")}`;
    return typeof src === "string" && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  },
};

/**
 * Renders card markdown (GitHub flavoured, with highlighted code).
 * Raw HTML in cards is not rendered, only shown as text. With `imagesAsLinks`, images are
 * links instead of images (nothing loads until the human opens one).
 */
export const Markdown = memo(function Markdown(props: {
  children: string;
  className?: string;
  imagesAsLinks?: boolean;
}) {
  if (!props.children.trim()) return null;
  return (
    <div className={`markdown ${props.className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={props.imagesAsLinks ? noImages : components}
      >
        {props.children}
      </ReactMarkdown>
    </div>
  );
});
