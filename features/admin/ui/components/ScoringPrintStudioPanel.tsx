import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import {
  PRINT_LAYOUTS,
  PRINT_PACK_KINDS,
  type PrintLayout,
  type PrintPackKind,
} from "@/features/event-scoring/print";

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
  const [kind, setKind] = useState<PrintPackKind>("hunt");

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
          void onDownload({ action: "print-pdf", kind, layout, paper }).finally(() =>
            setBusy(false),
          );
        }}
      >
        <label className="font-mono text-xs">
          pack
          <AppSelect
            value={kind}
            onValueChange={(value) => setKind(value as PrintPackKind)}
            options={PRINT_PACK_KINDS.map((value) => ({
              value,
              label: value.replaceAll("-", " "),
            }))}
            variant="field"
            ariaLabel="Print pack"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          paper
          <AppSelect
            value={paper}
            onValueChange={(value) => setPaper(value as typeof paper)}
            options={[
              { value: "a4", label: "A4" },
              { value: "letter", label: "US Letter" },
              { value: "a5", label: "A5" },
              { value: "card", label: "Card" },
            ]}
            variant="field"
            ariaLabel="Paper size"
            className="mt-2"
          />
        </label>
        <label className="font-mono text-xs">
          layout
          <AppSelect
            value={layout}
            onValueChange={(value) => setLayout(value as PrintLayout)}
            options={Object.entries(PRINT_LAYOUTS).map(([value, option]) => ({
              value,
              label: option.label,
            }))}
            variant="field"
            ariaLabel="Print layout"
            className="mt-2"
          />
        </label>
        <button
          disabled={busy || (kind === "hunt" && discoveryCount === 0)}
          className="min-h-11 self-end border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-40"
        >
          {busy ? "building PDF..." : "download PDF"}
        </button>
      </form>
    </section>
  );
}
