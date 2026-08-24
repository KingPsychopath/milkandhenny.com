"use client";

import type { ReactNode } from "react";
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
  if (!import.meta.env.DEV) return null;
  return (
    <details className="w-full border-t theme-border pt-2 text-left">
      <summary className="min-h-9 cursor-pointer select-none font-mono text-micro theme-muted">
        developer details
      </summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] theme-faint">
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
    </details>
  );
}
