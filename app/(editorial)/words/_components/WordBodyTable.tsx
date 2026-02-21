"use client";

import React, { type ReactNode } from "react";

type TableContextValue = {
  isGlobalExpanded: boolean;
  isRowExpanded: (rowId: string) => boolean;
  toggleRow: (rowId: string) => void;
};

type TableData = {
  headers: string[];
  rows: string[][];
};

const TABLE_TEXT_LIMIT = 36;
const TABLE_LINE_LIMIT = 2;
const TableRenderContext = React.createContext<TableContextValue | null>(null);
const TableRowContext = React.createContext<string | null>(null);

function getNodePositionId(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
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
  if (!start) return null;
  return `${start.line ?? "?"}:${start.column ?? "?"}:${start.offset ?? "?"}`;
}

function getNodeLineId(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const maybePosition = node as {
    position?: {
      start?: {
        line?: number;
      };
    };
  };
  const line = maybePosition.position?.start?.line;
  return typeof line === "number" ? `line:${line}` : null;
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

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function rowCellsFromDom(row: HTMLTableRowElement): string[] {
  return Array.from(row.querySelectorAll("th, td"))
    .map((cell) => normalizeCellText(cell.textContent ?? ""))
    .filter((value) => value.length > 0);
}

function extractTableDataFromDom(tableEl: HTMLTableElement | null): TableData {
  if (!tableEl) return { headers: [], rows: [] };

  const theadRows = tableEl.tHead ? Array.from(tableEl.tHead.rows) : [];
  const tbodyRows = tableEl.tBodies.length > 0 ? Array.from(tableEl.tBodies[0].rows) : [];

  if (theadRows.length > 0) {
    const headers = rowCellsFromDom(theadRows[0]);
    const rows = tbodyRows.map(rowCellsFromDom).filter((row) => row.length > 0);
    return { headers, rows };
  }

  const allRows = Array.from(tableEl.rows);
  if (allRows.length === 0) return { headers: [], rows: [] };
  const [first, ...rest] = allRows;
  return {
    headers: rowCellsFromDom(first),
    rows: rest.map(rowCellsFromDom).filter((row) => row.length > 0),
  };
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

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy path.
  }

  try {
    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
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
  const [expandedRows, setExpandedRows] = React.useState<Record<string, boolean>>({});
  const [copied, setCopied] = React.useState(false);
  const tableRef = React.useRef<HTMLTableElement | null>(null);

  React.useLayoutEffect(() => {
    setIsGlobalExpanded(false);
    setExpandedRows({});
  }, [children]);

  const toggleRow = React.useCallback((rowId: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowId]: !prev[rowId] }));
  }, []);

  const contextValue = React.useMemo<TableContextValue>(
    () => ({
      isGlobalExpanded,
      toggleRow,
      isRowExpanded: (rowId: string) => Boolean(expandedRows[rowId]),
    }),
    [expandedRows, isGlobalExpanded, toggleRow]
  );

  React.useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = React.useCallback(async () => {
    const tableData = extractTableDataFromDom(tableRef.current);
    const markdown = toMarkdownTable(tableData);
    const fallback = toCsv(tableData).replace(/,/g, "\t");
    const ok = await copyText(markdown || fallback);
    if (ok) setCopied(true);
  }, []);

  const handleDownloadCsv = React.useCallback(() => {
    const tableData = extractTableDataFromDom(tableRef.current);
    downloadTextFile("table.csv", toCsv(tableData), "text/csv;charset=utf-8");
  }, []);

  const handleDownloadMarkdown = React.useCallback(() => {
    const tableData = extractTableDataFromDom(tableRef.current);
    downloadTextFile("table.md", toMarkdownTable(tableData), "text/markdown;charset=utf-8");
  }, []);

  return (
    <div className={`prose-table ${isGlobalExpanded ? "prose-table--expanded" : "prose-table--compact"}`}>
      <div className="prose-table-scroll">
        <TableRenderContext.Provider value={contextValue}>
          <table ref={tableRef} {...props}>{children}</table>
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
            <DownloadIcon />
          </button>
          <button
            type="button"
            className="prose-table-button prose-table-icon-button"
            onClick={handleDownloadMarkdown}
            aria-label="download markdown"
            title="download markdown"
          >
            <MarkdownIcon />
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

  const rowContextId = React.useContext(TableRowContext);
  const fallbackCellId = React.useId();
  const fallbackRowId = React.useId();
  const cellId = getNodePositionId(node) ?? fallbackCellId;
  const rowId = rowContextId ?? getNodeLineId(node) ?? `row:${fallbackRowId}`;
  const text = textFromChildren(children);
  const canClamp = shouldClampCell(text);
  const isExpanded = tableContext.isGlobalExpanded || tableContext.isRowExpanded(rowId);
  const shouldClamp = !tableContext.isGlobalExpanded && canClamp && !isExpanded;
  const isToggleable = canClamp && !tableContext.isGlobalExpanded;

  const toggle = () => tableContext.toggleRow(rowId);
  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement && Boolean(target.closest("a, button, input, select, textarea, summary"));

  return (
    <td
      {...props}
      role={isToggleable ? "button" : undefined}
      tabIndex={isToggleable ? 0 : undefined}
      aria-expanded={isToggleable ? isExpanded : undefined}
      onClick={(event) => {
        props.onClick?.(event);
        if (!isToggleable || isInteractiveTarget(event.target)) return;
        toggle();
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!isToggleable || isInteractiveTarget(event.target)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <div className={`prose-table-cell ${shouldClamp ? "prose-table-cell--clamped" : ""} ${isToggleable ? "prose-table-cell--toggleable" : ""}`}>
        {children}
      </div>
    </td>
  );
}

export function WordBodyTableRow({
  children,
  node,
  ...props
}: React.DetailedHTMLProps<React.HTMLAttributes<HTMLTableRowElement>, HTMLTableRowElement> & {
  node?: unknown;
}) {
  const fallbackRowId = React.useId();
  const rowId = getNodePositionId(node) ?? getNodeLineId(node) ?? `row:${fallbackRowId}`;
  return (
    <TableRowContext.Provider value={rowId}>
      <tr {...props}>{children}</tr>
    </TableRowContext.Provider>
  );
}
