import { createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { PitchShowcase } from "@/features/things/pitches/ui/PitchShowcase";
import {
  PITCH_SHOWCASE_MARKDOWN_HREF,
  type PublicPitchDeck,
} from "@/features/things/pitches/types";

type MarkdownNode = {
  type?: string;
  value?: string;
  tagName?: string;
  children?: MarkdownNode[];
  properties?: { href?: string };
};

const PitchShowcaseContext = createContext<PublicPitchDeck[] | undefined>(undefined);

function isPitchShowcaseParagraph(node: MarkdownNode | undefined): boolean {
  if (!node?.children) return false;
  const meaningful = node.children.filter((child) => child.type !== "text" || child.value?.trim());
  const link = meaningful[0];
  return (
    meaningful.length === 1 &&
    link?.type === "element" &&
    link.tagName === "a" &&
    (link.properties?.href ?? "") === PITCH_SHOWCASE_MARKDOWN_HREF
  );
}

function markdownText(node: MarkdownNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(markdownText).join("") ?? "";
}

function pitchShowcaseTitle(node: MarkdownNode | undefined): string | undefined {
  const link = node?.children?.find((child) => child.type === "element");
  const title = markdownText(link).trim();
  return title || undefined;
}

const EVENT_DESCRIPTION_COMPONENTS: Components = {
  p: ({ children, node, ...props }) => {
    const pitchShowcase = useContext(PitchShowcaseContext);
    if (pitchShowcase && isPitchShowcaseParagraph(node as MarkdownNode | undefined)) {
      return (
        <PitchShowcase
          pitches={pitchShowcase}
          title={pitchShowcaseTitle(node as MarkdownNode | undefined)}
        />
      );
    }
    return <p {...props}>{children}</p>;
  },
};

export function EventDescription({
  content,
  pitchShowcase,
}: {
  content: string;
  pitchShowcase?: PublicPitchDeck[];
}) {
  return (
    <PitchShowcaseContext.Provider value={pitchShowcase}>
      <section className="event-description mt-12 prose-blog">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={EVENT_DESCRIPTION_COMPONENTS}>
          {content}
        </ReactMarkdown>
      </section>
    </PitchShowcaseContext.Provider>
  );
}
