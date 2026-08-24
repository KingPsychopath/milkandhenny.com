"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      summaryRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (!import.meta.env.DEV) return null;
  return (
    <details ref={detailsRef} open={open} suppressHydrationWarning className="relative text-left">
      <summary
        ref={summaryRef}
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
