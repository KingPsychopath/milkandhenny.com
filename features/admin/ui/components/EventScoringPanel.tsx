import { useState } from "react";

import { ScoringActivitiesPanel } from "./ScoringActivitiesPanel";
import { ScoringDiscoveriesPanel } from "./ScoringDiscoveriesPanel";
import { ScoringCorrectionsPanel } from "./ScoringCorrectionsPanel";
import { ScoringPoolsPanel } from "./ScoringPoolsPanel";
import { ScoringPrintStudioPanel } from "./ScoringPrintStudioPanel";
import { ScoringLifecyclePanel } from "./ScoringLifecyclePanel";
import { ScoringStaffPanel } from "./ScoringStaffPanel";
import type { ScoringData } from "./event-scoring-types";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type StepUp = () => Promise<
  { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
>;
type StepUpHeaders = (token: string, extra?: Record<string, string>) => Record<string, string>;

export function EventScoringPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: StepUp;
  withStepUpHeaders: StepUpHeaders;
}) {
  const [eventSlug, setEventSlug] = useState("");
  const [data, setData] = useState<ScoringData | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(showBusy = true) {
    if (!eventSlug.trim()) {
      onError("Enter an event slug first.");
      return;
    }
    if (showBusy) setBusy(true);
    onError("");
    try {
      const response = await authFetch(
        `/api/admin/events/${encodeURIComponent(eventSlug.trim())}/scoring`,
      );
      if (!response.ok) throw new Error("Could not load scoring settings");
      setData((await response.json()) as ScoringData);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load scoring settings");
    } finally {
      if (showBusy) setBusy(false);
    }
  }

  async function performAction(body: Record<string, unknown>) {
    const stepUp = await ensureStepUpToken();
    if (!stepUp.ok) {
      if (stepUp.error) onError(stepUp.error);
      return null;
    }
    setBusy(true);
    onError("");
    try {
      const response = await authFetch(
        `/api/admin/events/${encodeURIComponent(eventSlug.trim())}/scoring`,
        {
          method: "POST",
          headers: withStepUpHeaders(stepUp.token, { "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Scoring action failed");
      await load(false);
      onStatus("Scoring changes saved.");
      return result;
    } catch (error) {
      onError(error instanceof Error ? error.message : "Scoring action failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function changeState(state: string) {
    const result = await performAction({ action: "state", state });
    if (result) onStatus(`Scoring is now ${state}.`);
  }

  async function downloadPrint(body: Record<string, unknown>) {
    const stepUp = await ensureStepUpToken();
    if (!stepUp.ok) {
      if (stepUp.error) onError(stepUp.error);
      return;
    }
    onError("");
    const response = await authFetch(
      `/api/admin/events/${encodeURIComponent(eventSlug.trim())}/scoring`,
      {
        method: "POST",
        headers: withStepUpHeaders(stepUp.token, { "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      onError(result?.error ?? "Could not build the print pack");
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download = `${eventSlug.trim()}-discovery-pack.pdf`;
    link.click();
    URL.revokeObjectURL(href);
    onStatus("Print pack downloaded.");
  }

  return (
    <section aria-labelledby="event-scoring-heading" className="border-t theme-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            event scoring
          </p>
          <h3 id="event-scoring-heading" className="mt-2 font-serif text-2xl font-semibold">
            Score control
          </h3>
          <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
            Start, freeze, and review one event without exposing participant identifiers or raw
            staff credentials.
          </p>
        </div>
        <form
          className="flex min-w-72 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <label className="sr-only" htmlFor="scoring-event-slug">
            Event slug
          </label>
          <input
            id="scoring-event-slug"
            value={eventSlug}
            onChange={(event) => setEventSlug(event.target.value)}
            placeholder="event-slug"
            className="min-h-11 min-w-0 flex-1 border-b theme-border bg-transparent px-0 font-mono text-xs outline-none focus:border-foreground"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
          >
            load
          </button>
        </form>
      </div>
      {data && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3 border-y theme-border py-4">
            <span className="font-mono text-xs">
              state: <strong>{data.settings.state}</strong>
            </span>
            {(["ready", "live", "frozen", "closed"] as const).map((state) => (
              <button
                key={state}
                type="button"
                disabled={busy || data.settings.state === state}
                onClick={() => void changeState(state)}
                className="min-h-11 border theme-border px-3 font-mono text-micro uppercase hover:opacity-70 disabled:opacity-40"
              >
                {state}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3 font-mono text-xs">
            <p className="border theme-border p-3">
              <span className="theme-muted">activities</span>
              <br />
              {data.activities.length}
            </p>
            <p className="border theme-border p-3">
              <span className="theme-muted">available pool</span>
              <br />
              {data.pools.reduce((sum, pool) => sum + pool.available, 0)}
            </p>
            <p className="border theme-border p-3">
              <span className="theme-muted">held results</span>
              <br />
              {data.held.length}
            </p>
          </div>
          <ScoringActivitiesPanel activities={data.activities} onAction={performAction} />
          <ScoringLifecyclePanel data={data} onAction={performAction} />
          <ScoringDiscoveriesPanel
            activities={data.activities}
            discoveries={data.discoveries}
            onAction={performAction}
          />
          <ScoringPrintStudioPanel
            discoveryCount={data.discoveries.length}
            onDownload={downloadPrint}
          />
          <ScoringPoolsPanel pools={data.pools} onAction={performAction} />
          <ScoringCorrectionsPanel
            eventSlug={eventSlug.trim()}
            state={data.settings.state}
            activities={data.activities}
            authFetch={authFetch}
            onAction={performAction}
          />
          <ScoringStaffPanel
            eventSlug={eventSlug.trim()}
            activities={data.activities}
            staff={data.staff}
            onAction={performAction}
          />
        </div>
      )}
    </section>
  );
}
