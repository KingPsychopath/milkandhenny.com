"use client";

import React, { type ReactNode } from "react";

type TableContextValue = {
  isGlobalExpanded: boolean;
  isExpanded: (cellId: string) => boolean;
  toggleCell: (cellId: string) => void;
};

type TableData = {
  headers: string[];
  rows: string[][];
};

const TABLE_TEXT_LIMIT = 36;
const TABLE_LINE_LIMIT = 2;
const TableRenderContext = React.createContext<TableContextValue | null>(null);

function getNodePositionId(node: unknown): string {
  if (!node || typeof node !== "object") return "unknown";
  const maybePosition = node as {
    position?: {
      start?: {
        line?: number;
        column?: number;
        offset?: number;
      };
    };
  };
  const start = maybePosition.position?.start;
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
  if (data.headers.length > 0) lines.push(data.headers.map(escapeCell).join(","));
  for (const row of data.rows) lines.push(row.map(escapeCell).join(","));
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

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="prose-table-icon">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.65" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="prose-table-icon">
      <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="prose-table-icon">
      <path d="M12 4v10m0 0 4-4m-4 4-4-4M4 20h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MarkdownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="prose-table-icon">
      <path d="M6 4h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15 4v5h5M8 16h8M8 12h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="prose-table-icon">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="4" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" opacity="0.65" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="prose-table-icon">
      <path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WordBodyTable({
  children,
  ...props
}: React.DetailedHTMLProps<React.TableHTMLAttributes<HTMLTableElement>, HTMLTableElement>) {
  const [isGlobalExpanded, setIsGlobalExpanded] = React.useState(false);
  const [expandedCells, setExpandedCells] = React.useState<Record<string, boolean>>({});
  const [copied, setCopied] = React.useState(false);
  const tableData = React.useMemo(() => extractTableData(children), [children]);

  React.useEffect(() => {
    setIsGlobalExpanded(false);
    setExpandedCells({});
  }, [children]);

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
          className="prose-table-button prose-table-icon-button"
          onClick={() => setIsGlobalExpanded((prev) => !prev)}
          aria-expanded={isGlobalExpanded}
          aria-label={isGlobalExpanded ? "collapse table" : "expand table"}
          title={isGlobalExpanded ? "collapse table" : "expand table"}
        >
          {isGlobalExpanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
        <div className="prose-table-footer-actions">
          <button
            type="button"
            className="prose-table-button prose-table-icon-button"
            onClick={handleDownloadCsv}
            aria-label="download csv"
            title="download csv"
          >
            <MarkdownIcon />
          </button>
          <button
            type="button"
            className="prose-table-button prose-table-icon-button"
            onClick={handleDownloadMarkdown}
            aria-label="download markdown"
            title="download markdown"
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            className="prose-table-button prose-table-icon-button"
            onClick={handleCopy}
            aria-label={copied ? "copied" : "copy"}
            title={copied ? "copied" : "copy"}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WordBodyTableCell({
  children,
  node,
  ...props
}: React.DetailedHTMLProps<React.TdHTMLAttributes<HTMLTableCellElement>, HTMLTableCellElement> & {
  node?: unknown;
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
      <div className={`prose-table-cell ${shouldClamp ? "prose-table-cell--clamped" : ""}`}>{children}</div>
      {canClamp && !tableContext.isGlobalExpanded ? (
        <button
          type="button"
          className="prose-table-cell-toggle"
          onClick={() => tableContext.toggleCell(cellId)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "Collapse this cell content" : "Expand this cell content"}
        >
          {isExpanded ? "collapse cell" : "expand cell"}
        </button>
      ) : null}
    </td>
  );
}
