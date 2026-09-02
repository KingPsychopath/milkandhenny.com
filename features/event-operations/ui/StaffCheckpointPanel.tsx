import { useMemo } from "react";

import { AppSelect } from "@/components/AppSelect";
import { searchDoorTickets } from "@/features/tickets/door-search";
import { StaffTicketScannerField } from "./StaffTicketScannerField";
import type { StaffOperationsData } from "./useStaffOperationsController";

export function StaffCheckpointPanel({
  data,
  checkpointId,
  onCheckpointChange,
  value,
  onChange,
  cameraOpen,
  onCameraOpenChange,
  busy,
  onScan,
}: {
  data: StaffOperationsData;
  checkpointId: string;
  onCheckpointChange: (checkpointId: string) => void;
  value: string;
  onChange: (value: string) => void;
  cameraOpen: boolean;
  onCameraOpenChange: (open: boolean) => void;
  busy: boolean;
  onScan: (raw?: string) => Promise<void>;
}) {
  const matches = useMemo(
    () => searchDoorTickets(data.doorTickets, value),
    [data.doorTickets, value],
  );

  function submit(raw?: string) {
    const input = raw ?? value;
    if (!raw && matches.length === 1) void onScan(matches[0]!.id);
    else void onScan(input);
  }

  return (
    <>
      <label className="mt-5 block font-mono text-xs">
        active station
        <AppSelect
          value={checkpointId}
          onValueChange={onCheckpointChange}
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
          value={value}
          onChange={onChange}
          actionLabel="record 1"
          cameraOpen={cameraOpen}
          onCameraOpenChange={onCameraOpenChange}
          busy={busy}
          onSubmit={submit}
        >
          {value.trim().length >= 2 && matches.length > 0 ? (
            <ul
              className="mt-2 overflow-hidden rounded-2xl border theme-border"
              aria-label="Matching guests"
            >
              {matches.map((ticket) => (
                <li key={ticket.id} className="border-b theme-border last:border-b-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onScan(ticket.id)}
                    className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-2 text-left disabled:opacity-50"
                  >
                    <span className="min-w-0 truncate font-serif text-lg">{ticket.holderName}</span>
                    <span className="shrink-0 text-right font-mono text-micro theme-muted">
                      {ticket.ticketTypeName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : value.trim().length >= 2 ? (
            <p className="mt-3 font-mono text-xs leading-relaxed theme-muted">
              No matching guest yet. Keep typing, paste the full ticket reference, or scan its QR.
            </p>
          ) : null}
        </StaffTicketScannerField>
      </div>
    </>
  );
}
