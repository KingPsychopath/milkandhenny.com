import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { StatusNotice } from "@/components/StatusNotice";
import type { ScoreActivity } from "../types";
import { StaffParticipantLookup } from "./StaffParticipantLookup";
import { StaffQuickAwardQr } from "./StaffQuickAwardQr";
import type { PageData, StaffScoringController } from "./useStaffScoringController";

function configuredPoints(activity: ScoreActivity) {
  return activity.rule.mode === "participation"
    ? (activity.rule.participationPoints ?? 0)
    : (activity.rule.fixedPoints ?? 0);
}

function awardRuleSummary(activity: ScoreActivity) {
  const repeat =
    activity.rule.repeat === "once"
      ? "once per person"
      : activity.rule.repeat === "once-per-source"
        ? "once per result"
        : "repeatable";
  return `${repeat} · ${activity.rule.requiresCheckIn ? "check-in required" : "works before check-in"}`;
}

export function StaffAwardPanel({
  data,
  token,
  controller,
}: {
  data: PageData;
  token: string;
  controller: StaffScoringController;
}) {
  const [mode, setMode] = useState<"person" | "qr">("person");
  const {
    activityId,
    setActivityId,
    participant,
    placement,
    setPlacement,
    rawScore,
    setRawScore,
    note,
    setNote,
    customPoints,
    setCustomPoints,
    status,
    error,
    setError,
    busy,
    needsConfirmation,
    setNeedsConfirmation,
    reviewReady,
    setReviewReady,
    confirmedRemaining,
    setConfirmedRemaining,
    mediaRef,
    setMediaRef,
    mediaUploading,
    captureMedia,
    mediaVisibility,
    setMediaVisibility,
    mediaConsent,
    setMediaConsent,
    offlineReservation,
    offlineCommands,
    offlinePreparing,
    offlineMessage,
    activity,
    pool,
    previewPoints,
    quickActivities,
    award,
  } = controller;
  const detailedActivities = data.activities.filter(
    (entry) => entry.rule.mode !== "fixed" && entry.rule.mode !== "participation",
  );

  return (
    <section aria-labelledby="award-heading" className="mt-8">
      <div className="border-b theme-border pb-5">
        <p className="font-mono text-micro uppercase tracking-widest text-[var(--prose-hashtag)]">
          points
        </p>
        <h2 id="award-heading" className="mt-2 font-serif text-3xl">
          Give points
        </h2>
        <p className="mt-2 max-w-xl font-mono text-xs theme-muted">
          Find one person for a direct award, or show a one-use QR when a crowd is moving quickly.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2" aria-label="How to give points">
        <button
          type="button"
          aria-pressed={mode === "person"}
          onClick={() => setMode("person")}
          className={`mh-action ${mode === "person" ? "mh-action--primary" : "mh-action--secondary"}`}
        >
          find a person
        </button>
        <button
          type="button"
          aria-pressed={mode === "qr"}
          onClick={() => setMode("qr")}
          className={`mh-action ${mode === "qr" ? "mh-action--primary" : "mh-action--secondary"}`}
        >
          show a QR
        </button>
      </div>

      {mode === "qr" ? (
        <StaffQuickAwardQr data={data} token={token} />
      ) : (
        <div className="mt-7 space-y-6">
          <StaffParticipantLookup data={data} token={token} controller={controller} />

          {participant && quickActivities.length > 0 ? (
            <section aria-labelledby="quick-awards-heading">
              <h3 id="quick-awards-heading" className="font-serif text-xl">
                Quick awards
              </h3>
              <p className="mt-1 font-mono text-xs theme-muted">
                These values and repeat rules were set by the organiser. Tap once to apply.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {quickActivities.map((entry, index) => {
                  const points = configuredPoints(entry);
                  const confirming = needsConfirmation && activityId === entry.id;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={busy || points < 1}
                      onClick={() => void award(confirming, entry.id)}
                      className={`mh-action min-h-16 justify-between text-left disabled:opacity-50 ${index === 0 ? "mh-action--primary" : "mh-action--secondary"}`}
                    >
                      <span>
                        <span className="block font-serif text-lg">
                          {confirming ? "Confirm " : ""}
                          {entry.name}
                        </span>
                        <span className="mt-1 block font-mono text-micro opacity-70">
                          {awardRuleSummary(entry)}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-sm">+{points}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {participant &&
          (detailedActivities.length > 0 || data.canFreeform || data.canUploadMedia) ? (
            <details className="border-y theme-border py-1">
              <summary className="flex min-h-12 cursor-pointer items-center font-mono text-xs underline">
                more scoring options
              </summary>
              <div className="space-y-5 pb-5 pt-3">
                <label className="block font-mono text-xs">
                  award type
                  <AppSelect
                    value={activityId}
                    onValueChange={(value) => {
                      setActivityId(value);
                      setReviewReady(false);
                      setNeedsConfirmation(false);
                      setConfirmedRemaining(undefined);
                    }}
                    options={data.activities.map((entry) => ({
                      value: entry.id,
                      label: `${entry.name} — ${awardRuleSummary(entry)}`,
                    }))}
                    variant="field"
                    ariaLabel="Award type"
                    className="mt-2"
                  />
                </label>

                {activity?.rule.mode === "placement" || activity?.rule.mode === "diminishing" ? (
                  <label className="block font-mono text-xs">
                    finishing place
                    <input
                      type="number"
                      min={1}
                      value={placement}
                      onChange={(event) => {
                        setPlacement(Number(event.target.value));
                        setReviewReady(false);
                      }}
                      className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                    />
                  </label>
                ) : null}

                {activity?.rule.mode === "raw-normalized" ? (
                  <label className="block font-mono text-xs">
                    game result
                    <input
                      type="number"
                      min={0}
                      value={rawScore}
                      onChange={(event) => {
                        setRawScore(Number(event.target.value));
                        setReviewReady(false);
                      }}
                      className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                    />
                  </label>
                ) : null}

                <label className="block font-mono text-xs">
                  {activity?.template === "free-form" ? "reason (required)" : "note (optional)"}
                  <input
                    required={activity?.template === "free-form"}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                  />
                </label>

                {data.canFreeform ? (
                  <div className="border-t theme-border pt-4">
                    <p className="font-mono text-xs">custom amount</p>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <label className="sr-only" htmlFor="staff-custom-points">
                        Custom points per ticket
                      </label>
                      <input
                        id="staff-custom-points"
                        type="number"
                        min={1}
                        max={data.maxPointsPerAward}
                        step={1}
                        value={customPoints}
                        onChange={(event) => setCustomPoints(Number(event.target.value))}
                        className="min-h-11 border theme-border bg-transparent px-3 font-mono"
                      />
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !Number.isInteger(customPoints) ||
                          customPoints < 1 ||
                          customPoints > data.maxPointsPerAward ||
                          !note.trim()
                        }
                        onClick={() => void award(needsConfirmation, activityId, customPoints)}
                        className="mh-action mh-action--secondary disabled:opacity-50"
                      >
                        give custom
                      </button>
                    </div>
                    <p className="mt-2 font-mono text-micro theme-muted">
                      A reason is required. Maximum {data.maxPointsPerAward} points per person.
                    </p>
                  </div>
                ) : null}

                {data.canUploadMedia ? (
                  <details className="border-t theme-border pt-2">
                    <summary className="flex min-h-11 cursor-pointer items-center font-mono text-xs underline">
                      attach a photograph
                    </summary>
                    <div className="space-y-3 pb-2 pt-2">
                      <p className="font-mono text-xs theme-muted">
                        Consent: {data.photoConsentPolicy.replaceAll("-", " ")}. The score saves
                        first, so an upload problem cannot duplicate it.
                      </p>
                      <label className="block font-mono text-xs">
                        take or choose photograph
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          disabled={mediaUploading || !data.mediaDrop?.uploadPath}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void captureMedia(file);
                            event.target.value = "";
                          }}
                          className="mt-2 block min-h-11 w-full font-mono text-xs file:mr-3 file:min-h-11 file:border file:theme-border file:bg-background file:px-3"
                        />
                      </label>
                      <label className="block font-mono text-xs">
                        stored media reference
                        <input
                          value={mediaRef}
                          onChange={(event) => setMediaRef(event.target.value)}
                          className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="font-mono text-xs">
                          visibility
                          <AppSelect
                            value={mediaVisibility}
                            onValueChange={(value) =>
                              setMediaVisibility(value as typeof mediaVisibility)
                            }
                            options={[
                              { value: "event-album", label: "event album" },
                              { value: "admin-evidence", label: "admin evidence" },
                              { value: "discard", label: "discard" },
                            ]}
                            variant="field"
                            ariaLabel="Media visibility"
                            className="mt-2"
                          />
                        </label>
                        <label className="font-mono text-xs">
                          consent
                          <AppSelect
                            value={mediaConsent}
                            onValueChange={(value) => setMediaConsent(value as typeof mediaConsent)}
                            options={[
                              { value: "not-requested", label: "not requested" },
                              { value: "requested", label: "requested" },
                              { value: "obtained", label: "obtained" },
                              { value: "declined", label: "declined" },
                            ]}
                            variant="field"
                            ariaLabel="Media consent"
                            className="mt-2"
                          />
                        </label>
                      </div>
                    </div>
                  </details>
                ) : null}

                {reviewReady ? (
                  <div className="border-y theme-border py-4" aria-live="polite">
                    <p className="font-serif text-lg">
                      {activity?.name} · +{previewPoints} points
                    </p>
                    <p className="mt-1 font-mono text-xs theme-muted">
                      {participant.balance} current
                      {pool
                        ? ` · ${confirmedRemaining ?? pool.available} confirmed pool points left`
                        : ""}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!reviewReady) {
                      setError("");
                      setReviewReady(true);
                      return;
                    }
                    void award(needsConfirmation);
                  }}
                  className="mh-action mh-action--primary disabled:opacity-50"
                >
                  {needsConfirmation
                    ? "confirm this award"
                    : reviewReady
                      ? "give points"
                      : "review result"}
                </button>
              </div>
            </details>
          ) : null}

          {error ? (
            <StatusNotice tone="danger" label="Check this award">
              {error}
            </StatusNotice>
          ) : null}
          {status ? (
            <StatusNotice tone="positive" label="Done">
              {status}
            </StatusNotice>
          ) : null}

          <div className="flex items-center gap-2 border-t theme-border pt-4 font-mono text-micro theme-muted">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${offlineReservation?.activityId === activityId ? "bg-[var(--status-positive)]" : "bg-[var(--stone-400)]"}`}
            />
            <span>
              {offlinePreparing
                ? "Preparing offline fallback…"
                : offlineReservation?.activityId === activityId
                  ? `${offlineMessage || "Offline fallback ready"} · ${offlineReservation.points - offlineReservation.spent} protected points${offlineCommands.length ? ` · ${offlineCommands.length} waiting to sync` : ""}`
                  : offlineMessage || "Online scoring ready"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
