import { useState, type FormEvent } from "react";

import {
  admitStaffTicketFn,
  decideStaffGuestRequestFn,
  scanStaffCheckpointFn,
  submitStaffGuestFn,
} from "../staff-operations.functions";
import type { StaffOperationsPageData } from "../staff-operations.functions";

export type StaffOperationsData = StaffOperationsPageData;
export type StaffOperation = "admit" | "checkpoint" | "guests" | "teams" | "photos";

function initialOperation(data: StaffOperationsData): StaffOperation {
  if (data.canAdmit) return "admit";
  if (data.canScanCheckpoints && data.checkpoints.length > 0) return "checkpoint";
  if (data.canRequestGuests || data.canAddGuests || data.canApproveGuests) return "guests";
  if (data.canManageTeams) return "teams";
  return "photos";
}

export function useStaffOperationsController(data: StaffOperationsData, token: string) {
  const [scanned, setScanned] = useState("");
  const [checkpointId, setCheckpointId] = useState(data.checkpoints[0]?.id ?? "");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [operation, setOperation] = useState<StaffOperation>(() => initialOperation(data));
  const [guestName, setGuestName] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [guestRequests, setGuestRequests] = useState(data.guestRequests);

  function beginAction() {
    setBusy(true);
    setError("");
    setStatus("");
  }

  function finishScan() {
    setScanned("");
    setCameraOpen(false);
    setBusy(false);
  }

  async function admit(raw = scanned) {
    if (!raw.trim()) return setError("Find or scan a ticket first.");
    beginAction();
    try {
      const result = await admitStaffTicketFn({
        data: { eventSlug: data.eventSlug, token, scanned: raw },
      });
      if (!result.ok) return setError(result.error);
      const outcome = result.value;
      if (outcome.result === "admitted")
        setStatus(`${outcome.ticket?.holderName ?? "Guest"} is checked in.`);
      else if (outcome.result === "already-redeemed") setError("This guest is already checked in.");
      else if (outcome.result === "wrong-event") setError("This ticket belongs to another event.");
      else if (outcome.result === "void") setError("This ticket is not active.");
      else setError("No active ticket matches that code.");
    } catch {
      setError("The door could not be reached. Check the connection and try again.");
    } finally {
      finishScan();
    }
  }

  async function scanCheckpoint(raw = scanned) {
    if (!raw.trim() || !checkpointId)
      return setError("Choose a checkpoint, then find or scan a ticket.");
    beginAction();
    try {
      const result = await scanStaffCheckpointFn({
        data: { eventSlug: data.eventSlug, token, checkpointId, scanned: raw },
      });
      if (!result.ok) return setError(result.error);
      const outcome = result.value;
      if (outcome.result === "consumed") {
        setStatus(
          `${outcome.ticket.holderName}: recorded 1 · ${Math.max(0, outcome.ticket.allowance - outcome.ticket.used)} left.`,
        );
      } else if (outcome.result === "exhausted") setError("Nothing is left on this ticket here.");
      else if (outcome.result === "not-included")
        setError("This ticket does not include this checkpoint.");
      else if (outcome.result === "wrong-event") setError("This ticket belongs to another event.");
      else if (outcome.result === "void") setError("This ticket is not active.");
      else if (outcome.result === "unknown-checkpoint")
        setError("This checkpoint is no longer available.");
      else setError("No active ticket matches that code.");
    } catch {
      setError("This checkpoint could not be reached. Check the connection and try again.");
    } finally {
      finishScan();
    }
  }

  async function submitGuest(event: FormEvent) {
    event.preventDefault();
    beginAction();
    try {
      const result = await submitStaffGuestFn({
        data: {
          eventSlug: data.eventSlug,
          token,
          name: guestName,
          note: guestNote || undefined,
        },
      });
      if (!result.ok) return setError(result.error);
      setStatus(result.value.mode === "added" ? "Guest added." : "Guest request sent.");
      setGuestName("");
      setGuestNote("");
    } catch {
      setError("The guest request could not be sent. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function decideGuest(requestId: number, approve: boolean) {
    beginAction();
    try {
      const result = await decideStaffGuestRequestFn({
        data: { eventSlug: data.eventSlug, token, requestId, approve },
      });
      if (!result.ok) return setError(result.error);
      setGuestRequests((items) => items.filter((item) => item.id !== requestId));
      setStatus(approve ? "Guest approved and ticket issued." : "Guest request declined.");
    } catch {
      setError("The guest request could not be updated. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return {
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
  };
}
