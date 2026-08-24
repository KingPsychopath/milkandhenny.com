"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { ReportDiagnosticsInput } from "./types";

export function DiagnosticDetails({
  diagnostics,
  responseError,
  children,
  placement = "popover",
}: {
  diagnostics: ReportDiagnosticsInput;
  responseError?: string;
  children?: ReactNode;
  placement?: "popover" | "inline";
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
  const inline = placement === "inline";
  return (
    <details
      ref={detailsRef}
      open={open}
      suppressHydrationWarning
      className={inline ? "w-full border-t theme-border pt-3 text-left" : "relative text-left"}
    >
      <summary
        ref={summaryRef}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className={`${
          inline
            ? "flex min-h-11 w-full items-center justify-between gap-4"
            : "flex min-h-9 items-center gap-2"
        } cursor-pointer list-none select-none font-mono text-micro theme-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground`}
      >
        <span>developer details</span>
        <span aria-hidden="true" className="theme-faint">
          {open ? "hide" : "show"}
        </span>
      </summary>
      {open ? (
        <div
          className={
            inline
              ? "mt-2 w-full border theme-border bg-background p-3 text-left"
              : "absolute right-0 bottom-[calc(100%+0.5rem)] z-50 w-[calc(100vw-1.5rem)] max-w-sm border theme-border bg-background p-3 text-left shadow-sm"
          }
        >
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
