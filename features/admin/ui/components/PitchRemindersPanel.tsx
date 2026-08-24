"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PITCH_REMINDER_TEMPLATES,
  type PitchReminderAdminSnapshot,
  type PitchReminderTemplate,
} from "@/features/things/pitches/types";
import { useActionDialog } from "@/hooks/useActionDialog";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

const TEMPLATE_LABELS: Record<PitchReminderTemplate, string> = {
  resume: "pick it back up",
  finish: "finish soon",
  final: "last nudge",
};

function when(value: string | null): string {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PitchRemindersPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<PitchReminderAdminSnapshot>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState<PitchReminderTemplate>("resume");
  const [settingsDraft, setSettingsDraft] = useState({
    enabled: false,
    inactivityDays: 10,
    gapDays: 14,
    maxAutomatic: 3,
  });
  const { confirm, dialog } = useActionDialog();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/pitches?view=reminders");
      if (!response.ok) throw new Error("Could not load pitch reminders");
      const body = (await response.json()) as { reminders?: PitchReminderAdminSnapshot };
      if (!body.reminders) throw new Error("Pitch reminder status was incomplete");
      setSnapshot(body.reminders);
      setSettingsDraft({
        enabled: body.reminders.settings.enabled,
        inactivityDays: body.reminders.settings.inactivityDays,
        gapDays: body.reminders.settings.gapDays,
        maxAutomatic: body.reminders.settings.maxAutomatic,
      });
      setSelected((current) => {
        const available = new Set(body.reminders?.candidates.map((candidate) => candidate.id));
        return new Set([...current].filter((id) => available.has(id)));
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load pitch reminders");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedCandidates = useMemo(
    () => snapshot?.candidates.filter((candidate) => selected.has(candidate.id)) ?? [],
    [selected, snapshot],
  );

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectCandidates(kind: "ready" | "all") {
    if (!snapshot) return;
    const candidates =
      kind === "ready"
        ? snapshot.candidates.filter((candidate) => candidate.automaticEligible)
        : snapshot.candidates;
    setSelected(new Set(candidates.map((candidate) => candidate.id)));
  }

  async function saveSettings() {
    setBusy("settings");
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-reminder-settings", ...settingsDraft }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        reminders?: PitchReminderAdminSnapshot;
      };
      if (!response.ok || !body.reminders) {
        throw new Error(body.error ?? "Could not save reminder settings");
      }
      setSnapshot(body.reminders);
      onStatus(
        body.reminders.settings.enabled
          ? "Automatic pitch nudges are on."
          : "Automatic pitch nudges are off.",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save reminder settings");
    } finally {
      setBusy("");
    }
  }

  async function sendSelected() {
    if (selectedCandidates.length === 0) return;
    const confirmed = await confirm({
      eyebrow: "pitch nudges",
      title: `Send ${TEMPLATE_LABELS[template]} message?`,
      description: `This will queue a ${TEMPLATE_LABELS[template]} message for ${selectedCandidates.length} selected ${selectedCandidates.length === 1 ? "pitch" : "pitches"}.`,
      confirmLabel: "queue messages",
    });
    if (!confirmed) return;
    setBusy("send");
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send-reminder-wave",
          deckIds: selectedCandidates.map((candidate) => candidate.id),
          template,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        result?: { queuedEmails: number; sentDecks: number; failedDecks: number };
      };
      if (!response.ok || !body.result) {
        throw new Error(body.error ?? "Could not queue pitch nudges");
      }
      setSelected(new Set());
      onStatus(
        `Queued ${body.result.queuedEmails} email${body.result.queuedEmails === 1 ? "" : "s"} for ${body.result.sentDecks} pitch${body.result.sentDecks === 1 ? "" : "es"}.${body.result.failedDecks ? ` ${body.result.failedDecks} failed.` : ""}`,
      );
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not queue pitch nudges");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="border-y theme-border py-6" aria-labelledby="pitch-reminders-heading">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
            pitch nudges
          </p>
          <h3 id="pitch-reminders-heading" className="mt-1 font-serif text-2xl text-foreground">
            Gentle reminders for unfinished pitches
          </h3>
          <p className="mt-2 max-w-2xl font-mono text-micro leading-relaxed theme-muted">
            Automatic messages wait for inactivity, stop after publishing, and group pitches sent to
            the same person.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="font-mono text-xs theme-muted hover:opacity-70 disabled:opacity-40"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </div>

      <div className="mt-6 grid gap-6 border-y theme-border-faint py-5 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs">
            <span className={snapshot?.settings.enabled ? "text-foreground" : "theme-muted"}>
              automatic nudges {snapshot?.settings.enabled ? "on" : "off"}
            </span>
            <span className="theme-faint">·</span>
            <span className="theme-muted">
              {snapshot?.eligibleCount ?? 0} ready for the next daily run
            </span>
          </div>
          <p className="mt-2 font-mono text-micro theme-muted">
            {snapshot?.nextEligibleAt
              ? `next eligible pitch ${when(snapshot.nextEligibleAt)}; the daily maintenance run sends it when automatic nudges are on`
              : "no unfinished pitch is currently due for an automatic nudge"}
          </p>
        </div>
        <div className="font-mono text-micro theme-muted lg:text-right">
          <p>last run {when(snapshot?.settings.lastRunAt ?? null)}</p>
          <p className="mt-1">{snapshot?.candidates.length ?? 0} active unfinished pitches</p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4 md:items-end">
        <label className="flex min-h-11 items-center gap-3 border-b theme-border px-1 font-mono text-xs">
          <input
            type="checkbox"
            checked={settingsDraft.enabled}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, enabled: event.target.checked }))
            }
            className="size-4 accent-[var(--prose-hashtag)]"
          />
          enable automatic nudges
        </label>
        <label className="font-mono text-micro theme-muted">
          wait after inactivity
          <select
            value={settingsDraft.inactivityDays}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                inactivityDays: Number(event.target.value),
              }))
            }
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3 text-xs text-foreground"
          >
            {[7, 10, 14, 21, 30].map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-micro theme-muted">
          gap between nudges
          <select
            value={settingsDraft.gapDays}
            onChange={(event) =>
              setSettingsDraft((current) => ({ ...current, gapDays: Number(event.target.value) }))
            }
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3 text-xs text-foreground"
          >
            {[14, 21, 30, 45].map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-micro theme-muted">
          automatic limit per pitch
          <select
            value={settingsDraft.maxAutomatic}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                maxAutomatic: Number(event.target.value),
              }))
            }
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3 text-xs text-foreground"
          >
            {[1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "nudge" : "nudges"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={busy === "settings"}
          className="min-h-11 bg-foreground px-5 font-mono text-xs text-background hover:opacity-80 disabled:opacity-40"
        >
          {busy === "settings" ? "saving…" : "save reminder settings"}
        </button>
      </div>

      <div className="mt-8 border-t theme-border-faint pt-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
              manual wave
            </p>
            <p className="mt-1 font-mono text-xs theme-muted">
              Choose any active unfinished pitches, even if they are not due automatically.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="font-mono text-micro theme-muted">
              message
              <select
                value={template}
                onChange={(event) => setTemplate(event.target.value as PitchReminderTemplate)}
                className="mt-2 min-h-11 border theme-border bg-background px-3 text-xs text-foreground"
              >
                {PITCH_REMINDER_TEMPLATES.map((value) => (
                  <option key={value} value={value}>
                    {TEMPLATE_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => selectCandidates("ready")}
              className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70"
            >
              select ready
            </button>
            <button
              type="button"
              onClick={() => selectCandidates("all")}
              className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70"
            >
              select all
            </button>
            <button
              type="button"
              onClick={() => void sendSelected()}
              disabled={busy === "send" || selectedCandidates.length === 0}
              className="min-h-11 bg-foreground px-4 font-mono text-xs text-background hover:opacity-80 disabled:opacity-40"
            >
              {busy === "send" ? "queueing…" : `send selected · ${selectedCandidates.length}`}
            </button>
          </div>
        </div>

        <div className="mt-5 divide-y theme-border border-y">
          {(snapshot?.candidates ?? []).map((candidate) => (
            <label
              key={candidate.id}
              className="flex cursor-pointer items-start gap-3 py-4 hover:opacity-70"
            >
              <input
                type="checkbox"
                checked={selected.has(candidate.id)}
                onChange={() => toggleSelected(candidate.id)}
                aria-label={`Select ${candidate.title}`}
                className="mt-1 size-4 accent-[var(--prose-hashtag)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif text-lg text-foreground">
                  {candidate.title}
                </span>
                <span className="mt-1 block font-mono text-micro theme-muted">
                  {candidate.ownerName} · {candidate.ownerEmail} · {candidate.slideCount}{" "}
                  {candidate.slideCount === 1 ? "slide" : "slides"} · last edited{" "}
                  {when(candidate.updatedAt)}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-micro theme-muted">
                <span className={candidate.automaticEligible ? "block text-foreground" : "block"}>
                  {candidate.automaticEligible
                    ? "ready automatically"
                    : candidate.automaticCount >= (snapshot?.settings.maxAutomatic ?? 3)
                      ? "automatic limit reached"
                      : `next ${when(candidate.nextEligibleAt)}`}
                </span>
                <span className="mt-1 block">last nudge {when(candidate.lastSentAt)}</span>
              </span>
            </label>
          ))}
          {!loading && snapshot?.candidates.length === 0 ? (
            <p className="py-5 font-mono text-xs theme-muted">
              No active unfinished pitches need attention.
            </p>
          ) : null}
        </div>
      </div>

      {snapshot?.recent.length ? (
        <div className="mt-8 border-t theme-border-faint pt-6">
          <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
            recent reminder activity
          </p>
          <div className="mt-3 divide-y theme-border border-y">
            {snapshot.recent.slice(0, 8).map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 py-3 font-mono text-micro"
              >
                <span
                  className={
                    item.action === "failed" ? "text-[var(--prose-hashtag)]" : "theme-muted"
                  }
                >
                  {item.action} · {item.title} · {item.ownerEmail}
                </span>
                <span className="theme-faint">
                  {item.template ? TEMPLATE_LABELS[item.template] : ""} · {when(item.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
