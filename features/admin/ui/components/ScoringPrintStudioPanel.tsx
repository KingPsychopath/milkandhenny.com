import { useState } from "react";

import { PRINT_LAYOUTS, type PrintLayout } from "@/features/event-scoring/print";

export function ScoringPrintStudioPanel({
  discoveryCount,
  onDownload,
}: {
  discoveryCount: number;
  onDownload: (input: Record<string, unknown>) => Promise<void>;
}) {
  const [layout, setLayout] = useState<PrintLayout>("eight-clues");
  const [paper, setPaper] = useState<"a4" | "letter" | "a5" | "card">("a4");
  const [busy, setBusy] = useState(false);

  return (
    <section aria-labelledby="scoring-print-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-print-heading" className="font-serif text-xl">
        Print Studio
      </h4>
      <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
        Export a stable black-and-white PDF. Every QR is decoded before the file is returned.
      </p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void onDownload({ action: "print-pdf", layout, paper }).finally(() => setBusy(false));
        }}
      >
        <label className="font-mono text-xs">
          paper
          <select
            value={paper}
            onChange={(event) => setPaper(event.target.value as typeof paper)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="a4">A4</option>
            <option value="letter">US Letter</option>
            <option value="a5">A5</option>
            <option value="card">Card</option>
          </select>
        </label>
        <label className="font-mono text-xs">
          layout
          <select
            value={layout}
            onChange={(event) => setLayout(event.target.value as PrintLayout)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            {Object.entries(PRINT_LAYOUTS).map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={busy || discoveryCount === 0}
          className="min-h-11 self-end border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-40"
        >
          {busy ? "building PDF..." : "download PDF"}
        </button>
      </form>
    </section>
  );
}
