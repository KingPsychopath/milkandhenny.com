import { useCallback, useEffect, useMemo, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { EventRecord } from "@/features/events/types";

import { ScoringActivitiesPanel } from "./ScoringActivitiesPanel";
import { ScoringDiscoveriesPanel } from "./ScoringDiscoveriesPanel";
import { ScoringCorrectionsPanel } from "./ScoringCorrectionsPanel";
import { ScoringPoolsPanel } from "./ScoringPoolsPanel";
import { ScoringPrintStudioPanel } from "./ScoringPrintStudioPanel";
import { ScoringLifecyclePanel } from "./ScoringLifecyclePanel";
import { ScoringMediaPanel } from "./ScoringMediaPanel";
import { ScoringAuditPanel } from "./ScoringAuditPanel";
import { ScoringIdentityPanel } from "./ScoringIdentityPanel";
import { ScoringStaffPanel } from "./ScoringStaffPanel";
import { ScoringTestModePanel } from "./ScoringTestModePanel";
import { ScoringOperationsPanel } from "./ScoringOperationsPanel";
import { ScoringTeamsPanel } from "./ScoringTeamsPanel";
import type { ScoringData } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";
import { pickDefaultAdminEvent } from "./event-admin-selection";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type StepUp = () => Promise<
  { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
>;
type StepUpHeaders = (token: string, extra?: Record<string, string>) => Record<string, string>;

type ScoringWorkspace = "setup" | "content" | "live" | "media" | "review" | "people" | "pools";

const SCORING_WORKSPACES: Array<{
  id: ScoringWorkspace;
  label: string;
  description: string;
}> = [
  { id: "setup", label: "setup", description: "Activities and event lifecycle" },
  { id: "content", label: "discoveries", description: "Discoveries and print packs" },
  { id: "live", label: "live desk", description: "Test mode and live operations" },
  { id: "media", label: "media", description: "Scoring media and assets" },
  { id: "review", label: "review", description: "Audit, anomalies, and corrections" },
  { id: "people", label: "people", description: "Identity, teams, and staff" },
  { id: "pools", label: "pools", description: "Prize and item pools" },
];

export function EventScoringPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
  initialEventSlug,
  onEventChange,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: StepUp;
  withStepUpHeaders: StepUpHeaders;
  initialEventSlug?: string;
  onEventChange?: (eventSlug: string) => void;
}) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventSlug, setEventSlug] = useState(initialEventSlug ?? "");
  const [data, setData] = useState<ScoringData | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<ScoringWorkspace>("setup");

  const selectedEvent = events.find((event) => event.slug === eventSlug);
  const eventOptions = useMemo(
    () => events.map((event) => ({ value: event.slug, label: event.title })),
    [events],
  );

  const load = useCallback(
    async (showBusy = true, auditFilter?: Record<string, string>) => {
      if (!eventSlug.trim()) {
        return;
      }
      if (showBusy) setBusy(true);
      setLoadError(null);
      onError("");
      try {
        const query = new URLSearchParams(auditFilter).toString();
        const response = await authFetch(
          `/api/admin/events/${encodeURIComponent(eventSlug.trim())}/scoring${query ? `?${query}` : ""}`,
        );
        if (!response.ok) throw new Error("Could not load scoring settings");
        setData((await response.json()) as ScoringData);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not load scoring settings";
        setLoadError(message);
        onError(message);
      } finally {
        if (showBusy) setBusy(false);
      }
    },
    [authFetch, eventSlug, onError],
  );

  useEffect(() => {
    let cancelled = false;
    setEventsLoading(true);
    void authFetch("/api/admin/events")
      .then(async (response) => {
        const result = (await response.json().catch(() => null)) as {
          events?: EventRecord[];
        } | null;
        if (!response.ok || !Array.isArray(result?.events)) {
          throw new Error("Could not load events");
        }
        if (cancelled) return;
        setEvents(result.events);
        const requested = result.events.find((event) => event.slug === initialEventSlug);
        const preferred = requested ?? pickDefaultAdminEvent(result.events);
        if (preferred) setEventSlug(preferred.slug);
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : "Could not load events");
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authFetch, initialEventSlug, onError]);

  useEffect(() => {
    if (!eventSlug || eventsLoading) return;
    onEventChange?.(eventSlug);
    void load();
  }, [eventSlug, eventsLoading, load, onEventChange]);

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
    if (state === "live") {
      const summary = `${data?.activities.length ?? 0} activities and ${data?.discoveries.length ?? 0} discoveries will become live.`;
      if (!window.confirm(`Preview complete: ${summary}\n\nPublish live scoring now?`)) return;
    }
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

  async function downloadExport() {
    const stepUp = await ensureStepUpToken();
    if (!stepUp.ok) {
      if (stepUp.error) onError(stepUp.error);
      return;
    }
    const response = await authFetch(
      `/api/admin/events/${encodeURIComponent(eventSlug.trim())}/scoring`,
      {
        method: "POST",
        headers: withStepUpHeaders(stepUp.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "export" }),
      },
    );
    if (!response.ok) {
      onError("Could not export scoring data");
      return;
    }
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = href;
    link.download = `${eventSlug.trim()}-scoring-export.json`;
    link.click();
    URL.revokeObjectURL(href);
    onStatus("Scoring export downloaded.");
  }

  return (
    <section aria-labelledby="event-scoring-heading" className="border-t theme-border pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            event scoring
          </p>
          <h3 id="event-scoring-heading" className="mt-2 font-serif text-2xl font-semibold">
            {selectedEvent ? `Scoring · ${selectedEvent.title}` : "Event scoring"}
          </h3>
          <p className="mt-2 max-w-xl font-mono text-xs leading-relaxed theme-muted">
            Start, freeze, and review one event without exposing participant identifiers or raw
            staff credentials.
          </p>
        </div>
        <div className="w-full sm:w-72">
          <label className="mb-1 block font-mono text-micro theme-muted" htmlFor="scoring-event">
            event
          </label>
          <AppSelect
            id="scoring-event"
            value={eventSlug}
            options={eventOptions}
            onValueChange={(value) => {
              setData(null);
              setLoadError(null);
              setEventSlug(value);
            }}
            disabled={eventsLoading || events.length === 0}
            ariaLabel="Choose event for scoring"
            variant="field"
          />
        </div>
      </div>
      {loadError ? (
        <div className="mt-5 border-y theme-border py-4" role="alert">
          <p className="font-mono text-xs">
            <AdminStatus tone="danger">{loadError}</AdminStatus>
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="mt-3 min-h-11 font-mono text-xs underline underline-offset-4 hover:opacity-70 disabled:opacity-40"
          >
            try again
          </button>
        </div>
      ) : null}
      {busy && !data && !loadError ? (
        <p className="mt-5 font-mono text-xs theme-muted" role="status">
          Loading scoring controls…
        </p>
      ) : null}
      {data && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap items-center gap-3 border-y theme-border py-4">
            <span className="font-mono text-xs">
              state:{" "}
              <AdminStatus
                tone={
                  data.settings.state === "frozen"
                    ? "attention"
                    : adminToneForStatus(data.settings.state)
                }
                className="font-bold"
              >
                {data.settings.state}
              </AdminStatus>
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
              <span className="theme-muted">held items</span>
              <br />
              {data.held.length + data.heldOfficialResults.length}
            </p>
          </div>
          <div className="border-y theme-border py-4">
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              scoring workspace
            </p>
            <div
              className="mt-3 flex flex-wrap gap-x-5 gap-y-2"
              role="tablist"
              aria-label="Scoring tools"
            >
              {SCORING_WORKSPACES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={workspace === item.id}
                  aria-controls="scoring-workspace-panel"
                  onClick={() => setWorkspace(item.id)}
                  className={`min-h-11 border-b font-mono text-xs transition-opacity hover:opacity-70 ${
                    workspace === item.id
                      ? "theme-border-strong text-foreground"
                      : "border-transparent theme-muted"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-micro theme-muted">
              {SCORING_WORKSPACES.find((item) => item.id === workspace)?.description}
            </p>
          </div>

          <div id="scoring-workspace-panel" role="tabpanel" className="space-y-5">
            {workspace === "setup" ? (
              <>
                <ScoringActivitiesPanel
                  activities={data.activities}
                  personalTemplates={data.personalTemplates}
                  onAction={performAction}
                />
                <ScoringLifecyclePanel data={data} onAction={performAction} />
              </>
            ) : null}
            {workspace === "content" ? (
              <>
                <ScoringDiscoveriesPanel
                  activities={data.activities}
                  discoveries={data.discoveries}
                  onAction={performAction}
                />
                <ScoringPrintStudioPanel
                  discoveryCount={data.discoveries.length}
                  onDownload={downloadPrint}
                />
              </>
            ) : null}
            {workspace === "live" ? (
              <>
                <ScoringTestModePanel data={data} />
                <ScoringOperationsPanel operations={data.operations} />
              </>
            ) : null}
            {workspace === "media" ? (
              <ScoringMediaPanel data={data} onAction={performAction} />
            ) : null}
            {workspace === "review" ? (
              <>
                <ScoringAuditPanel
                  audit={data.audit}
                  anomalies={data.anomalies}
                  activities={data.activities}
                  onFilter={async (filter) => load(false, filter)}
                  onExport={downloadExport}
                />
                <ScoringCorrectionsPanel
                  eventSlug={eventSlug.trim()}
                  state={data.settings.state}
                  activities={data.activities}
                  authFetch={authFetch}
                  onAction={performAction}
                />
              </>
            ) : null}
            {workspace === "people" ? (
              <>
                <ScoringIdentityPanel merges={data.merges} onAction={performAction} />
                <ScoringTeamsPanel
                  eventSlug={eventSlug.trim()}
                  teams={data.teams}
                  teamRoster={data.teamRoster}
                  authFetch={authFetch}
                  onAction={performAction}
                />
                <ScoringStaffPanel
                  eventSlug={eventSlug.trim()}
                  activities={data.activities}
                  checkpoints={data.checkpoints}
                  roles={data.staffRoles}
                  staff={data.staff}
                  onAction={performAction}
                />
              </>
            ) : null}
            {workspace === "pools" ? (
              <ScoringPoolsPanel pools={data.pools} onAction={performAction} />
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
