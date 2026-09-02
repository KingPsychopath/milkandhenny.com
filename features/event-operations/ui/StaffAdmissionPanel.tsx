import { useMemo, useState } from "react";

import { StatusNotice } from "@/components/StatusNotice";
import { searchDoorTickets } from "@/features/tickets/door-search";
import { parseTicketQrPayload } from "@/features/tickets/types";
import { StaffTicketScannerField } from "./StaffTicketScannerField";
import type { StaffOperationsData } from "./useStaffOperationsController";

type DoorTicket = StaffOperationsData["doorTickets"][number];

type PendingGroup = {
  anchor: DoorTicket;
  tickets: DoorTicket[];
  selectedIds: string[];
};

export function StaffAdmissionPanel({
  data,
  value,
  onChange,
  cameraOpen,
  onCameraOpenChange,
  busy,
  redeemedTicketIds,
  onAdmit,
  onGroupComplete,
}: {
  data: StaffOperationsData;
  value: string;
  onChange: (value: string) => void;
  cameraOpen: boolean;
  onCameraOpenChange: (open: boolean) => void;
  busy: boolean;
  redeemedTicketIds: ReadonlySet<string>;
  onAdmit: (raw: string, announce?: boolean) => Promise<boolean>;
  onGroupComplete: (admitted: number, requested: number) => void;
}) {
  const [pendingGroup, setPendingGroup] = useState<PendingGroup | null>(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const matches = useMemo(
    () => searchDoorTickets(data.doorTickets, value),
    [data.doorTickets, value],
  );

  function choose(raw: string) {
    const parsed = parseTicketQrPayload(raw);
    const reference = parsed?.ticketId ?? raw.trim();
    const ticket = data.doorTickets.find(
      (candidate) => candidate.id.toLocaleLowerCase() === reference.toLocaleLowerCase(),
    );
    if (!ticket) {
      void onAdmit(raw);
      return;
    }

    const group = data.doorTickets.filter((candidate) => candidate.orderId === ticket.orderId);
    if (group.length > 1) {
      const ticketCanEnter = ticket.status === "valid" && !redeemedTicketIds.has(ticket.id);
      setPendingGroup({
        anchor: ticket,
        tickets: [ticket, ...group.filter((candidate) => candidate.id !== ticket.id)],
        selectedIds: ticketCanEnter ? [ticket.id] : [],
      });
      onChange("");
      onCameraOpenChange(false);
      return;
    }
    void onAdmit(ticket.id).then((admitted) => {
      if (admitted) onChange("");
    });
  }

  async function admitGroup() {
    if (!pendingGroup) return;
    const selected = pendingGroup.tickets.filter((ticket) =>
      pendingGroup.selectedIds.includes(ticket.id),
    );
    setGroupBusy(true);
    let admitted = 0;
    const failedIds: string[] = [];
    try {
      for (const ticket of selected) {
        if (await onAdmit(ticket.id, false)) {
          admitted += 1;
        } else {
          failedIds.push(ticket.id);
        }
      }
      onGroupComplete(admitted, selected.length);
      setPendingGroup((current) =>
        failedIds.length > 0 && current ? { ...current, selectedIds: failedIds } : null,
      );
    } finally {
      setGroupBusy(false);
    }
  }

  if (pendingGroup) {
    const eligibleIds = pendingGroup.tickets
      .filter((ticket) => ticket.status === "valid" && !redeemedTicketIds.has(ticket.id))
      .map((ticket) => ticket.id);
    const everyoneSelected = eligibleIds.every((id) => pendingGroup.selectedIds.includes(id));
    return (
      <section
        aria-labelledby="staff-group-heading"
        className="mt-5 rounded-2xl border theme-border-strong p-4"
      >
        <h3 id="staff-group-heading" className="font-serif text-xl">
          {pendingGroup.tickets.length} tickets on this order
        </h3>
        <p className="mt-1 font-mono text-micro leading-relaxed theme-muted">
          The ticket you found is first. Select anyone else arriving now; people already inside are
          protected from a second check-in.
        </p>
        <ul className="mt-3 divide-y theme-border border-y theme-border">
          {pendingGroup.tickets.map((ticket) => {
            const anchor = ticket.id === pendingGroup.anchor.id;
            const alreadyInside = redeemedTicketIds.has(ticket.id);
            const unavailable = ticket.status !== "valid";
            const selected = alreadyInside || pendingGroup.selectedIds.includes(ticket.id);
            return (
              <li key={ticket.id}>
                <label className="flex min-h-14 cursor-pointer items-center gap-3 py-2 font-mono text-xs">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={alreadyInside || unavailable || groupBusy}
                    onChange={() =>
                      setPendingGroup((current) => {
                        if (!current) return current;
                        return {
                          ...current,
                          selectedIds: selected
                            ? current.selectedIds.filter((id) => id !== ticket.id)
                            : [...current.selectedIds, ticket.id],
                        };
                      })
                    }
                    className="size-5 shrink-0 accent-[var(--status-positive)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{ticket.holderName}</span>
                  <span className="shrink-0 theme-muted">
                    {alreadyInside
                      ? "inside ✓"
                      : unavailable
                        ? ticket.status
                        : anchor
                          ? "found ✓"
                          : ticket.ticketTypeName}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {eligibleIds.length > 0 ? (
            <>
              <button
                type="button"
                disabled={groupBusy || everyoneSelected}
                onClick={() =>
                  setPendingGroup((current) =>
                    current ? { ...current, selectedIds: eligibleIds } : current,
                  )
                }
                className="min-h-14 rounded-xl border theme-border-strong px-3 font-mono text-xs disabled:opacity-50"
              >
                {everyoneSelected ? "everyone selected" : "select everyone"}
              </button>
              <button
                type="button"
                disabled={groupBusy || pendingGroup.selectedIds.length === 0}
                onClick={() => void admitGroup()}
                className="min-h-14 rounded-xl bg-foreground px-3 font-mono text-xs text-background disabled:opacity-50"
              >
                {groupBusy ? "checking in…" : `check in ${pendingGroup.selectedIds.length}`}
              </button>
            </>
          ) : (
            <StatusNotice
              tone="positive"
              label="Everyone is already inside"
              className="col-span-2"
            />
          )}
          <button
            type="button"
            disabled={groupBusy}
            onClick={() => setPendingGroup(null)}
            className="col-span-2 min-h-12 font-mono text-xs theme-muted hover:text-foreground disabled:opacity-50"
          >
            back to search
          </button>
        </div>
      </section>
    );
  }

  return (
    <StaffTicketScannerField
      id="staff-admit-ticket"
      value={value}
      onChange={onChange}
      actionLabel="check in"
      cameraOpen={cameraOpen}
      onCameraOpenChange={onCameraOpenChange}
      busy={busy}
      onSubmit={(raw) => {
        const input = raw ?? value;
        if (raw || data.doorTickets.some((ticket) => ticket.id === input.trim())) choose(input);
        else if (matches.length === 1) choose(matches[0]!.id);
        else void onAdmit(input);
      }}
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
                onClick={() => choose(ticket.id)}
                className="flex min-h-14 w-full items-center justify-between gap-4 px-4 py-2 text-left disabled:opacity-50"
              >
                <span className="min-w-0 truncate font-serif text-lg">{ticket.holderName}</span>
                <span className="shrink-0 text-right font-mono text-micro theme-muted">
                  {ticket.redeemedAt || redeemedTicketIds.has(ticket.id)
                    ? "already in"
                    : ticket.status === "valid"
                      ? ticket.ticketTypeName
                      : ticket.status}
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
  );
}
