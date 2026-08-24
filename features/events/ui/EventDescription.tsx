import { createContext, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { PitchShowcase } from "@/features/things/pitches/ui/PitchShowcase";
import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle, type ResponsiveImageData } from "@/features/media/image";
import { resolveImageSrc } from "@/features/media/storage";
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

function eventDescriptionComponents(images: Record<string, ResponsiveImageData>): Components {
  return {
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
    img: ({ src, alt }) => {
      if (!src || typeof src !== "string") return null;
      const image = images[src];
      const resolved = image?.src ?? resolveImageSrc(src);
      if (!resolved) return null;
      return (
        <AppImage
          src={resolved}
          srcSet={image?.srcSet}
          sources={image?.sources}
          alt={alt ?? ""}
          width={image?.width}
          height={image?.height}
          sizes="(min-width: 672px) 624px, calc(100vw - 3rem)"
          style={imagePlaceholderStyle(image?.placeholder)}
        />
      );
    },
  };
}

export function EventDescription({
  content,
  pitchShowcase,
  images = {},
}: {
  content: string;
  pitchShowcase?: PublicPitchDeck[];
  images?: Record<string, ResponsiveImageData>;
}) {
  return (
    <PitchShowcaseContext.Provider value={pitchShowcase}>
      <section className="event-description mt-12 prose-blog">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={eventDescriptionComponents(images)}>
          {content}
        </ReactMarkdown>
      </section>
    </PitchShowcaseContext.Provider>
  );
}
