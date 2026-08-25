import { useEffect, useRef, useState } from "react";

import {
  acceptStaffHeldActionFn,
  awardStaffPointsFn,
  admitStaffTicketFn,
  closeOfflineScoreReservationFn,
  decideStaffGuestRequestFn,
  reconcileOfflineScoreCommandsFn,
  reserveOfflineScoreBudgetFn,
  reverseStaffAwardFn,
  resolveStaffScannedParticipantFn,
  searchStaffParticipantsFn,
  submitStaffGuestFn,
  transferStaffPointsFn,
} from "../staff-scoring.functions";
import type { OfflineScoreCommand } from "../offline.server";
import type { getStaffScoringPage } from "../staff-scoring.server";
import { convertRulePoints } from "../types";
import { uploadStaffScorePhoto } from "./staff-photo-upload";

export type PageData = Extract<Awaited<ReturnType<typeof getStaffScoringPage>>, { found: true }>;
export type Participant = Awaited<ReturnType<typeof searchStaffParticipantsFn>>[number];
type OfflineReservation = {
  id: string;
  activityId: string;
  points: number;
  spent: number;
  expiresAt: string;
};

export function useStaffScoringController(data: PageData, token: string) {
  const [activityId, setActivityId] = useState(data.activities[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Participant[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [scanned, setScanned] = useState("");
  const [placement, setPlacement] = useState(1);
  const [rawScore, setRawScore] = useState(0);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [confirmedRemaining, setConfirmedRemaining] = useState<number | undefined>();
  const [mediaRef, setMediaRef] = useState("");
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaVisibility, setMediaVisibility] = useState<
    "event-album" | "admin-evidence" | "discard"
  >("event-album");
  const [mediaConsent, setMediaConsent] = useState<
    "not-requested" | "requested" | "obtained" | "declined"
  >(data.photoConsentPolicy === "required" ? "obtained" : "requested");
  const [operation, setOperation] = useState<"admit" | "run" | "award">(
    data.canAdmit ? "admit" : data.canRun ? "run" : "award",
  );
  const [recentAwards, setRecentAwards] = useState(data.recentAwards);
  const [offlineReservation, setOfflineReservation] = useState<OfflineReservation>();
  const [offlineCommands, setOfflineCommands] = useState<OfflineScoreCommand[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [guestRequests, setGuestRequests] = useState(data.guestRequests);
  const [heldActions, setHeldActions] = useState(data.heldActions);
  const [transferFrom, setTransferFrom] = useState<Participant | null>(null);
  const [transferTo, setTransferTo] = useState<Participant | null>(null);
  const [transferPointsValue, setTransferPointsValue] = useState(1);
  const [transferNote, setTransferNote] = useState("");
  const commandId = useRef(crypto.randomUUID());

  const activity = data.activities.find((entry) => entry.id === activityId);
  const pool = data.pools.find((entry) => entry.activityId === activityId) ?? data.pools[0];
  const previewPoints = activity ? convertRulePoints(activity.rule, { placement, rawScore }) : 0;

  async function captureMedia(file: File) {
    const uploadPath = data.mediaDrop?.uploadPath;
    if (!uploadPath) {
      setError("The event photo album is not open for uploads.");
      return;
    }
    if (!navigator.onLine) {
      setError("Reconnect before attaching a photograph. The score can still be queued alone.");
      return;
    }
    setMediaUploading(true);
    setError("");
    try {
      setMediaRef(
        await uploadStaffScorePhoto({
          file,
          uploadPath,
          albumPath: data.mediaDrop?.albumPath,
        }),
      );
      setStatus("Photograph ready. It will attach after the points are accepted.");
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "The photograph failed");
    } finally {
      setMediaUploading(false);
    }
  }

  useEffect(() => {
    const key = `mah-offline-score:${data.eventSlug}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as {
        reservation?: OfflineReservation;
        commands?: OfflineScoreCommand[];
      } | null;
      if (saved?.reservation) setOfflineReservation(saved.reservation);
      if (Array.isArray(saved?.commands)) setOfflineCommands(saved.commands);
    } catch {
      sessionStorage.removeItem(key);
    }
  }, [data.eventSlug]);

  useEffect(() => {
    const key = `mah-offline-score:${data.eventSlug}`;
    if (!offlineReservation) sessionStorage.removeItem(key);
    else
      sessionStorage.setItem(
        key,
        JSON.stringify({ reservation: offlineReservation, commands: offlineCommands }),
      );
  }, [data.eventSlug, offlineCommands, offlineReservation]);

  useEffect(() => {
    async function reconcile() {
      if (!navigator.onLine || !offlineReservation || offlineCommands.length === 0) return;
      const result = await reconcileOfflineScoreCommandsFn({
        data: {
          eventSlug: data.eventSlug,
          token,
          reservationId: offlineReservation.id,
          commands: offlineCommands,
        },
      });
      if (!result.ok) return setError(result.error);
      setStatus(
        result.value.map((entry) => `${entry.commandId.slice(-6)} ${entry.state}`).join(" · "),
      );
      setOfflineCommands([]);
      await closeOfflineScoreReservationFn({
        data: { eventSlug: data.eventSlug, token, reservationId: offlineReservation.id },
      });
      setOfflineReservation(undefined);
    }
    const online = () => void reconcile();
    window.addEventListener("online", online);
    void reconcile();
    return () => window.removeEventListener("online", online);
  }, [data.eventSlug, offlineCommands, offlineReservation, token]);

  async function search() {
    if (query.trim().length < 2) {
      setError("Enter at least two letters or a ticket suffix.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setResults(
        await searchStaffParticipantsFn({
          data: { eventSlug: data.eventSlug, token, term: query },
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function award(confirmLarge = false) {
    if (!activityId || !participant) {
      setError("Choose an activity and a participant.");
      return;
    }
    if (!navigator.onLine) {
      if (!offlineReservation || offlineReservation.activityId !== activityId) {
        setError("This device has no offline budget for the selected activity.");
        return;
      }
      if (!scanned.trim()) {
        setError("Offline scoring needs the signed ticket QR. Search-only awards stay online.");
        return;
      }
      if (mediaRef.trim()) {
        setError(
          "The photo is still local. Remove it, queue the score, then upload it after reconnecting.",
        );
        return;
      }
      const spent = offlineReservation.spent + previewPoints;
      if (spent > offlineReservation.points) {
        setError("This device has used its offline point budget.");
        return;
      }
      const command: OfflineScoreCommand = {
        commandId: commandId.current,
        localSequence: offlineCommands.length + 1,
        participantProof: scanned.trim(),
        result: { placement, rawScore },
        deviceTime: new Date().toISOString(),
      };
      setOfflineCommands((commands) => [...commands, command]);
      setOfflineReservation({ ...offlineReservation, spent });
      setStatus(`${previewPoints} points queued on this device. They are not accepted yet.`);
      setParticipant(null);
      setScanned("");
      setReviewReady(false);
      commandId.current = crypto.randomUUID();
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    const result = await awardStaffPointsFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        activityId,
        participantId: participant.id,
        placement,
        rawScore,
        commandId: commandId.current,
        note: note.trim() || undefined,
        confirmLarge,
        media: mediaRef.trim()
          ? {
              storageRef: mediaRef.trim(),
              visibility: mediaVisibility,
              consentState: mediaConsent,
            }
          : undefined,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setNeedsConfirmation(result.status === 409 && result.error.startsWith("Confirm this"));
      return;
    }
    setStatus(`${result.value.points} points awarded.`);
    setConfirmedRemaining(result.value.remainingPool);
    setNeedsConfirmation(false);
    setReviewReady(false);
    setParticipant(null);
    setScanned("");
    setQuery("");
    setResults([]);
    setNote("");
    setMediaRef("");
    commandId.current = crypto.randomUUID();
  }

  async function prepareOffline() {
    if (!activityId) return;
    setBusy(true);
    setError("");
    const result = await reserveOfflineScoreBudgetFn({
      data: { eventSlug: data.eventSlug, token, activityId, points: 50, expiresInMinutes: 60 },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setOfflineReservation(result.value);
    setOfflineCommands([]);
    setStatus(`Offline budget ready: ${result.value.points} points for 60 minutes.`);
  }

  async function resolveScan(raw = scanned) {
    if (!raw.trim()) {
      setError("Paste or scan a ticket first.");
      return;
    }
    setBusy(true);
    setError("");
    const found = await resolveStaffScannedParticipantFn({
      data: { eventSlug: data.eventSlug, token, scanned: raw },
    });
    setBusy(false);
    if (!found) {
      setError("This ticket is not valid for this event.");
      return;
    }
    setParticipant(found);
    setResults([]);
    setQuery("");
    setReviewReady(false);
    setCameraOpen(false);
  }

  async function admit(raw = scanned) {
    if (!raw.trim()) {
      setError("Paste or scan a ticket first.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    const result = await admitStaffTicketFn({
      data: { eventSlug: data.eventSlug, token, scanned: raw },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const outcome = result.value;
    if (outcome.result === "admitted")
      setStatus(`${outcome.ticket?.holderName ?? "Guest"} admitted.`);
    else if (outcome.result === "already-redeemed") setError("This ticket was already admitted.");
    else if (outcome.result === "wrong-event") setError("This ticket belongs to another event.");
    else if (outcome.result === "void") setError("This ticket is not active.");
    else setError("This ticket could not be admitted.");
    setScanned("");
    setCameraOpen(false);
  }

  async function reverse(transactionId: string) {
    const reason = window.prompt("Why are you undoing this award?");
    if (!reason?.trim()) return;
    setBusy(true);
    setError("");
    const result = await reverseStaffAwardFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        transactionId,
        commandId: crypto.randomUUID(),
        note: reason.trim(),
      },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setRecentAwards((entries) =>
      entries.map((entry) =>
        entry.id === transactionId ? { ...entry, reversible: false } : entry,
      ),
    );
    setStatus("The award was reversed. Its history remains in the audit log.");
  }

  async function submitGuest(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await submitStaffGuestFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        name: guestName,
        note: guestNote || undefined,
      },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setStatus(result.value.mode === "added" ? "Guest added." : "Guest request sent.");
    setGuestName("");
    setGuestNote("");
  }

  async function decideGuest(requestId: number, approve: boolean) {
    setBusy(true);
    setError("");
    const result = await decideStaffGuestRequestFn({
      data: { eventSlug: data.eventSlug, token, requestId, approve },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setGuestRequests((items) => items.filter((item) => item.id !== requestId));
    setStatus(approve ? "Guest approved and ticket issued." : "Guest request declined.");
  }

  async function transfer(event: React.FormEvent) {
    event.preventDefault();
    if (!transferFrom || !transferTo) return setError("Choose both participants.");
    setBusy(true);
    setError("");
    const result = await transferStaffPointsFn({
      data: {
        eventSlug: data.eventSlug,
        token,
        fromParticipantId: transferFrom.id,
        toParticipantId: transferTo.id,
        points: transferPointsValue,
        commandId: crypto.randomUUID(),
        note: transferNote,
      },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setTransferFrom(null);
    setTransferTo(null);
    setTransferNote("");
    setStatus("Points transferred. Both postings share one transaction.");
  }

  async function acceptHeld(transactionId: string) {
    const note = window.prompt("Why should this held action be accepted?");
    if (!note?.trim()) return;
    setBusy(true);
    setError("");
    const result = await acceptStaffHeldActionFn({
      data: { eventSlug: data.eventSlug, token, transactionId, note: note.trim() },
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setHeldActions((items) => items.filter((item) => item.id !== transactionId));
    setStatus("Held action accepted and recorded in the audit trail.");
  }

  return {
    activityId,
    setActivityId,
    query,
    setQuery,
    results,
    setResults,
    participant,
    setParticipant,
    scanned,
    setScanned,
    placement,
    setPlacement,
    rawScore,
    setRawScore,
    note,
    setNote,
    status,
    setStatus,
    error,
    setError,
    busy,
    setBusy,
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
    setRecentAwards,
    offlineReservation,
    setOfflineReservation,
    offlineCommands,
    setOfflineCommands,
    guestName,
    setGuestName,
    guestNote,
    setGuestNote,
    guestRequests,
    setGuestRequests,
    heldActions,
    setHeldActions,
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
  };
}
