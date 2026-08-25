import { useState } from "react";

export function ScorePublicIdentityControls({
  ticketId,
  initialAlias,
  initialMode,
}: {
  ticketId: string;
  initialAlias: string;
  initialMode: "alias" | "anonymous" | "hidden";
}) {
  const [alias, setAlias] = useState(initialAlias);
  const [mode, setMode] = useState(initialMode);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setStatus("");
    const response = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score/profile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayMode: mode, publicAlias: alias }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    setStatus(
      response.ok
        ? "Public score display saved."
        : (body?.error ?? "Could not save display settings."),
    );
  }

  return (
    <details className="mt-3">
      <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
        public score name
      </summary>
      <div className="space-y-3 border-y theme-border py-4">
        <label className="block font-mono text-xs">
          display
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            <option value="alias">show my alias</option>
            <option value="anonymous">show as anonymous</option>
            <option value="hidden">leave the public board</option>
          </select>
        </label>
        {mode === "alias" && (
          <label className="block font-mono text-xs">
            alias
            <input
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              maxLength={40}
              className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
            />
          </label>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          save public display
        </button>
        {status && (
          <p role="status" className="font-mono text-xs">
            {status}
          </p>
        )}
      </div>
    </details>
  );
}
