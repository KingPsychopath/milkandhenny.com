import { AppSelect } from "@/components/AppSelect";
import { StatusNotice } from "@/components/StatusNotice";
import { StaffOperationNav } from "./StaffOperationNav";
import { StaffPhotosPanel } from "./StaffPhotosPanel";
import { StaffTeamsPanel } from "./StaffTeamsPanel";
import { StaffTicketScannerField } from "./StaffTicketScannerField";
import {
  useStaffOperationsController,
  type StaffOperationsData,
} from "./useStaffOperationsController";

export function StaffOperationsPage({ data, token }: { data: StaffOperationsData; token: string }) {
  const controller = useStaffOperationsController(data, token);
  const {
    scanned,
    setScanned,
    checkpointId,
    setCheckpointId,
    status,
    error,
    busy,
    cameraOpen,
    setCameraOpen,
    operation,
    setOperation,
    guestName,
    setGuestName,
    guestNote,
    setGuestNote,
    guestRequests,
    admit,
    scanCheckpoint,
    submitGuest,
    decideGuest,
  } = controller;
  const hasVisibleTools =
    data.canAdmit ||
    (data.canScanCheckpoints && data.checkpoints.length > 0) ||
    data.canRequestGuests ||
    data.canAddGuests ||
    data.canApproveGuests ||
    data.canManageTeams ||
    data.canManageGuestPhotos;

  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-8 sm:px-6 sm:py-10">
      <header>
        <p className="font-mono text-micro uppercase tracking-[0.16em] text-[var(--prose-hashtag)]">
          staff tools
        </p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">{data.eventTitle}</h1>
        <p className="mt-2 font-mono text-xs theme-muted">
          {data.label}
          {data.rolePreset ? ` · ${data.rolePreset.replaceAll("-", " ")}` : ""}
        </p>
      </header>

      <StaffOperationNav data={data} value={operation} onChange={setOperation} />

      {!hasVisibleTools ? (
        <StatusNotice tone="neutral" label="No active event tools" className="mt-8">
          This role only contained retired scoring permissions. Ask the organiser to add door,
          checkpoint, team, guest, or photo access.
        </StatusNotice>
      ) : null}

      {operation === "admit" && data.canAdmit ? (
        <section aria-labelledby="admit-heading" className="mt-8">
          <p className="font-mono text-micro uppercase tracking-[0.14em] text-[var(--status-positive)]">
            entry mode
          </p>
          <h2 id="admit-heading" className="mt-2 font-serif text-2xl">
            Check a guest in
          </h2>
          <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
            Scan the ticket or paste its reference. Checkpoints are never used here.
          </p>
          <div className="mt-5">
            <StaffTicketScannerField
              id="staff-admit-ticket"
              value={scanned}
              onChange={setScanned}
              actionLabel="check in"
              cameraOpen={cameraOpen}
              onCameraOpenChange={setCameraOpen}
              busy={busy}
              onSubmit={(raw) => void admit(raw)}
            />
          </div>
        </section>
      ) : null}

      {operation === "checkpoint" && data.canScanCheckpoints && data.checkpoints.length > 0 ? (
        <section aria-labelledby="checkpoint-heading" className="mt-8">
          <p className="font-mono text-micro uppercase tracking-[0.14em] text-[var(--status-attention)]">
            checkpoint mode
          </p>
          <h2 id="checkpoint-heading" className="mt-2 font-serif text-2xl">
            Record an allowance
          </h2>
          <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
            Choose the station first. This never checks a guest in at the door.
          </p>
          <label className="mt-5 block font-mono text-xs">
            active station
            <AppSelect
              value={checkpointId}
              onValueChange={setCheckpointId}
              options={data.checkpoints.map((checkpoint) => ({
                value: checkpoint.id,
                label: checkpoint.name,
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
              actionLabel="record 1"
              cameraOpen={cameraOpen}
              onCameraOpenChange={setCameraOpen}
              busy={busy}
              onSubmit={(raw) => void scanCheckpoint(raw)}
            />
          </div>
        </section>
      ) : null}

      {operation === "guests" &&
      (data.canRequestGuests || data.canAddGuests || data.canApproveGuests) ? (
        <section aria-labelledby="guest-actions-heading" className="mt-8">
          <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">guest list</p>
          <h2 id="guest-actions-heading" className="mt-2 font-serif text-2xl">
            Guest requests
          </h2>
          {(data.canRequestGuests || data.canAddGuests) && (
            <form onSubmit={(event) => void submitGuest(event)} className="mt-5 grid gap-4">
              <label className="font-mono text-xs">
                guest name
                <input
                  required
                  value={guestName}
                  onChange={(event) => setGuestName(event.target.value)}
                  className="mt-2 min-h-14 w-full rounded-xl border theme-border-strong bg-transparent px-4 text-base"
                />
              </label>
              <label className="font-mono text-xs">
                note <span className="theme-muted">· optional</span>
                <input
                  value={guestNote}
                  onChange={(event) => setGuestNote(event.target.value)}
                  className="mt-2 min-h-12 w-full rounded-xl border theme-border bg-transparent px-4"
                />
              </label>
              <button disabled={busy} className="mh-action mh-action--primary w-full">
                {data.canAddGuests ? "add guest" : "send request"}
              </button>
            </form>
          )}
          {data.canApproveGuests && guestRequests.length > 0 ? (
            <ul className="mt-6 overflow-hidden rounded-2xl border theme-border">
              {guestRequests.map((request) => (
                <li
                  key={request.id}
                  className="flex min-h-16 items-center gap-2 border-b theme-border px-4 py-3 last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate font-serif">{request.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decideGuest(request.id, true)}
                    className="mh-action mh-action--primary"
                  >
                    approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decideGuest(request.id, false)}
                    className="mh-action mh-action--quiet"
                  >
                    decline
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {data.canApproveGuests && guestRequests.length === 0 ? (
            <p className="mt-5 border-y theme-border py-5 font-mono text-xs theme-muted">
              No guest requests are waiting.
            </p>
          ) : null}
        </section>
      ) : null}

      {operation === "teams" && data.canManageTeams ? (
        <StaffTeamsPanel data={data} token={token} />
      ) : null}

      {operation === "photos" && data.canManageGuestPhotos ? (
        <StaffPhotosPanel data={data} token={token} />
      ) : null}

      {error ? (
        <StatusNotice tone="danger" label="Could not complete that" className="mt-5">
          {error}
        </StatusNotice>
      ) : null}
      {status ? (
        <StatusNotice tone="positive" label="Done" className="mt-5">
          {status}
        </StatusNotice>
      ) : null}
    </main>
  );
}
