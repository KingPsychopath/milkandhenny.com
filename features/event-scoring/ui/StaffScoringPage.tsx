import { useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { StatusNotice } from "@/components/StatusNotice";
import { searchStaffParticipantsFn } from "../staff-scoring.functions";
import {
  useStaffScoringController,
  type PageData,
  type Participant,
} from "./useStaffScoringController";
import { StaffAwardPanel } from "./StaffAwardPanel";
import { StaffOperationNav } from "./StaffOperationNav";
import { StaffPhotosPanel } from "./StaffPhotosPanel";
import { StaffTeamsPanel } from "./StaffTeamsPanel";
import { StaffTicketScannerField } from "./StaffTicketScannerField";

export function StaffScoringPage({ data, token }: { data: PageData; token: string }) {
  const controller = useStaffScoringController(data, token);
  const {
    setActivityId,
    scanned,
    setScanned,
    checkpointId,
    setCheckpointId,
    status,
    error,
    busy,
    setReviewReady,
    cameraOpen,
    setCameraOpen,
    operation,
    setOperation,
    recentAwards,
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
    admit,
    scanCheckpoint,
    reverse,
    submitGuest,
    decideGuest,
    transfer,
    acceptHeld,
  } = controller;

  return (
    <main id="main" className="mx-auto max-w-2xl px-6 py-10">
      <header>
        <p className="font-mono text-micro uppercase tracking-widest text-[var(--prose-hashtag)]">
          staff tools
        </p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">{data.eventTitle}</h1>
        <p className="mt-2 font-mono text-xs theme-muted">
          {data.label}
          {data.rolePreset ? ` · ${data.rolePreset.replaceAll("-", " ")}` : ""}
        </p>
      </header>

      <StaffOperationNav data={data} value={operation} onChange={setOperation} />

      {operation === "teams" && data.canManageTeams ? (
        <StaffTeamsPanel data={data} token={token} />
      ) : null}

      {operation === "photos" && data.canManageGuestPhotos ? (
        <StaffPhotosPanel data={data} token={token} />
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
          <div className="mt-3 border-l-2 border-[var(--prose-hashtag)] pl-4">
            <p className="font-mono text-xs text-foreground">ENTRY MODE · checks the guest in</p>
            <p className="mt-1 font-mono text-micro theme-muted">
              It does not consume food, merch, or another checkpoint allowance.
            </p>
          </div>
          <div className="mt-5">
            <StaffTicketScannerField
              id="staff-admit-ticket"
              value={scanned}
              onChange={setScanned}
              actionLabel="admit"
              cameraOpen={cameraOpen}
              onCameraOpenChange={setCameraOpen}
              busy={busy}
              onSubmit={(raw) => void admit(raw)}
            />
          </div>
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

      {data.canScanCheckpoints && operation === "checkpoint" && data.checkpoints.length > 0 && (
        <section aria-labelledby="checkpoint-heading" className="mt-10 border-t theme-border pt-7">
          <h2 id="checkpoint-heading" className="font-serif text-2xl">
            Scan a checkpoint
          </h2>
          <div className="mt-3 border-l-2 border-[var(--prose-hashtag)] pl-4">
            <p className="font-mono text-xs text-foreground">
              CHECKPOINT MODE · consumes one named allowance
            </p>
            <p className="mt-1 font-mono text-micro theme-muted">
              This never checks a guest in at the door. Confirm the station below before scanning.
            </p>
          </div>
          <label className="mt-5 block font-mono text-xs">
            active station
            <AppSelect
              value={checkpointId}
              onValueChange={setCheckpointId}
              options={data.checkpoints.map((checkpoint) => ({
                value: checkpoint.id,
                label: `${checkpoint.name} — uses 1 allowance`,
              }))}
              variant="field"
              ariaLabel="Active checkpoint"
              className="mt-2"
            />
          </label>
          <div className="mt-5">
            <StaffTicketScannerField
              id="staff-checkpoint-ticket"
              value={scanned}
              onChange={setScanned}
              actionLabel="use 1"
              cameraOpen={cameraOpen}
              onCameraOpenChange={setCameraOpen}
              busy={busy}
              onSubmit={(raw) => void scanCheckpoint(raw)}
            />
          </div>
          {error && (
            <StatusNotice tone="danger" label="Checkpoint not used" className="mt-4">
              {error}
            </StatusNotice>
          )}
          {status && (
            <StatusNotice tone="positive" label="Allowance recorded" className="mt-4">
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
          <StaffAwardPanel data={data} token={token} controller={controller} />
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
