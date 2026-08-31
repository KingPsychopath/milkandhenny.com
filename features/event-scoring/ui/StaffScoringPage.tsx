import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { StatusNotice } from "@/components/StatusNotice";
import { CameraFeed } from "@/features/tickets/ui/CameraFeed";
import { searchStaffParticipantsFn } from "../staff-scoring.functions";
import {
  useStaffScoringController,
  type PageData,
  type Participant,
} from "./useStaffScoringController";
import { StaffQuickAwardQr } from "./StaffQuickAwardQr";
import { StaffTeamsPanel } from "./StaffTeamsPanel";

export function StaffScoringPage({ data, token }: { data: PageData; token: string }) {
  const {
    activityId,
    setActivityId,
    query,
    setQuery,
    results,
    setResults,
    participant,
    setParticipant,
    recipientScope,
    setRecipientScope,
    scanned,
    setScanned,
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
    cameraOpen,
    setCameraOpen,
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
    operation,
    setOperation,
    recentAwards,
    offlineReservation,
    offlineCommands,
    guestName,
    setGuestName,
    guestNote,
    setGuestNote,
    guestRequests,
    heldActions,
    transferFrom,
    setTransferFrom,
    transferTo,
    setTransferTo,
    transferPointsValue,
    setTransferPointsValue,
    transferNote,
    setTransferNote,
    activity,
    pool,
    previewPoints,
    quickActivities,
    search,
    award,
    prepareOffline,
    resolveScan,
    admit,
    reverse,
    submitGuest,
    decideGuest,
    transfer,
    acceptHeld,
  } = useStaffScoringController(data, token);

  async function selectRecentParticipant(entry: Participant) {
    const matches = await searchStaffParticipantsFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        term: entry.ticketSuffix ?? entry.displayName ?? entry.publicAlias,
      },
    });
    setParticipant(matches.find((match) => match.id === entry.id) ?? entry);
    setRecipientScope("participant");
    setResults([]);
    setReviewReady(false);
  }

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-10">
      <header>
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">staff scoring</p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">{data.eventTitle}</h1>
        <p className="mt-2 font-mono text-xs theme-muted">{data.label}</p>
      </header>

      {(data.canAdmit || data.canAward || data.canManageTeams) && (
        <nav
          aria-label="Staff operation"
          className="mt-8 flex flex-wrap gap-3 border-y theme-border py-3"
        >
          {data.canAdmit && (
            <button
              type="button"
              onClick={() => setOperation("admit")}
              aria-pressed={operation === "admit"}
              className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
            >
              Admit guests
            </button>
          )}
          {data.canRun && data.canAward && (
            <button
              type="button"
              onClick={() => setOperation("run")}
              aria-pressed={operation === "run"}
              className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
            >
              Choose activity
            </button>
          )}
          {data.canAward && (
            <button
              type="button"
              onClick={() => setOperation("award")}
              aria-pressed={operation === "award"}
              className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
            >
              Award points
            </button>
          )}
          {data.canManageTeams && (
            <button
              type="button"
              onClick={() => setOperation("teams")}
              aria-pressed={operation === "teams"}
              className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
            >
              Teams
            </button>
          )}
        </nav>
      )}

      {operation === "teams" && data.canManageTeams ? (
        <StaffTeamsPanel data={data} token={token} />
      ) : null}

      {operation === "run" && data.canRun && data.canAward && (
        <section aria-labelledby="run-heading" className="mt-10 border-t theme-border pt-7">
          <h2 id="run-heading" className="font-serif text-2xl">
            Choose an activity result
          </h2>
          <p className="mt-2 font-mono text-xs theme-muted">
            This page records a completed result; it does not launch the game. Start the game from
            its game-night QR or organiser page, then choose the matching activity here.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[...data.activities]
              .sort(
                (left, right) =>
                  Number(data.pinnedActivityIds.includes(right.id)) -
                  Number(data.pinnedActivityIds.includes(left.id)),
              )
              .map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setActivityId(entry.id);
                    setOperation("award");
                    setReviewReady(false);
                  }}
                  className="min-h-14 border theme-border px-4 py-3 text-left hover:opacity-70"
                >
                  <span className="block font-serif text-lg">{entry.name}</span>
                  <span className="mt-1 block font-mono text-micro theme-muted">
                    {data.pinnedActivityIds.includes(entry.id) ? "pinned result" : "record result"}
                  </span>
                </button>
              ))}
          </div>
        </section>
      )}

      {data.canAdmit && operation === "admit" && (
        <section aria-labelledby="admit-heading" className="mt-10 border-t theme-border pt-7">
          <h2 id="admit-heading" className="font-serif text-2xl">
            Scan and admit
          </h2>
          <p className="mt-2 font-mono text-xs theme-muted">
            This action admits one ticket. It does not award an unrelated activity.
          </p>
          <div className="mt-5 flex gap-2">
            <label htmlFor="staff-admit-ticket" className="sr-only">
              Ticket code
            </label>
            <input
              id="staff-admit-ticket"
              value={scanned}
              onChange={(event) => setScanned(event.target.value)}
              className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void admit()}
              className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
            >
              admit ticket
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCameraOpen((value) => !value)}
            className="mt-3 min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
          >
            {cameraOpen ? "close camera" : "scan with camera"}
          </button>
          {cameraOpen && (
            <div className="mt-3 max-w-sm">
              <CameraFeed
                paused={busy}
                onCode={(raw) => {
                  setScanned(raw);
                  void admit(raw);
                }}
              />
            </div>
          )}
          {error && (
            <StatusNotice tone="danger" label="Could not admit" className="mt-4">
              {error}
            </StatusNotice>
          )}
          {status && (
            <StatusNotice tone="positive" label="Admission confirmed" className="mt-4">
              {status}
            </StatusNotice>
          )}
        </section>
      )}

      {operation === "award" &&
        (!data.canAward ? (
          <p className="mt-10 border-y theme-border py-6 font-serif text-lg">
            This staff link has no scoring actions.
          </p>
        ) : data.activities.length === 0 ? (
          <p className="mt-10 border-y theme-border py-6 font-serif text-lg">
            No assigned activity is accepting results.
          </p>
        ) : (
          <section aria-labelledby="award-heading" className="mt-10 border-t theme-border pt-7">
            <h2 id="award-heading" className="font-serif text-2xl">
              Award points
            </h2>
            <StaffQuickAwardQr data={data} token={token} />
            <div className="mt-6 space-y-6">
              <label className="block font-mono text-xs">
                activity
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
                    label: entry.name,
                  }))}
                  variant="field"
                  ariaLabel="Scoring activity"
                  className="mt-2"
                />
              </label>

              {data.canUploadMedia && (
                <fieldset className="space-y-3 border-t theme-border pt-5">
                  <legend className="font-serif text-lg">Optional photograph</legend>
                  <p className="font-mono text-xs theme-muted">
                    Consent policy: {data.photoConsentPolicy.replaceAll("-", " ")}. The score saves
                    first. A media problem cannot repeat or remove it.
                  </p>
                  {data.mediaDrop ? (
                    <p className="font-mono text-xs">
                      Album expires {new Date(data.mediaDrop.expiresAt).toLocaleString()}.
                      {data.mediaDrop.uploadPath && (
                        <>
                          {" "}
                          <a
                            href={data.mediaDrop.uploadPath}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            upload a new file
                          </a>
                        </>
                      )}{" "}
                      <a
                        href={data.mediaDrop.albumPath}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        choose an existing file
                      </a>
                    </p>
                  ) : (
                    <p className="font-mono text-xs theme-muted">No event album is available.</p>
                  )}
                  <label className="block font-mono text-xs">
                    take or choose a photograph
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
                    {mediaUploading ? (
                      <span className="mt-1 block theme-muted">uploading photograph…</span>
                    ) : null}
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
                </fieldset>
              )}

              {(activity?.rule.mode === "placement" || activity?.rule.mode === "diminishing") && (
                <label className="block font-mono text-xs">
                  place
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
              )}

              {activity?.rule.mode === "raw-normalized" && (
                <label className="block font-mono text-xs">
                  result
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
              )}

              <div>
                <p className="font-mono text-xs">find participant</p>
                {data.recentParticipants.length > 0 && (
                  <div
                    className="mt-2 flex gap-2 overflow-x-auto pb-1"
                    aria-label="Recent participants"
                  >
                    {data.recentParticipants.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => void selectRecentParticipant(entry)}
                        className="min-h-11 shrink-0 border theme-border px-3 text-left hover:opacity-70"
                      >
                        <span className="block font-serif">
                          {entry.displayName ?? entry.publicAlias}
                        </span>
                        <span className="font-mono text-micro theme-muted">
                          recent {entry.recentReason}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void search();
                  }}
                >
                  <label htmlFor="staff-participant-search" className="sr-only">
                    Name, alias, or ticket suffix
                  </label>
                  <input
                    id="staff-participant-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="name, alias, or ticket suffix"
                    className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3 font-mono text-xs"
                  />
                  <button
                    disabled={busy}
                    className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                  >
                    search
                  </button>
                </form>
                {results.length > 0 && (
                  <ul className="mt-2 divide-y theme-border border-y theme-border">
                    {results.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setParticipant(entry);
                            setRecipientScope("participant");
                            setResults([]);
                            setScanned("");
                            setReviewReady(false);
                            setNeedsConfirmation(false);
                          }}
                          className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left hover:opacity-70"
                        >
                          <span className="font-serif">
                            {entry.displayName ?? entry.publicAlias}
                          </span>
                          <span className="font-mono text-micro theme-muted">
                            {entry.balance} points
                            {entry.ticketSuffix ? ` · ticket ${entry.ticketSuffix}` : ""}
                            {entry.teamName ? ` · ${entry.teamName}` : ""}
                            {entry.orderSize > 1 ? ` · ${entry.orderSize}-ticket order` : ""}
                            {entry.email ? ` · ${entry.email}` : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label htmlFor="staff-ticket-scan" className="block font-mono text-xs">
                  or paste a scanned ticket
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="staff-ticket-scan"
                    value={scanned}
                    onChange={(event) => {
                      setScanned(event.target.value);
                      setParticipant(null);
                      setReviewReady(false);
                    }}
                    className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveScan()}
                    className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                  >
                    use ticket
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setCameraOpen((current) => !current)}
                  className="mt-3 min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70"
                >
                  {cameraOpen ? "close camera" : "scan with camera"}
                </button>
                {cameraOpen && (
                  <div className="mt-3 max-w-sm">
                    <CameraFeed
                      paused={busy || participant !== null}
                      onCode={(raw) => {
                        setScanned(raw);
                        void resolveScan(raw);
                      }}
                    />
                  </div>
                )}
              </div>

              {participant && (
                <section
                  aria-labelledby="quick-award-heading"
                  className="border-y theme-border py-5"
                >
                  <h3 id="quick-award-heading" className="font-serif text-xl">
                    {participant.displayName ?? participant.publicAlias}
                  </h3>
                  <p className="mt-1 font-mono text-micro theme-muted">
                    ticket {participant.ticketSuffix ?? "selected"} · {participant.balance} points
                    {participant.orderSize > 1
                      ? ` · ${participant.orderPoints} across ${participant.orderSize} tickets`
                      : ""}
                  </p>
                  {participant.orderSize > 1 && (
                    <fieldset className="mt-4">
                      <legend className="font-mono text-xs">who receives it?</legend>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          aria-pressed={recipientScope === "participant"}
                          onClick={() => setRecipientScope("participant")}
                          className="min-h-14 border theme-border px-3 font-mono text-xs aria-pressed:border-foreground"
                        >
                          this ticket
                        </button>
                        <button
                          type="button"
                          aria-pressed={recipientScope === "order"}
                          onClick={() => setRecipientScope("order")}
                          className="min-h-14 border theme-border px-3 font-mono text-xs aria-pressed:border-foreground"
                        >
                          all {participant.orderSize} tickets
                        </button>
                      </div>
                    </fieldset>
                  )}
                  {quickActivities.length > 0 && (
                    <div className="mt-4">
                      <p className="font-mono text-xs">tap once to award</p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {quickActivities.map((entry) => {
                          const points =
                            entry.rule.mode === "participation"
                              ? (entry.rule.participationPoints ?? 0)
                              : (entry.rule.fixedPoints ?? 0);
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              disabled={busy || points < 1}
                              onClick={() => void award(false, entry.id)}
                              className="min-h-14 border theme-border px-4 py-3 text-left disabled:opacity-50"
                            >
                              <span className="block font-serif text-lg">{entry.name}</span>
                              <span className="font-mono text-micro theme-muted">
                                +{points} each
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {data.canFreeform && (
                    <div className="mt-5 border-t theme-border pt-4">
                      <p className="font-mono text-xs">custom award</p>
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <label className="sr-only" htmlFor="staff-custom-points">
                          Custom points per ticket
                        </label>
                        <input
                          id="staff-custom-points"
                          type="number"
                          min={1}
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
                            !note.trim()
                          }
                          onClick={() => void award(false, activityId, customPoints)}
                          className="min-h-11 border border-foreground px-4 font-mono text-xs disabled:opacity-50"
                        >
                          award custom
                        </button>
                      </div>
                      <p className="mt-2 font-mono text-micro theme-muted">
                        Add the reason in the note field below before awarding custom points.
                      </p>
                    </div>
                  )}
                </section>
              )}

              {participant && reviewReady && (
                <div className="border-y theme-border py-4" aria-live="polite">
                  <p className="font-serif text-lg">
                    {participant.displayName ?? participant.publicAlias}
                  </p>
                  <p className="mt-1 font-mono text-xs theme-muted">
                    {activity?.name} · {previewPoints} points · {participant.balance} current points
                    {pool
                      ? ` · ${confirmedRemaining ?? pool.available} confirmed pool points left`
                      : ""}
                  </p>
                </div>
              )}

              <label className="block font-mono text-xs">
                {activity?.template === "free-form"
                  ? "note (required for a free-form award)"
                  : "note (optional for configured outcomes)"}
                <input
                  required={activity?.template === "free-form"}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                />
              </label>

              {error && (
                <StatusNotice tone="danger" label="Action blocked">
                  {error}
                </StatusNotice>
              )}
              <div className="border-t theme-border pt-4">
                {offlineReservation?.activityId === activityId ? (
                  <StatusNotice tone="attention" label="Offline scoring ready">
                    {offlineReservation.points - offlineReservation.spent} budget points left ·{" "}
                    {offlineCommands.length} pending commands
                  </StatusNotice>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void prepareOffline()}
                    className="min-h-11 border theme-border px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                  >
                    prepare this device for offline scoring
                  </button>
                )}
                <p className="mt-2 font-mono text-micro theme-muted">
                  Offline awards require a ticket scan and a fixed server budget. They stay pending
                  until reconnect.
                </p>
              </div>
              {status && (
                <StatusNotice tone="positive" label="Points confirmed">
                  {status}
                </StatusNotice>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!reviewReady) {
                    if (!participant) setError("Choose a participant first.");
                    else {
                      setError("");
                      setReviewReady(true);
                    }
                    return;
                  }
                  void award(needsConfirmation);
                }}
                className="min-h-11 border border-foreground px-5 font-mono text-xs hover:opacity-70 disabled:opacity-50"
              >
                {needsConfirmation
                  ? "confirm large award"
                  : reviewReady
                    ? "award points"
                    : "review award"}
              </button>
            </div>
          </section>
        ))}

      {data.canReverse && recentAwards.length > 0 && (
        <section
          aria-labelledby="recent-awards-heading"
          className="mt-10 border-t theme-border pt-7"
        >
          <h2 id="recent-awards-heading" className="font-serif text-2xl">
            Recent awards
          </h2>
          <ol className="mt-4 divide-y theme-border border-y theme-border">
            {recentAwards.map((entry) => (
              <li key={entry.id} className="flex min-h-11 items-center justify-between gap-4 py-3">
                <span>
                  <span className="block font-serif">{entry.participantLabel}</span>
                  <span className="font-mono text-micro theme-muted">
                    {entry.activityName} · {entry.points > 0 ? "+" : ""}
                    {entry.points}
                  </span>
                </span>
                {entry.reversible && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reverse(entry.id)}
                    className="min-h-11 px-3 font-mono text-xs underline hover:opacity-70 disabled:opacity-50"
                  >
                    undo
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(data.canRequestGuests || data.canAddGuests || data.canApproveGuests) && (
        <section
          aria-labelledby="guest-actions-heading"
          className="mt-10 border-t theme-border pt-7"
        >
          <h2 id="guest-actions-heading" className="font-serif text-2xl">
            Guest requests
          </h2>
          {(data.canRequestGuests || data.canAddGuests) && (
            <form onSubmit={(event) => void submitGuest(event)} className="mt-4 grid gap-3">
              <label className="font-mono text-xs">
                guest name
                <input
                  required
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                />
              </label>
              <label className="font-mono text-xs">
                note (optional)
                <input
                  value={guestNote}
                  onChange={(event) => setGuestNote(event.target.value)}
                  className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
                />
              </label>
              <button
                disabled={busy}
                className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
              >
                {data.canAddGuests ? "add guest" : "request guest"}
              </button>
            </form>
          )}
          {data.canApproveGuests && guestRequests.length > 0 && (
            <ul className="mt-5 divide-y theme-border border-y theme-border">
              {guestRequests.map((request) => (
                <li key={request.id} className="flex min-h-11 items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 font-serif">{request.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decideGuest(request.id, true)}
                    className="min-h-11 px-2 font-mono text-xs underline"
                  >
                    approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decideGuest(request.id, false)}
                    className="min-h-11 px-2 font-mono text-xs underline"
                  >
                    decline
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.canTransfer && (
        <section
          aria-labelledby="transfer-points-heading"
          className="mt-10 border-t theme-border pt-7"
        >
          <h2 id="transfer-points-heading" className="font-serif text-2xl">
            Transfer points
          </h2>
          <form onSubmit={(event) => void transfer(event)} className="mt-4 grid gap-4">
            <StaffParticipantPicker
              label="from participant"
              eventSlug={data.eventSlug}
              token={token}
              value={transferFrom}
              onChange={setTransferFrom}
            />
            <StaffParticipantPicker
              label="to participant"
              eventSlug={data.eventSlug}
              token={token}
              value={transferTo}
              onChange={setTransferTo}
            />
            <label className="font-mono text-xs">
              points
              <input
                type="number"
                min={1}
                required
                value={transferPointsValue}
                onChange={(event) => setTransferPointsValue(Number(event.target.value))}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <label className="font-mono text-xs">
              reason
              <input
                required
                value={transferNote}
                onChange={(event) => setTransferNote(event.target.value)}
                className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <button
              disabled={busy}
              className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
            >
              transfer points
            </button>
          </form>
        </section>
      )}

      {data.canReviewHeld && heldActions.length > 0 && (
        <section
          aria-labelledby="held-actions-heading"
          className="mt-10 border-t theme-border pt-7"
        >
          <h2 id="held-actions-heading" className="font-serif text-2xl">
            Held score actions
          </h2>
          <ul className="mt-4 divide-y theme-border border-y theme-border">
            {heldActions.map((action) => (
              <li key={action.id} className="flex min-h-11 items-center gap-3 py-3">
                <span className="min-w-0 flex-1 font-mono text-xs">
                  {action.reasonCode} · {action.createdAt}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void acceptHeld(action.id)}
                  className="min-h-11 px-3 font-mono text-xs underline"
                >
                  accept
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function StaffParticipantPicker({
  label,
  eventSlug,
  token,
  value,
  onChange,
}: {
  label: string;
  eventSlug: string;
  token: string;
  value: Participant | null;
  onChange: (participant: Participant | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<Participant[]>([]);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (term.trim().length < 2) return;
    setItems(await searchStaffParticipantsFn({ data: { eventSlug, token, term } }));
  }
  return (
    <div>
      <p className="font-mono text-xs">{label}</p>
      {value ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="mt-2 min-h-11 w-full border theme-border px-3 text-left font-serif hover:opacity-70"
        >
          {value.displayName ?? value.publicAlias} · change
        </button>
      ) : (
        <>
          <form onSubmit={(event) => void search(event)} className="mt-2 flex gap-2">
            <input
              aria-label={`Search ${label}`}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3"
            />
            <button className="min-h-11 border theme-border px-4 font-mono text-xs">search</button>
          </form>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChange(item);
                setItems([]);
              }}
              className="min-h-11 w-full border-b theme-border text-left font-serif"
            >
              {item.displayName ?? item.publicAlias} · {item.balance} points
            </button>
          ))}
        </>
      )}
    </div>
  );
}
