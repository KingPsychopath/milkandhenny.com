"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeHashtags } from "@/lib/rehype-hashtags";
import { rehypeSlug } from "@/lib/rehype-slug";
import { AlbumEmbed, type EmbeddedAlbum, type EmbedVariant } from "@/components/blog/AlbumEmbed";
import { resolveImageSrc } from "@/lib/media/storage";

type PostBodyProps = {
  content: string;
  /**
   * Album data resolved server-side, keyed by href (e.g. "/pics/slug").
   * Entirely optional — omit or pass {} to disable album embeds.
   * To remove this feature: delete this prop and the AlbumEmbed import.
   */
  albums?: Record<string, EmbeddedAlbum>;
};

type MarkdownNode = {
  type?: string;
  value?: string;
  tagName?: string;
  children?: MarkdownNode[];
};

/* ─── Error boundary: catches render errors in album embeds ─── */

type BoundaryProps = { fallback: ReactNode; children: ReactNode };
type BoundaryState = { hasError: boolean };

/** If AlbumEmbed throws during render, silently falls back to the normal link */
class EmbedErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Embed failures should not break reading; log for debugging.
    console.error("album.embed.render_failed", { error, info });
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/* ─── Helpers ─── */

/**
 * Check the hast AST node to see if this paragraph contains only an image.
 * We inspect the node rather than React children because react-markdown
 * replaces `img` with our custom component function, so `child.type === "img"`
 * no longer matches. The hast node always has `tagName: "img"`.
 */
function isImageOnlyParagraph(node: MarkdownNode | undefined): boolean {
  if (!node?.children) return false;
  // Filter out whitespace-only text nodes
  const meaningful = node.children.filter((c) => !(c.type === "text" && /^\s*$/.test(c.value ?? "")));
  return meaningful.length === 1 && meaningful[0].type === "element" && meaningful[0].tagName === "img";
}

/* ─── Base components (always active) ─── */

const baseComponents: Components = {
  /**
   * Images: resolves relative paths (e.g. "blog/slug/image.webp") against
   * the R2 public URL. Absolute URLs pass through unchanged.
   * Alt text → figure with caption.
   */
  img: ({ src, alt }) => {
    if (!src || typeof src !== "string") return null;
    const resolved = resolveImageSrc(src);

    /** Hide the image (or figure) if it fails to load */
    const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      const wrapper = img.closest(".image-figure");
      if (wrapper) {
        (wrapper as HTMLElement).style.display = "none";
      } else {
        img.style.display = "none";
      }
    };

    if (alt) {
      return (
        <figure className="image-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolved} alt={alt} loading="lazy" onError={handleError} />
          <figcaption className="image-caption">{alt}</figcaption>
        </figure>
      );
    }

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={resolved} alt="" loading="lazy" onError={handleError} />
    );
  },

  /**
   * Unwrap paragraphs that contain only an image.
   * Markdown wraps ![alt](src) in <p>, but our img override returns
   * <figure> + <figcaption> which can't be nested inside <p>.
   */
  p: ({ children, node, ...props }) => {
    if (isImageOnlyParagraph(node)) {
      return <>{children}</>;
    }
    return <p {...props}>{children}</p>;
  },
};

/**
 * Extend base components with the album-embed paragraph override.
 * Only called when there are actual albums to embed — otherwise
 * the default <p> renderer is used and AlbumEmbed is never invoked.
 */
function withAlbumEmbeds(albums: Record<string, EmbeddedAlbum>): Components {
  return {
    ...baseComponents,

    p: ({ children, node, ...props }) => {
      // Unwrap image-only paragraphs (same as base)
      if (isImageOnlyParagraph(node)) {
        return <>{children}</>;
      }

      try {
        const childArray = React.Children.toArray(children);

        if (childArray.length === 1) {
          const child = childArray[0];

          if (React.isValidElement(child) && child.type === "a") {
            const rawHref = (child.props as { href?: string }).href ?? "";
            // Strip hash to look up album data (keyed without #fragment)
            const cleanHref = rawHref.replace(/#.*$/, "");
            // Detect variant from hash: /pics/slug#masonry → masonry
            const variant: EmbedVariant = rawHref.includes("#masonry") ? "masonry" : "compact";

            if (cleanHref && albums[cleanHref]) {
              return (
                <EmbedErrorBoundary fallback={<p {...props}>{children}</p>}>
                  <AlbumEmbed album={albums[cleanHref]} variant={variant} />
                </EmbedErrorBoundary>
              );
            }
          }
        }
      } catch {
        // Any detection logic error → fall through to normal <p>
      }

      return <p {...props}>{children}</p>;
    },
  };
}

/** Renders markdown content as styled prose. Hashtags (#word) are styled via rehype-hashtags. */
export function PostBody({ content, albums = {} }: PostBodyProps) {
  const hasAlbums = Object.keys(albums).length > 0;

  const components = React.useMemo(() => (hasAlbums ? withAlbumEmbeds(albums) : baseComponents), [albums, hasAlbums]);

  return (
    <div className="prose-blog">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHashtags]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

