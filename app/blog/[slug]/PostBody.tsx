"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeHashtags } from "@/lib/rehype-hashtags";
import {
  AlbumEmbed,
  type EmbeddedAlbum,
} from "@/components/blog/AlbumEmbed";

type PostBodyProps = {
  content: string;
  /**
   * Album data resolved server-side, keyed by href (e.g. "/pics/slug").
   * Entirely optional — omit or pass {} to disable album embeds.
   * To remove this feature: delete this prop and the AlbumEmbed import.
   */
  albums?: Record<string, EmbeddedAlbum>;
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

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Swallow — embed is cosmetic, the fallback link still works
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/* ─── Helpers ─── */

/** Check if a paragraph's only child is an image (to unwrap <figure> from <p>) */
function isImageOnlyParagraph(children: ReactNode): boolean {
  const childArray = React.Children.toArray(children);
  if (childArray.length !== 1) return false;
  const child = childArray[0];
  return React.isValidElement(child) && child.type === "img";
}

/* ─── Base components (always active) ─── */

const baseComponents: Components = {
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

  /**
   * Unwrap paragraphs that contain only an image.
   * Markdown wraps ![alt](src) in <p>, but our img override returns
   * <figure> + <figcaption> which can't be nested inside <p>.
   */
  p: ({ children, ...props }) => {
    if (isImageOnlyParagraph(children)) {
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
function withAlbumEmbeds(
  albums: Record<string, EmbeddedAlbum>
): Components {
  return {
    ...baseComponents,

    p: ({ children, ...props }) => {
      // Unwrap image-only paragraphs (same as base)
      if (isImageOnlyParagraph(children)) {
        return <>{children}</>;
      }

      try {
        const childArray = React.Children.toArray(children);

        if (childArray.length === 1) {
          const child = childArray[0];

          if (React.isValidElement(child) && child.type === "a") {
            const href = (child.props as { href?: string }).href;

            if (href && albums[href]) {
              // Wrap in error boundary — if AlbumEmbed crashes, render the plain link
              return (
                <EmbedErrorBoundary fallback={<p {...props}>{children}</p>}>
                  <AlbumEmbed album={albums[href]} />
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

  const components = React.useMemo(
    () => (hasAlbums ? withAlbumEmbeds(albums) : baseComponents),
    [albums, hasAlbums]
  );

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
