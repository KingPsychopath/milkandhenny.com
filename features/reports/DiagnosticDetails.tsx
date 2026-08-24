"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { ReportDiagnosticsInput } from "./types";

export function DiagnosticDetails({
  diagnostics,
  responseError,
  children,
}: {
  diagnostics: ReportDiagnosticsInput;
  responseError?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <details open={open} suppressHydrationWarning className="relative text-left">
      <summary
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className="min-h-9 cursor-pointer select-none font-mono text-micro theme-muted"
      >
        developer details
      </summary>
      {open ? (
        <div className="absolute -right-3 bottom-[calc(100%+0.5rem)] z-50 w-[calc(100vw-1.5rem)] max-w-md border theme-border bg-background p-3 text-left shadow-sm">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] theme-muted">
            {JSON.stringify(
              {
                ...diagnostics,
                ...(responseError ? { responseError } : {}),
              },
              null,
              2,
            )}
          </pre>
          {children}
        </div>
      ) : null}
    </details>
  );
}
