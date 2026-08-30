"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Link } from "@tanstack/react-router";
import remarkGfm from "remark-gfm";
import { rehypeHashtags } from "@/lib/markdown/rehype-hashtags";
import { rehypeSlug } from "@/lib/markdown/rehype-slug";
import { AlbumEmbed, type EmbeddedAlbum, type EmbedVariant } from "./AlbumEmbed";
import { WordBodyTable, WordBodyTableCell, WordBodyTableRow } from "./WordBodyTable";
import { resolveWordContentRef } from "@/features/media/storage";
import { AppImage } from "@/components/AppImage";
import { imagePlaceholderStyle, type ResponsiveImageData } from "@/features/media/image";

type WordBodyProps = {
  content: string;
  wordSlug?: string;
  /**
   * Album data resolved server-side, keyed by href (e.g. "/pics/slug").
   * Entirely optional — omit or pass {} to disable album embeds.
   * To remove this feature: delete this prop and the AlbumEmbed import.
   */
  albums?: Record<string, EmbeddedAlbum>;
  privateMedia?: boolean;
  images?: Record<string, ResponsiveImageData>;
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
  const meaningful = node.children.filter(
    (c) => !(c.type === "text" && /^\s*$/.test(c.value ?? "")),
  );
  return (
    meaningful.length === 1 && meaningful[0].type === "element" && meaningful[0].tagName === "img"
  );
}

type InternalWordRoute =
  | { kind: "word"; slug: string; hash?: string }
  | { kind: "album"; album: string; hash?: string }
  | { kind: "photo"; album: string; photo: string; hash?: string }
  | { kind: "transfer"; id: string; hash?: string }
  | { kind: "upload"; hash?: string }
  | { kind: "admin"; hash?: string };

function parseInternalWordRoute(href: string): InternalWordRoute | undefined {
  if (!href.startsWith("/") || href.startsWith("//")) return undefined;

  const url = new URL(href, "https://milk-and-henny.invalid");
  // Search parameters need route-specific validation. Keep those links native
  // so their exact URL semantics are preserved.
  if (url.search) return undefined;

  const segments = url.pathname.split("/").filter(Boolean);
  let decodedSegments: string[];
  try {
    decodedSegments = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
  if (decodedSegments.some((segment) => segment.includes("/"))) return undefined;

  const hash = url.hash ? url.hash.slice(1) : undefined;
  if (decodedSegments.length === 2 && decodedSegments[0] === "words") {
    return { kind: "word", slug: decodedSegments[1], hash };
  }
  if (decodedSegments.length === 2 && decodedSegments[0] === "pics") {
    return { kind: "album", album: decodedSegments[1], hash };
  }
  if (decodedSegments.length === 3 && decodedSegments[0] === "pics") {
    return { kind: "photo", album: decodedSegments[1], photo: decodedSegments[2], hash };
  }
  if (decodedSegments.length === 2 && decodedSegments[0] === "t") {
    return { kind: "transfer", id: decodedSegments[1], hash };
  }
  if (decodedSegments.length === 1 && decodedSegments[0] === "upload") {
    return { kind: "upload", hash };
  }
  if (decodedSegments.length === 1 && decodedSegments[0] === "admin") {
    return { kind: "admin", hash };
  }
  return undefined;
}

function WordContentLink({
  href,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"a"> & { href: string }) {
  const route = parseInternalWordRoute(href);
  if (!route)
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );

  switch (route.kind) {
    case "word":
      return (
        <Link to="/words/$slug" params={{ slug: route.slug }} hash={route.hash} {...props}>
          {children}
        </Link>
      );
    case "album":
      return (
        <Link to="/pics/$album" params={{ album: route.album }} hash={route.hash} {...props}>
          {children}
        </Link>
      );
    case "photo":
      return (
        <Link
          to="/pics/$album/$photo"
          params={{ album: route.album, photo: route.photo }}
          hash={route.hash}
          {...props}
        >
          {children}
        </Link>
      );
    case "transfer":
      return (
        <Link
          to="/t/$id"
          params={{ id: route.id }}
          search={{ token: undefined }}
          hash={route.hash}
          {...props}
        >
          {children}
        </Link>
      );
    case "upload":
      return (
        <Link to="/upload" search={{ auth: undefined }} hash={route.hash} {...props}>
          {children}
        </Link>
      );
    case "admin":
      return (
        <Link to="/admin" search={{ view: "overview" }} hash={route.hash} {...props}>
          {children}
        </Link>
      );
  }
}

/* ─── Base components (always active) ─── */

function getBaseComponents(
  wordSlug?: string,
  privateMedia = false,
  images: Record<string, ResponsiveImageData> = {},
): Components {
  return {
    // The page title already owns h1. Editorial markdown starts at h2 even
    // when an imported document contains a top-level heading.
    h1: ({ children, node: _node, ...props }) => <h2 {...props}>{children}</h2>,

    table: ({ children, node, ...props }) => (
      <WordBodyTable {...props} node={node}>
        {children}
      </WordBodyTable>
    ),

    tr: ({ children, node, ...props }) => (
      <WordBodyTableRow {...props} node={node}>
        {children}
      </WordBodyTableRow>
    ),

    td: ({ children, node, ...props }) => (
      <WordBodyTableCell {...props} node={node as MarkdownNode | undefined}>
        {children}
      </WordBodyTableCell>
    ),

    /**
     * Images: resolves relative paths (e.g. "words/media/slug/image.webp" or "words/assets/kit/image.webp")
     * against the R2 public URL. Absolute URLs pass through unchanged.
     * Alt text → figure with caption.
     */
    img: ({ src, alt }) => {
      if (!src || typeof src !== "string") return null;
      const image = images[src];
      const resolved =
        image?.src ??
        resolveWordContentRef(src, wordSlug, {
          privacy: privateMedia ? "private" : "public",
        });
      if (!resolved) return null;

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
          <figure
            className="media-image-placeholder image-figure"
            style={imagePlaceholderStyle(image?.placeholder)}
          >
            <AppImage
              src={resolved}
              srcSet={image?.srcSet}
              sources={image?.sources}
              alt={alt}
              width={image?.width}
              height={image?.height}
              reveal
              sizes="(min-width: 672px) 624px, calc(100vw - 3rem)"
              onError={handleError}
            />
            <figcaption className="image-caption">{alt}</figcaption>
          </figure>
        );
      }

      return (
        <figure
          className="media-image-placeholder image-figure"
          style={imagePlaceholderStyle(image?.placeholder)}
        >
          <AppImage
            src={resolved}
            srcSet={image?.srcSet}
            sources={image?.sources}
            alt=""
            width={image?.width}
            height={image?.height}
            reveal
            sizes="(min-width: 672px) 624px, calc(100vw - 3rem)"
            onError={handleError}
          />
        </figure>
      );
    },

    /**
     * Links: supports words shorthand paths while preserving internal app routes
     * such as /pics/... and /words/...
     */
    a: ({ href, children, ...props }) => {
      if (!href || typeof href !== "string") {
        return <a {...props}>{children}</a>;
      }
      const resolved = resolveWordContentRef(href, wordSlug, {
        privacy: privateMedia ? "private" : "public",
      });
      if (!resolved) return <span>{children}</span>;
      return (
        <WordContentLink href={resolved} {...props}>
          {children}
        </WordContentLink>
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
}

/**
 * Extend base components with the album-embed paragraph override.
 * Only called when there are actual albums to embed — otherwise
 * the default <p> renderer is used and AlbumEmbed is never invoked.
 */
function withAlbumEmbeds(
  albums: Record<string, EmbeddedAlbum>,
  wordSlug?: string,
  privateMedia = false,
  images: Record<string, ResponsiveImageData> = {},
): Components {
  const baseComponents = getBaseComponents(wordSlug, privateMedia, images);
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

          if (React.isValidElement(child)) {
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

const EMPTY_ALBUMS: Record<string, EmbeddedAlbum> = {};

/** Renders words markdown content as styled prose. Hashtags (#word) are styled via rehype-hashtags. */
export function WordBody({
  content,
  wordSlug,
  albums = EMPTY_ALBUMS,
  privateMedia = false,
  images = {},
}: WordBodyProps) {
  const hasAlbums = Object.keys(albums).length > 0;

  const components = React.useMemo(
    () =>
      hasAlbums
        ? withAlbumEmbeds(albums, wordSlug, privateMedia, images)
        : getBaseComponents(wordSlug, privateMedia, images),
    [albums, hasAlbums, images, privateMedia, wordSlug],
  );

  return (
    <div className="prose-blog font-serif">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, rehypeHashtags]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
