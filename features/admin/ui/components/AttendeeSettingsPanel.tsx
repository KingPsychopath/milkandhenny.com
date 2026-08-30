import { useCallback, useEffect, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { ATTENDEE_CAPABILITIES, type CapabilityMap } from "@/features/attendee-operations/types";
import { AdminAccessSettings } from "./AdminAccessSettings";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;
type SettingsResponse = {
  global: {
    globalAvailability: CapabilityMap;
    newEventDefaults: CapabilityMap;
    emergencyPaused: CapabilityMap;
    revision: number;
  };
  impact: Record<(typeof ATTENDEE_CAPABILITIES)[number], number>;
  events: Array<{
    slug: string;
    title: string;
    status: string;
    policy: {
      capabilities: CapabilityMap;
      transferOpensAt?: string;
      transferClosesAt?: string;
      policyVersion: number;
    };
    effective: CapabilityMap;
  }>;
};

const LABELS: Record<(typeof ATTENDEE_CAPABILITIES)[number], string> = {
  scoring: "scoring",
  publicLeaderboard: "public leaderboard",
  manualStaffAwards: "manual staff awards",
  discoveries: "clues and discoveries",
  guestPhotos: "guest photos",
  transfers: "ticket transfers",
  onwardTransfers: "onward transfers",
  complimentaryTransfers: "complimentary-ticket transfers",
};

export function AttendeeSettingsPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<{ ok: true; token: string } | { ok: false }>;
  withStepUpHeaders: (token: string, headers?: Record<string, string>) => Record<string, string>;
}) {
  const [data, setData] = useState<SettingsResponse>();
  const [eventSlug, setEventSlug] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [transferOpensAt, setTransferOpensAt] = useState("");
  const [transferClosesAt, setTransferClosesAt] = useState("");
  const [bulkEventSlugs, setBulkEventSlugs] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await authFetch("/api/admin/operations/settings");
      const body = (await response.json().catch(() => ({}))) as Partial<SettingsResponse> & {
        error?: string;
      };
      if (!response.ok || !body.global || !body.impact || !Array.isArray(body.events)) {
        throw new Error(body.error ?? "Access policies could not be loaded");
      }
      const settings = body as SettingsResponse;
      setData(settings);
      setEventSlug((current) => {
        const next = current || settings.events[0]?.slug || "";
        const policy = settings.events.find((event) => event.slug === next)?.policy;
        setTransferOpensAt(toLocalDateTime(policy?.transferOpensAt));
        setTransferClosesAt(toLocalDateTime(policy?.transferClosesAt));
        return next;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Access policies could not be loaded");
      throw error;
    }
  }, [authFetch]);

  useEffect(() => {
    void load().catch((error) =>
      onError(error instanceof Error ? error.message : "Access policies could not be loaded"),
    );
  }, [load, onError]);

  async function saveGlobal(
    section: "globalAvailability" | "newEventDefaults" | "emergencyPaused",
    values: CapabilityMap,
  ) {
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/settings", {
        method: "PATCH",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({ scope: "global", section, values, reason }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Global access policies could not be saved");
      onStatus("Global access policies saved.");
      setReason("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Global access policies could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function saveEvent(values: CapabilityMap) {
    const event = data?.events.find((item) => item.slug === eventSlug);
    if (!event) return;
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/settings", {
        method: "PATCH",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({
          scope: "event",
          eventSlug,
          capabilities: values,
          transferOpensAt: transferOpensAt ? new Date(transferOpensAt).toISOString() : null,
          transferClosesAt: transferClosesAt ? new Date(transferClosesAt).toISOString() : null,
          reason,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Event access policy could not be saved");
      onStatus(`${event.title} access policy saved.`);
      setReason("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Event access policy could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function saveBulk() {
    const event = data?.events.find((item) => item.slug === eventSlug);
    if (!event || bulkEventSlugs.length === 0) return;
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/settings", {
        method: "PATCH",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({
          scope: "event-bulk",
          eventSlugs: bulkEventSlugs,
          capabilities: event.policy.capabilities,
          transferOpensAt: event.policy.transferOpensAt ?? null,
          transferClosesAt: event.policy.transferClosesAt ?? null,
          reason,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Event access policies could not be applied");
      onStatus(`Access policies applied to ${bulkEventSlugs.length} events.`);
      setReason("");
      setBulkEventSlugs([]);
      await load();
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Event access policies could not be applied",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <div className="border-y theme-border py-5">
        <p className="font-mono text-xs" role={loadError ? "alert" : "status"}>
          <AdminStatus tone={loadError ? "danger" : "attention"}>
            {loadError ?? "loading access policies…"}
          </AdminStatus>
        </p>
        {loadError ? (
          <button
            type="button"
            onClick={() => void load().catch(() => undefined)}
            className="mt-3 inline-flex min-h-11 items-center font-mono text-xs underline"
          >
            retry
          </button>
        ) : null}
      </div>
    );
  const selectedEvent = data.events.find((event) => event.slug === eventSlug);
  const selectEvent = (nextSlug: string) => {
    setEventSlug(nextSlug);
    const policy = data.events.find((event) => event.slug === nextSlug)?.policy;
    setTransferOpensAt(toLocalDateTime(policy?.transferOpensAt));
    setTransferClosesAt(toLocalDateTime(policy?.transferClosesAt));
  };
  return (
    <section aria-labelledby="access-policies-heading">
      <h2 id="access-policies-heading" className="font-serif text-3xl">
        Access policies
      </h2>
      <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
        Global availability is the hard ceiling. New-event defaults are copied only when an event
        policy is first created. Existing events never switch on automatically.
      </p>
      <label htmlFor="settings-reason" className="mt-6 block font-mono text-xs">
        reason for sensitive changes
      </label>
      <input
        id="settings-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="mt-2 min-h-11 w-full max-w-xl border theme-border bg-background px-3 font-mono text-sm"
      />
      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <CapabilitySection
          title="global availability"
          values={data.global.globalAvailability}
          impact={data.impact}
          busy={busy}
          onSave={(values) => void saveGlobal("globalAvailability", values)}
        />
        <CapabilitySection
          title="new-event defaults"
          values={data.global.newEventDefaults}
          busy={busy}
          onSave={(values) => void saveGlobal("newEventDefaults", values)}
        />
        <CapabilitySection
          title="emergency pause"
          values={data.global.emergencyPaused}
          busy={busy}
          inverted
          busyLabel="pause controls"
          onSave={(values) => void saveGlobal("emergencyPaused", values)}
        />
      </div>
      <div className="mt-12 border-t theme-border pt-8">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="event-policy" className="block font-mono text-xs">
              event activation
            </label>
            <AppSelect
              id="event-policy"
              value={eventSlug}
              onValueChange={selectEvent}
              options={data.events.map((event) => ({
                value: event.slug,
                label: `${event.title} · ${event.status}`,
              }))}
              variant="field"
              className="mt-2"
            />
          </div>
          {selectedEvent ? (
            <p className="pb-3 font-mono text-micro theme-muted">
              <AdminStatus tone={adminToneForStatus(selectedEvent.status)}>
                {selectedEvent.status}
              </AdminStatus>{" "}
              · policy v{selectedEvent.policy.policyVersion}
            </p>
          ) : null}
        </div>
        {selectedEvent ? (
          <div className="mt-5 max-w-xl">
            <div className="mb-6 grid gap-4 sm:grid-cols-2">
              <label className="font-mono text-xs">
                transfer opens
                <input
                  type="datetime-local"
                  value={transferOpensAt}
                  onChange={(event) => setTransferOpensAt(event.target.value)}
                  className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
                />
              </label>
              <label className="font-mono text-xs">
                transfer closes
                <input
                  type="datetime-local"
                  value={transferClosesAt}
                  onChange={(event) => setTransferClosesAt(event.target.value)}
                  className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
                />
              </label>
            </div>
            <CapabilitySection
              title={selectedEvent.title}
              values={selectedEvent.policy.capabilities}
              effective={selectedEvent.effective}
              busy={busy}
              onSave={(values) => void saveEvent(values)}
            />
            <fieldset className="mt-8 border-y theme-border py-5">
              <legend className="font-serif text-xl">apply saved policy to selected events</legend>
              <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
                Copies {selectedEvent.title}&apos;s currently saved capabilities and transfer
                window. Every target records its own audit event.
              </p>
              <div className="mt-3 max-h-56 overflow-y-auto">
                {data.events
                  .filter((event) => event.slug !== selectedEvent.slug)
                  .map((event) => (
                    <label
                      key={event.slug}
                      className="flex min-h-11 items-center gap-3 font-mono text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={bulkEventSlugs.includes(event.slug)}
                        onChange={(change) =>
                          setBulkEventSlugs((current) =>
                            change.target.checked
                              ? [...current, event.slug]
                              : current.filter((slug) => slug !== event.slug),
                          )
                        }
                      />
                      {event.title} ·{" "}
                      <AdminStatus tone={adminToneForStatus(event.status)}>
                        {event.status}
                      </AdminStatus>
                    </label>
                  ))}
              </div>
              <button
                type="button"
                disabled={busy || bulkEventSlugs.length === 0}
                onClick={() => void saveBulk()}
                className="mt-4 min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
              >
                {busy ? "applying…" : `apply to ${bulkEventSlugs.length || "selected"}`}
              </button>
            </fieldset>
          </div>
        ) : null}
      </div>
      <AdminAccessSettings
        authFetch={authFetch}
        onError={onError}
        onStatus={onStatus}
        ensureStepUpToken={ensureStepUpToken}
        withStepUpHeaders={withStepUpHeaders}
      />
    </section>
  );
}

function toLocalDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function CapabilitySection({
  title,
  values,
  busy,
  onSave,
  effective,
  impact,
  inverted = false,
  busyLabel = "save settings",
}: {
  title: string;
  values: CapabilityMap;
  busy: boolean;
  onSave: (values: CapabilityMap) => void;
  effective?: CapabilityMap;
  impact?: Record<(typeof ATTENDEE_CAPABILITIES)[number], number>;
  inverted?: boolean;
  busyLabel?: string;
}) {
  const [draft, setDraft] = useState(values);
  useEffect(() => setDraft(values), [values]);
  return (
    <fieldset className="border-y theme-border py-5">
      <legend className="font-serif text-xl">{title}</legend>
      <div className="mt-3 space-y-2">
        {ATTENDEE_CAPABILITIES.map((capability) => (
          <label
            key={capability}
            className="flex min-h-11 items-center justify-between gap-4 font-mono text-xs"
          >
            <span className="flex min-w-0 items-center gap-2">
              {LABELS[capability]}
              {effective ? (
                <AdminStatus tone={effective[capability] ? "positive" : "neutral"}>
                  effective {effective[capability] ? "on" : "off"}
                </AdminStatus>
              ) : null}
              {impact?.[capability] ? (
                <span className="ml-2 theme-muted">· {impact[capability]} event policies</span>
              ) : null}
            </span>
            <AdminStatus
              tone={
                inverted
                  ? draft[capability]
                    ? "attention"
                    : "positive"
                  : draft[capability]
                    ? "positive"
                    : "neutral"
              }
              className="ml-auto shrink-0"
            >
              {inverted
                ? draft[capability]
                  ? "paused"
                  : "available"
                : draft[capability]
                  ? "enabled"
                  : "off"}
            </AdminStatus>
            <input
              type="checkbox"
              checked={draft[capability]}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [capability]: event.target.checked }))
              }
              aria-label={`${inverted ? "pause" : "enable"} ${LABELS[capability]}`}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSave(draft)}
        className="mt-4 min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
      >
        {busy ? "saving…" : busyLabel}
      </button>
    </fieldset>
  );
}
