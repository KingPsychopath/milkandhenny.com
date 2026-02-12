"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeHashtags } from "@/lib/rehype-hashtags";

type PostBodyProps = {
  content: string;
};

/** Custom component overrides for react-markdown */
const components: Components = {
  /** Images with alt text get wrapped in a figure with a caption */
  img: ({ src, alt }) => {
    if (!src) return null;

    if (alt) {
      return (
        <figure className="image-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} loading="lazy" />
          <figcaption className="image-caption">{alt}</figcaption>
        </figure>
      );
    }

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" loading="lazy" />
    );
  },
};

/** Renders markdown content as styled prose. Hashtags (#word) are styled via rehype-hashtags. */
export function PostBody({ content }: PostBodyProps) {
  return (
    <div className="prose-blog">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHashtags]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
