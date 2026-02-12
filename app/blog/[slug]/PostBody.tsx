"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type PostBodyProps = {
  content: string;
};

/** Renders markdown content as styled prose */
export function PostBody({ content }: PostBodyProps) {
  return (
    <div className="prose-blog">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
