"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeHashtags } from "@/lib/markdown/rehype-hashtags";
import { rehypeSlug } from "@/lib/markdown/rehype-slug";
import { AlbumEmbed, type EmbeddedAlbum, type EmbedVariant } from "./AlbumEmbed";
import { resolveWordContentRef } from "@/features/media/storage";

type WordBodyProps = {
  content: string;
  wordSlug?: string;
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
  position?: {
    start?: {
      line?: number;
      column?: number;
      offset?: number;
    };
  };
};

type TableContextValue = {
  isGlobalExpanded: boolean;
  isExpanded: (cellId: string) => boolean;
  toggleCell: (cellId: string) => void;
};

const TABLE_TEXT_LIMIT = 90;
const TABLE_LINE_LIMIT = 4;
const TableRenderContext = React.createContext<TableContextValue | null>(null);

type TableData = {
  headers: string[];
  rows: string[][];
};

function getNodePositionId(node: MarkdownNode | undefined): string {
  const start = node?.position?.start;
  if (!start) return "unknown";
  return `${start.line ?? "?"}:${start.column ?? "?"}:${start.offset ?? "?"}`;
}

function textFromChildren(children: ReactNode): string {
  return React.Children.toArray(children)
    .map((child) => {
      if (typeof child === "string") return child;
      if (typeof child === "number") return String(child);
      if (!React.isValidElement(child)) return "";
      return textFromChildren((child.props as { children?: ReactNode }).children ?? "");
    })
    .join("")
    .trim();
}

function shouldClampCell(text: string): boolean {
  if (!text) return false;
  if (text.length > TABLE_TEXT_LIMIT) return true;
  const lineCount = text.split(/\n+/).length;
  return lineCount > TABLE_LINE_LIMIT;
}

function isTagElement(node: ReactNode, tag: string): node is React.ReactElement<{ children?: ReactNode }> {
  return React.isValidElement(node) && typeof node.type === "string" && node.type === tag;
}

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readRowCells(rowNode: ReactNode): string[] {
  if (!isTagElement(rowNode, "tr")) return [];
  return React.Children.toArray(rowNode.props.children)
    .filter((child): child is React.ReactElement<{ children?: ReactNode }> => isTagElement(child, "th") || isTagElement(child, "td"))
    .map((cell) => normalizeCellText(textFromChildren(cell.props.children)));
}

function readSectionRows(sectionNode: ReactNode): string[][] {
  if (!React.isValidElement(sectionNode)) return [];
  return React.Children.toArray((sectionNode.props as { children?: ReactNode }).children)
    .filter((child) => isTagElement(child, "tr"))
    .map(readRowCells)
    .filter((row) => row.length > 0);
}

function extractTableData(children: ReactNode): TableData {
  const nodes = React.Children.toArray(children);
  const thead = nodes.find((node) => isTagElement(node, "thead"));
  const tbody = nodes.find((node) => isTagElement(node, "tbody"));

  const headerRows = thead ? readSectionRows(thead) : [];
  const bodyRows = tbody ? readSectionRows(tbody) : nodes.filter((node) => isTagElement(node, "tr")).map(readRowCells);

  if (headerRows.length > 0) {
    return { headers: headerRows[0], rows: bodyRows };
  }

  if (bodyRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [first, ...rest] = bodyRows;
  return { headers: first, rows: rest };
}

function toCsv(data: TableData): string {
  const escapeCell = (value: string) => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  const lines: string[] = [];
  if (data.headers.length > 0) {
    lines.push(data.headers.map(escapeCell).join(","));
  }
  for (const row of data.rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function toMarkdownTable(data: TableData): string {
  const escapePipe = (value: string) => value.replace(/\|/g, "\\|");
  if (data.headers.length === 0) return "";
  const header = `| ${data.headers.map(escapePipe).join(" | ")} |`;
  const divider = `| ${data.headers.map(() => "---").join(" | ")} |`;
  const rows = data.rows.map((row) => `| ${row.map(escapePipe).join(" | ")} |`);
  return `${[header, divider, ...rows].join("\n")}\n`;
}

function downloadTextFile(filename: string, contents: string, contentType: string): void {
  const blob = new Blob([contents], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function SmartTable({
  children,
  ...props
}: React.DetailedHTMLProps<React.TableHTMLAttributes<HTMLTableElement>, HTMLTableElement>) {
  const [isGlobalExpanded, setIsGlobalExpanded] = React.useState(false);
  const [expandedCells, setExpandedCells] = React.useState<Record<string, boolean>>({});
  const [copied, setCopied] = React.useState(false);

  const tableData = React.useMemo(() => extractTableData(children), [children]);

  const toggleCell = React.useCallback((cellId: string) => {
    setExpandedCells((prev) => ({ ...prev, [cellId]: !prev[cellId] }));
  }, []);

  const contextValue = React.useMemo<TableContextValue>(
    () => ({
      isGlobalExpanded,
      toggleCell,
      isExpanded: (cellId: string) => Boolean(expandedCells[cellId]),
    }),
    [expandedCells, isGlobalExpanded, toggleCell]
  );

  React.useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = React.useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    const markdown = toMarkdownTable(tableData);
    const fallback = toCsv(tableData).replace(/,/g, "\t");
    await navigator.clipboard.writeText(markdown || fallback);
    setCopied(true);
  }, [tableData]);

  const handleDownloadCsv = React.useCallback(() => {
    downloadTextFile("table.csv", toCsv(tableData), "text/csv;charset=utf-8");
  }, [tableData]);

  const handleDownloadMarkdown = React.useCallback(() => {
    downloadTextFile("table.md", toMarkdownTable(tableData), "text/markdown;charset=utf-8");
  }, [tableData]);

  return (
    <div className={`prose-table ${isGlobalExpanded ? "prose-table--expanded" : "prose-table--compact"}`}>
      <div className="prose-table-scroll">
        <TableRenderContext.Provider value={contextValue}>
          <table {...props}>{children}</table>
        </TableRenderContext.Provider>
      </div>
      <div className="prose-table-footer">
        <button
          type="button"
          className="prose-table-button"
          onClick={() => setIsGlobalExpanded((prev) => !prev)}
          aria-expanded={isGlobalExpanded}
        >
          {isGlobalExpanded ? "Collapse table" : "Expand table"}
        </button>
        <div className="prose-table-footer-actions">
          <button type="button" className="prose-table-button" onClick={handleDownloadCsv}>
            Download CSV
          </button>
          <button type="button" className="prose-table-button" onClick={handleDownloadMarkdown}>
            Download Markdown
          </button>
          <button type="button" className="prose-table-button" onClick={handleCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SmartTableCell({
  children,
  node,
  ...props
}: React.DetailedHTMLProps<React.TdHTMLAttributes<HTMLTableCellElement>, HTMLTableCellElement> & {
  node?: MarkdownNode;
}) {
  const tableContext = React.useContext(TableRenderContext);
  if (!tableContext) return <td {...props}>{children}</td>;

  const cellId = getNodePositionId(node);
  const text = textFromChildren(children);
  const canClamp = shouldClampCell(text);
  const isExpanded = tableContext.isGlobalExpanded || tableContext.isExpanded(cellId);
  const shouldClamp = !tableContext.isGlobalExpanded && canClamp && !isExpanded;

  return (
    <td {...props}>
      <div className={`prose-table-cell ${shouldClamp ? "prose-table-cell--clamped" : ""}`}>
        {children}
      </div>
      {canClamp && !tableContext.isGlobalExpanded ? (
        <button
          type="button"
          className="prose-table-cell-toggle"
          onClick={() => tableContext.toggleCell(cellId)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse this cell content" : "Expand this cell content"}
        >
          {isExpanded ? "Collapse cell" : "Expand cell"}
        </button>
      ) : null}
    </td>
  );
}

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

function getBaseComponents(wordSlug?: string): Components {
  return {
  table: ({ children, ...props }) => <SmartTable {...props}>{children}</SmartTable>,

  td: ({ children, node, ...props }) => (
    <SmartTableCell {...props} node={node as MarkdownNode | undefined}>
      {children}
    </SmartTableCell>
  ),

  /**
   * Images: resolves relative paths (e.g. "words/media/slug/image.webp" or "words/assets/kit/image.webp")
   * against the R2 public URL. Absolute URLs pass through unchanged.
   * Alt text → figure with caption.
   */
  img: ({ src, alt }) => {
    if (!src || typeof src !== "string") return null;
    const resolved = resolveWordContentRef(src, wordSlug);

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
   * Links: supports words shorthand paths while preserving internal app routes
   * such as /pics/... and /words/...
   */
  a: ({ href, children, ...props }) => {
    if (!href || typeof href !== "string") {
      return <a {...props}>{children}</a>;
    }
    const resolved = resolveWordContentRef(href, wordSlug);
    return (
      <a href={resolved} {...props}>
        {children}
      </a>
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
function withAlbumEmbeds(albums: Record<string, EmbeddedAlbum>, wordSlug?: string): Components {
  const baseComponents = getBaseComponents(wordSlug);
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

/** Renders words markdown content as styled prose. Hashtags (#word) are styled via rehype-hashtags. */
export function WordBody({ content, wordSlug, albums = {} }: WordBodyProps) {
  const hasAlbums = Object.keys(albums).length > 0;

  const components = React.useMemo(
    () => (hasAlbums ? withAlbumEmbeds(albums, wordSlug) : getBaseComponents(wordSlug)),
    [albums, hasAlbums, wordSlug]
  );

  return (
    <div className="prose-blog font-serif">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, rehypeHashtags]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
