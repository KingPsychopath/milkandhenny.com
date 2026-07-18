"use client";

import { useState } from "react";
import type { ReportType } from "./report-policy";
import type { ReportInputByType } from "./types";

export function ReportIssueButton<Type extends ReportType>({
  type,
  context,
  label = "something wrong? report this result",
}: {
  type: Type;
  context: ReportInputByType[Type];
  label?: string;
}) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async () => {
    if (status === "sending" || status === "sent") return;
    setStatus("sending");
    setErrorMessage("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, context }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error || "Could not save this report");
      setStatus("sent");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not report — check your connection",
      );
      setStatus("error");
    }
  };

  return (
    <div className="mt-2 flex min-h-11 items-center gap-3 font-mono text-micro text-black/35">
      <button
        type="button"
        disabled={status === "sending" || status === "sent"}
        onClick={() => void submit()}
        className="inline-flex min-h-11 items-center transition-opacity hover:opacity-70 disabled:opacity-60"
      >
        {status === "sending" ? "reporting…" : status === "sent" ? "reported — thank you" : label}
      </button>
      <span aria-live="polite">{status === "error" ? `${errorMessage} — try again` : ""}</span>
    </div>
  );
}
