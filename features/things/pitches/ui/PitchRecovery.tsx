import { useState } from "react";

import { recoverPitchAccessFn } from "../pitches.functions";

export function PitchRecovery({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    try {
      const result = await recoverPitchAccessFn({ data: { email } });
      if (!result.ok) {
        setStatus("error");
        setMessage(result.error);
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setMessage("Could not send the link. Try again.");
    }
  }

  if (status === "sent") {
    return (
      <p className="font-mono text-sm leading-relaxed theme-muted" role="status">
        If that address owns a pitch, its private links are on the way.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className={compact ? "" : "border-t theme-border pt-8"}>
      <label className="block font-mono text-xs uppercase tracking-[0.14em] theme-muted">
        Recover my pitches
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent px-0 font-mono text-base text-foreground outline-none focus:border-foreground"
        />
      </label>
      <button
        type="submit"
        disabled={status === "sending"}
        className="mt-5 min-h-11 border-b theme-border-strong font-mono text-sm text-foreground hover:opacity-60 disabled:opacity-40"
      >
        {status === "sending" ? "sending…" : "email my private links →"}
      </button>
      {status === "error" ? (
        <p className="mt-3 font-mono text-xs text-red-700 dark:text-red-300" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
