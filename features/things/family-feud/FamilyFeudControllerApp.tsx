import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useQrCode } from "@/hooks/useQrCode";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import type { MultiplayerActionInput } from "../shared/multiplayer";
import {
  readExpiringLocalValue,
  removeStorageKeys,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { createMultiplayerBrowserCredential } from "../shared/multiplayer-join.client";
import { useReliableMultiplayerAction } from "../shared/useReliableMultiplayerAction";
import {
  closeFamilyFeudTeamClaimSessionFn,
  openFamilyFeudTeamClaimSessionFn,
} from "./family-feud-claims.functions";
import { unlockFamilyFeudAudio } from "./family-feud-audio.client";
import { FamilyFeudAnswerBoard, FamilyFeudScoreboard, FamilyFeudTeamMark } from "./FamilyFeudBoard";
import {
  familyFeudBuzzerUrl,
  parseFamilyFeudControllerFragment,
  type FamilyFeudControllerInvitePayload,
} from "./family-feud-invite";
import { familyFeudBrowserKeys } from "./family-feud-keys";
import { FAMILY_FEUD_PHASE_LABELS } from "./family-feud-rules";
import {
  applyFamilyFeudControllerActionFn,
  pairFamilyFeudControllerFn,
} from "./family-feud-room.functions";
import type { FamilyFeudClaimDisplay, FamilyFeudControllerAction, FamilyFeudTeamId } from "./types";
import { useFamilyFeudRoom } from "./useFamilyFeudRoom";
import { useFamilyFeudCountdown } from "./useFamilyFeudCountdown";

interface ControllerSession {
  controllerToken: string;
  buzzerToken: string;
  buzzerTokens?: Record<FamilyFeudTeamId, string>;
}

interface PendingControllerPairing extends FamilyFeudControllerInvitePayload {
  controllerToken: string;
}

type ControllerActionInput = MultiplayerActionInput<FamilyFeudControllerAction>;

function readControllerSession(roomId: string): ControllerSession | null {
  try {
    const current = JSON.parse(
      sessionStorage.getItem(familyFeudBrowserKeys.controllerSession(roomId)) ?? "null",
    ) as ControllerSession | null;
    if (current?.controllerToken && current.buzzerToken) return current;
  } catch {
    removeStorageKeys(sessionStorage, [familyFeudBrowserKeys.controllerSession(roomId)]);
  }
  return readExpiringLocalValue<ControllerSession>(familyFeudBrowserKeys.controllerSession(roomId));
}

function readPendingControllerPairing(roomId: string) {
  return readExpiringLocalValue<PendingControllerPairing>(
    familyFeudBrowserKeys.controllerPairing(roomId),
  );
}

function PrimaryButton({
  disabled,
  children,
  onClick,
}: {
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-16 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-semibold text-black transition-opacity hover:opacity-85 disabled:opacity-35"
    >
      {children}
    </button>
  );
}

export function FamilyFeudControllerApp({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<ControllerSession | null>(null);
  const [pairing, setPairing] = useState(true);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [buzzerOpen, setBuzzerOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [houseAnswer, setHouseAnswer] = useState("");
  const [endConfirm, setEndConfirm] = useState(false);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const cardSwipeStart = useRef<number | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const fragment = consumeLocationFragment();
    const invite = parseFamilyFeudControllerFragment(fragment);
    const existing = readControllerSession(roomId);
    const pairing = invite
      ? {
          ...invite,
          controllerToken: createMultiplayerBrowserCredential(),
        }
      : existing
        ? null
        : readPendingControllerPairing(roomId);
    if (invite && pairing)
      writeExpiringLocalValue(
        familyFeudBrowserKeys.controllerPairing(roomId),
        pairing,
        pairing.expiresAt,
      );
    if (!pairing && existing) {
      removeStorageKeys(localStorage, [familyFeudBrowserKeys.controllerPairing(roomId)]);
      setSession(existing);
      setPairing(false);
      return;
    }
    if (!pairing) {
      setPairingError("Scan the controller code on the Family Feud screen.");
      setPairing(false);
      return;
    }
    void pairFamilyFeudControllerFn({
      data: {
        roomId,
        pairingToken: pairing.token,
        controllerToken: pairing.controllerToken,
      },
    })
      .then((result) => {
        if (!result.ok) {
          if (existing) {
            removeStorageKeys(localStorage, [familyFeudBrowserKeys.controllerPairing(roomId)]);
            setSession(existing);
            return;
          }
          setPairingError(result.error);
          return;
        }
        const next = {
          controllerToken: result.controllerToken,
          buzzerToken: pairing.buzzerToken,
          buzzerTokens: pairing.buzzerTokens,
        };
        writeExpiringLocalValue(
          familyFeudBrowserKeys.controllerSession(roomId),
          next,
          result.expiresAt,
        );
        try {
          sessionStorage.setItem(
            familyFeudBrowserKeys.controllerSession(roomId),
            JSON.stringify(next),
          );
        } catch {
          // The expiring local recovery above is enough when session storage is unavailable.
        }
        removeStorageKeys(localStorage, [familyFeudBrowserKeys.controllerPairing(roomId)]);
        setSession(next);
      })
      .catch(() => {
        if (existing) {
          removeStorageKeys(localStorage, [familyFeudBrowserKeys.controllerPairing(roomId)]);
          setSession(existing);
        } else setPairingError("Could not pair this phone. Check the connection and rescan.");
      })
      .finally(() => setPairing(false));
  }, [roomId]);
  const live = useFamilyFeudRoom({
    roomId,
    role: "controller",
    credential: session?.controllerToken ?? "",
  });
  const snapshot = live.snapshot;
  const setLiveSnapshot = live.setSnapshot;
  const notifyLiveRoom = live.notify;
  const dispatchControllerAction = useReliableMultiplayerAction(
    (action: ControllerActionInput, actionId) =>
      applyFamilyFeudControllerActionFn({
        data: {
          roomId,
          controllerToken: session?.controllerToken ?? "",
          action: { ...action, actionId } as FamilyFeudControllerAction,
        },
      }),
    `${roomId}:controller:${snapshot?.sequence ?? "loading"}`,
  );
  const send = useCallback(
    async (action: ControllerActionInput) => {
      if (!session || busyRef.current) return null;
      unlockFamilyFeudAudio();
      busyRef.current = true;
      setBusy(true);
      setMessage(null);
      try {
        const result = await dispatchControllerAction(action);
        if (result.snapshot) setLiveSnapshot(result.snapshot);
        if (!result.accepted) setMessage(result.error ?? "That action is not ready.");
        else notifyLiveRoom();
        return result;
      } catch {
        setMessage("Reconnecting… try that once more.");
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [dispatchControllerAction, notifyLiveRoom, session, setLiveSnapshot],
  );
  const buzzerInvites = useMemo(() => {
    if (!session || !snapshot || typeof location === "undefined") return null;
    const tokens = session.buzzerTokens ?? {
      one: session.buzzerToken,
      two: session.buzzerToken,
    };
    return {
      one: familyFeudBuzzerUrl(location.origin, roomId, {
        token: tokens.one,
        teamId: "one",
        expiresAt: snapshot.expiresAt,
      }),
      two: familyFeudBuzzerUrl(location.origin, roomId, {
        token: tokens.two,
        teamId: "two",
        expiresAt: snapshot.expiresAt,
      }),
    };
  }, [roomId, session, snapshot]);
  const buzzerOneQr = useQrCode(buzzerOpen ? (buzzerInvites?.one ?? null) : null, 280);
  const buzzerTwoQr = useQrCode(buzzerOpen ? (buzzerInvites?.two ?? null) : null, 280);
  const round = snapshot?.round;
  const remaining = useFamilyFeudCountdown(
    round?.phaseEndsAt ?? 0,
    live.clockOffset,
    round?.paused ?? false,
    round?.pausedRemainingMs ?? 0,
  );

  useEffect(() => {
    if (!claimToken || !snapshot?.claimDisplay) return;
    const display = snapshot.claimDisplay;
    let active = true;
    let inFlight = false;
    let lastStartedAt = 0;
    const poll = async () => {
      const now = Date.now();
      if (!active || inFlight || now - lastStartedAt < 2_500) return;
      inFlight = true;
      lastStartedAt = now;
      try {
        const response = await fetch(
          `/api/events/${encodeURIComponent(new URL(display.claimUrl).pathname.split("/")[2] ?? "")}/game-results/group-claims`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ operation: "preview", token: claimToken }),
          },
        );
        if (!active) return;
        if (response.status >= 400 && response.status < 500) {
          active = false;
          setClaimToken(null);
          setMessage("That team claim expired. Stop the QR and open a fresh one.");
          return;
        }
        if (!response.ok) return;
        const current = (await response.json()) as { claimed?: number };
        if (typeof current.claimed !== "number" || current.claimed === display.claimed) return;
        void send({ type: "claim.display", display: { ...display, claimed: current.claimed } });
      } catch {
        // Network and server failures are transient; the next bounded poll reconciles the count.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [claimToken, send, snapshot?.claimDisplay]);

  if (pairing)
    return (
      <div
        className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"
        aria-busy="true"
      >
        <p className="font-mono text-sm text-white/50">pairing controller…</p>
      </div>
    );
  if (!session)
    return (
      <div className="things-game things-game--night flex items-center justify-center px-6 text-center text-white">
        <main className="max-w-md">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
            Family Feud controller
          </p>
          <h1 className="mt-4 font-serif text-4xl">This phone is not paired.</h1>
          <p className="mt-4 text-white/55">{pairingError}</p>
          <p className="mt-7 font-mono text-xs text-white/40">Room {roomId}</p>
        </main>
      </div>
    );
  if (!snapshot)
    return (
      <div
        className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"
        aria-busy="true"
      >
        <p className="font-mono text-sm text-white/50">{live.message ?? "opening controls…"}</p>
      </div>
    );

  const activeTeam = round
    ? snapshot.teams.find(({ id }) => id === round.activeTeamId)!
    : snapshot.teams[0];
  const stealingTeam = round
    ? snapshot.teams.find(({ id }) => id !== round.activeTeamId)!
    : snapshot.teams[1];
  const faceoffTeam = round?.faceoffTeamId
    ? snapshot.teams.find(({ id }) => id === round.faceoffTeamId)!
    : null;
  const answerPhase = ["practice", "faceoff", "main", "steal"].includes(snapshot.phase);
  const tied = snapshot.teams[0].score === snapshot.teams[1].score;
  const houseAnswerAvailable =
    ["main", "steal"].includes(snapshot.phase) ||
    (snapshot.phase === "faceoff" && Boolean(faceoffTeam));
  const primary: { label: string; action: ControllerActionInput } | null =
    snapshot.phase === "lobby"
      ? { label: "start game", action: { type: "game.start" } }
      : snapshot.phase === "rules"
        ? { label: "start practice", action: { type: "phase.advance" } }
        : snapshot.phase === "practice"
          ? { label: "finish practice", action: { type: "phase.advance" } }
          : snapshot.phase === "round-intro"
            ? null
            : snapshot.phase === "category"
              ? { label: "open buzzers", action: { type: "faceoff.open" } }
              : snapshot.phase === "main-ready"
                ? {
                    label: `start ${snapshot.mainSeconds} seconds`,
                    action: { type: "phase.advance" },
                  }
                : snapshot.phase === "main"
                  ? { label: "end main answers", action: { type: "phase.advance" } }
                  : snapshot.phase === "steal-ready"
                    ? {
                        label: `start ${snapshot.stealSeconds}-second steal`,
                        action: { type: "phase.advance" },
                      }
                    : snapshot.phase === "round-reveal"
                      ? { label: "show round score", action: { type: "phase.advance" } }
                      : snapshot.phase === "round-score"
                        ? {
                            label:
                              round && round.number >= snapshot.rounds
                                ? "finish game"
                                : "next team and round",
                            action: { type: "phase.advance" },
                          }
                        : null;

  const openClaim = async (teamId: FamilyFeudTeamId) => {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("preparing secure team claim…");
    try {
      const opened = await openFamilyFeudTeamClaimSessionFn({
        data: { roomId, controllerToken: session.controllerToken, teamId },
      });
      if (!opened.ok) {
        setMessage(opened.error);
        return;
      }
      const claimUrl = new URL(opened.value.claimPath, location.origin).toString();
      const token = new URL(claimUrl).hash
        ? new URLSearchParams(new URL(claimUrl).hash.slice(1)).get("claim")
        : null;
      setClaimToken(token);
      const display: FamilyFeudClaimDisplay = {
        sessionId: opened.value.id,
        teamId,
        teamName: opened.value.groupName,
        points: opened.value.points,
        claimed: opened.value.claimed,
        maximumClaims: opened.value.maximumClaims,
        claimUrl,
        expiresAt: opened.value.expiresAt,
      };
      const result = await dispatchControllerAction({ type: "claim.display", display });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.accepted) setMessage(result.error ?? "Could not show that claim.");
      else {
        live.notify();
        setMessage(`${opened.value.groupName} can scan the TV now.`);
      }
    } catch {
      setMessage("Could not open the team claim. Try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const closeClaim = async () => {
    const current = snapshot.claimDisplay;
    if (!current || !session || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    await closeFamilyFeudTeamClaimSessionFn({
      data: {
        roomId,
        controllerToken: session.controllerToken,
        sessionId: current.sessionId,
      },
    }).catch(() => null);
    await dispatchControllerAction({ type: "claim.display", display: null })
      .then((result) => {
        if (result.snapshot) live.setSnapshot(result.snapshot);
        live.notify();
      })
      .catch(() => undefined);
    setClaimToken(null);
    busyRef.current = false;
    setBusy(false);
  };

  return (
    <div className="things-game things-game--night text-white">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/10 bg-[var(--things-night)] px-4 py-2 font-mono text-[11px] text-white/45">
        <span>MC · {roomId}</span>
        <span>{live.connectionState}</span>
        <button
          type="button"
          onClick={() => setBuzzerOpen((open) => !open)}
          className="min-h-11 px-2"
        >
          buzzer QR
        </button>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-4 pb-32 pt-5 sm:px-6">
        {buzzerOpen ? (
          <section
            className="mb-7 rounded-2xl border border-white/12 p-5 text-center"
            aria-label="Optional team buzzers"
          >
            <h2 className="font-serif text-2xl">Optional team buzzers</h2>
            <p className="mt-2 text-sm text-white/50">
              Give each team its own phone. The MC buttons still work if you skip this.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {snapshot.teams.map((team) => {
                const invite = buzzerInvites?.[team.id];
                const qr = team.id === "one" ? buzzerOneQr : buzzerTwoQr;
                return (
                  <div key={team.id} className="rounded-2xl border border-white/12 p-3">
                    <div className="font-serif text-lg">
                      <FamilyFeudTeamMark team={team} />
                    </div>
                    <div className="mx-auto mt-3 w-fit rounded-xl bg-white p-2">
                      {qr.dataUrl ? (
                        <img
                          src={qr.dataUrl}
                          alt={`QR code for ${team.name}'s Family Feud buzzer`}
                          className="h-44 w-44"
                        />
                      ) : (
                        <div className="h-44 w-44 animate-pulse bg-black/5" />
                      )}
                    </div>
                    {invite ? (
                      <a
                        href={invite}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex min-h-11 items-center font-mono text-[11px] text-white/35 underline decoration-white/20 underline-offset-4"
                      >
                        open this buzzer
                      </a>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--things-amber)]">
              {FAMILY_FEUD_PHASE_LABELS[snapshot.phase]}
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold">
              {snapshot.phase === "finished"
                ? "Check the final score."
                : snapshot.phase === "round-intro"
                  ? `Choose the card for round ${round?.number ?? ""}.`
                  : (round?.prompt ?? "You run the room.")}
            </h1>
          </div>
          {round?.phaseEndsAt || round?.paused ? (
            <span className="shrink-0 font-mono text-4xl tabular-nums text-[var(--things-amber)]">
              {round.paused ? `Ⅱ ${remaining}` : remaining}
            </span>
          ) : null}
        </div>
        <div className="mt-5">
          <FamilyFeudScoreboard snapshot={snapshot} />
        </div>
        {round && !["practice", "finished"].includes(snapshot.phase) ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-xs text-white/50">
            <span>
              round {round.number}/{round.total}
            </span>
            <span>·</span>
            <FamilyFeudTeamMark team={activeTeam} compact />
            <span>has the main round</span>
          </div>
        ) : null}

        {round && snapshot.phase === "round-intro" ? (
          <section
            className="mt-7 touch-pan-y rounded-2xl border border-white/15 p-5"
            aria-label={`Choose card for round ${round.number}`}
            onTouchStart={(event) => {
              cardSwipeStart.current = event.changedTouches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              const start = cardSwipeStart.current;
              const end = event.changedTouches[0]?.clientX;
              cardSwipeStart.current = null;
              if (start === null || end === undefined || Math.abs(end - start) < 50) return;
              void send({ type: end < start ? "card.next" : "card.previous" });
            }}
          >
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-[var(--things-amber)]">
              Round {round.number} · {round.deckName ?? "Custom deck"}
            </p>
            <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight">
              “{round.prompt}”
            </h2>
            <div className="mt-6">
              <FamilyFeudAnswerBoard
                answers={round.answers}
                houseAnswers={[]}
                activeTeamId={round.activeTeamId}
                privateAnswers
              />
            </div>
            <div className="mt-4 border-t border-white/10 pt-4">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
                accepted alternative wording
              </h3>
              {round.answers.some((answer) => answer.aliases?.length) ? (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {round.answers
                    .filter((answer) => answer.aliases?.length)
                    .map((answer) => (
                      <p key={answer.id} className="font-mono text-[11px] text-white/45">
                        {answer.position}. {answer.aliases?.join(" · ")}
                      </p>
                    ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/40">
                  No preset alternatives. The MC can still accept a sensible house answer.
                </p>
              )}
            </div>
            <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <button
                type="button"
                disabled={busy || (round.candidateTotal ?? 0) < 2}
                onClick={() => void send({ type: "card.previous" })}
                className="min-h-12 rounded-full border border-white/15 font-mono text-xs disabled:opacity-35"
                aria-label="Previous card"
              >
                ← previous
              </button>
              <span className="font-mono text-xs tabular-nums text-white/40">
                {round.candidatePosition ?? 1}/{round.candidateTotal ?? 1}
              </span>
              <button
                type="button"
                disabled={busy || (round.candidateTotal ?? 0) < 2}
                onClick={() => void send({ type: "card.next" })}
                className="min-h-12 rounded-full border border-white/15 font-mono text-xs disabled:opacity-35"
                aria-label="Next card"
              >
                next →
              </button>
            </div>
            <div className="mt-4">
              <PrimaryButton disabled={busy} onClick={() => void send({ type: "card.use" })}>
                use this card
              </PrimaryButton>
            </div>
            <p className="mt-3 text-center font-mono text-[11px] text-white/35">
              Swipe or use the arrows. The TV only sees that round {round.number} is coming up.
            </p>
          </section>
        ) : null}

        {round &&
        ["category", "faceoff", "main-ready", "main", "steal-ready", "steal"].includes(
          snapshot.phase,
        ) &&
        !round.answers.some(({ revealed }) => revealed) &&
        !round.houseAnswers.length ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ type: "round.replace" })}
            className="mt-4 min-h-11 font-mono text-xs text-white/40"
          >
            emergency: replace round
          </button>
        ) : null}

        {snapshot.phase === "faceoff" && !faceoffTeam ? (
          <section className="mt-7">
            <h2 className="font-mono text-xs text-white/45">
              No buzzer phone? Tap who shouted first.
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {snapshot.teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void send({ type: "faceoff.claim", teamId: team.id })}
                  className="min-h-20 rounded-2xl border border-white/15 p-4 font-serif text-lg"
                >
                  <FamilyFeudTeamMark team={team} />
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {snapshot.phase === "faceoff" && faceoffTeam ? (
          <div className="mt-6 rounded-2xl border border-[var(--things-amber)]/40 p-4">
            <p className="text-balance font-serif text-xl leading-snug">
              <FamilyFeudTeamMark team={faceoffTeam} /> <span>answers now</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ type: "faceoff.miss" })}
              className="mt-3 min-h-12 w-full rounded-full border border-white/18 font-mono text-xs"
            >
              no match · other team
            </button>
          </div>
        ) : null}
        {snapshot.phase === "steal" ? (
          <div className="mt-6 rounded-2xl border border-[var(--things-frost)]/40 p-4">
            <p className="text-balance font-serif text-xl leading-snug">
              <FamilyFeudTeamMark team={stealingTeam} /> <span>has one answer</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ type: "steal.miss" })}
              className="mt-3 min-h-12 w-full rounded-full border border-white/18 font-mono text-xs"
            >
              no match · reveal board
            </button>
          </div>
        ) : null}
        {round && answerPhase ? (
          <div className="mt-7">
            <h2 className="mb-3 font-mono text-xs text-white/45">
              {snapshot.phase === "faceoff" && !faceoffTeam
                ? "Choose who buzzed first; answers unlock after that."
                : "Tap the accepted answer. Aliases are shown underneath."}
            </h2>
            <FamilyFeudAnswerBoard
              answers={round.answers}
              houseAnswers={round.houseAnswers}
              activeTeamId={round.activeTeamId}
              privateAnswers
              onAnswer={
                snapshot.phase !== "faceoff" || faceoffTeam
                  ? (answer) => void send({ type: "answer.reveal", answerId: answer.id })
                  : undefined
              }
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {round.answers
                .filter((answer) => !answer.revealed && answer.aliases?.length)
                .map((answer) => (
                  <p key={answer.id} className="px-3 font-mono text-[11px] text-white/35">
                    {answer.position}. {answer.aliases?.join(" · ")}
                  </p>
                ))}
            </div>
          </div>
        ) : null}

        {snapshot.phase === "finished" ? (
          <section className="mt-8">
            {!snapshot.resultConfirmed ? (
              <div className="rounded-2xl border border-[var(--things-amber)]/35 p-5">
                {tied ? (
                  <>
                    <h2 className="font-serif text-2xl">The scores are tied.</h2>
                    <p className="mt-2 text-sm text-white/50">
                      Run one sudden-death face-off. The first accepted answer wins the game.
                    </p>
                    <PrimaryButton
                      disabled={busy}
                      onClick={() => void send({ type: "sudden-death.start" })}
                    >
                      start sudden death
                    </PrimaryButton>
                  </>
                ) : (
                  <>
                    <h2 className="font-serif text-2xl">Confirm before points move.</h2>
                    <p className="mt-2 text-sm text-white/50">
                      Use the score tools below if anything needs fixing. Confirmation locks this
                      result.
                    </p>
                    <PrimaryButton
                      disabled={busy}
                      onClick={() => void send({ type: "result.confirm" })}
                    >
                      confirm final result
                    </PrimaryButton>
                  </>
                )}
              </div>
            ) : snapshot.eventScoring ? (
              <div>
                <h2 className="font-serif text-3xl">Team point claims</h2>
                <p className="mt-2 text-sm text-white/50">
                  Show one team at a time. Their QR expires after ten minutes and never contains
                  points itself.
                </p>
                {snapshot.claimDisplay ? (
                  <div className="mt-5 rounded-2xl border border-white/15 p-5">
                    <p className="font-serif text-xl">Showing {snapshot.claimDisplay.teamName}</p>
                    <p className="mt-2 font-mono text-sm tabular-nums text-white/50">
                      {snapshot.claimDisplay.claimed}/{snapshot.claimDisplay.maximumClaims} claimed
                      · +{snapshot.claimDisplay.points} each
                    </p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void closeClaim()}
                      className="mt-4 min-h-12 w-full rounded-full border border-white/18 font-mono text-xs"
                    >
                      stop showing QR
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {snapshot.teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        disabled={busy}
                        onClick={() => void openClaim(team.id)}
                        className="min-h-24 rounded-2xl border border-white/15 p-4 text-left"
                      >
                        <FamilyFeudTeamMark team={team} />
                        <span className="mt-2 block font-mono text-xs text-white/45">
                          show claim QR · max {team.playerCount}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="font-mono text-sm text-white/50">
                Result confirmed. This standalone game does not award event points.
              </p>
            )}
            {snapshot.resultConfirmed && !snapshot.claimDisplay ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void send({ type: "game.replay" })}
                className="mt-7 min-h-12 w-full rounded-full border border-white/18 font-mono text-xs"
              >
                play again with the same teams
              </button>
            ) : null}
          </section>
        ) : primary ? (
          <div className="sticky bottom-4 z-10 mt-8 rounded-[2rem] bg-[var(--things-night)]/95 p-2 shadow-2xl backdrop-blur">
            <PrimaryButton disabled={busy} onClick={() => void send(primary.action)}>
              {primary.label}
            </PrimaryButton>
          </div>
        ) : null}

        {!snapshot.resultConfirmed ? (
          <section className="mt-10 border-t border-white/12 pt-5">
            <button
              type="button"
              onClick={() => setToolsOpen((open) => !open)}
              aria-expanded={toolsOpen}
              className="flex min-h-11 w-full items-center justify-between font-mono text-xs text-white/50"
            >
              <span>fix, pause or end</span>
              <span>{toolsOpen ? "−" : "+"}</span>
            </button>
            {toolsOpen ? (
              <div className="mt-4 space-y-6">
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={busy || !round || (!round.phaseEndsAt && !round.paused)}
                    onClick={() =>
                      void send({ type: round?.paused ? "timer.resume" : "timer.pause" })
                    }
                    className="min-h-11 rounded-full border border-white/15 font-mono text-xs"
                  >
                    {round?.paused ? "resume" : "pause"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !round || (!round.phaseEndsAt && !round.paused)}
                    onClick={() => void send({ type: "timer.reset" })}
                    className="min-h-11 rounded-full border border-white/15 font-mono text-xs"
                  >
                    reset timer
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void send({ type: "undo.last" })}
                    className="min-h-11 rounded-full border border-white/15 font-mono text-xs"
                  >
                    undo score
                  </button>
                </div>
                <div>
                  <h2 className="font-mono text-xs text-white/45">adjust score</h2>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {snapshot.teams.map((team) => (
                      <div key={team.id} className="rounded-xl border border-white/12 p-3">
                        <FamilyFeudTeamMark team={team} compact />
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {[-1, 1].map((points) => (
                            <button
                              key={points}
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                void send({ type: "score.adjust", teamId: team.id, points })
                              }
                              className="min-h-11 rounded-full border border-white/15 font-mono text-xs"
                            >
                              {points > 0 ? "+1" : "−1"}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {round && houseAnswerAvailable ? (
                  <div>
                    <h2 className="font-mono text-xs text-white/45">accepted house answer</h2>
                    <p className="mt-2 text-xs text-white/40">
                      Existing matches open their ranked tile. A genuinely new answer is worth
                      {snapshot.phase === "steal" ? " 2 points during this steal." : " 1 point."}
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!houseAnswer.trim()) return;
                        void send({ type: "house-answer.add", label: houseAnswer }).then(
                          (result) => {
                            if (result?.accepted) setHouseAnswer("");
                          },
                        );
                      }}
                      className="mt-2 flex gap-2"
                    >
                      <input
                        value={houseAnswer}
                        onChange={(event) => setHouseAnswer(event.target.value)}
                        maxLength={56}
                        placeholder="what they said"
                        aria-label="Accepted house answer"
                        className="min-h-12 min-w-0 flex-1 rounded-full border border-white/15 bg-white/[0.04] px-4"
                      />
                      <button
                        type="submit"
                        disabled={busy || !houseAnswer.trim()}
                        className="min-h-12 rounded-full border border-white/18 px-4 font-mono text-xs"
                      >
                        judge answer
                      </button>
                    </form>
                  </div>
                ) : null}
                <div className="border-t border-white/10 pt-5 text-sm text-white/50">
                  <h2 className="font-mono text-xs text-white/45">scoring reminder</h2>
                  <p className="mt-2">
                    Ranked tiles score 10 down to 1. A successful steal doubles that tile. A new
                    house answer scores 1, or 2 on a steal. Nobody loses points for a miss.
                  </p>
                </div>
                {round?.answers.some(({ revealed }) => revealed) ? (
                  <div>
                    <h2 className="font-mono text-xs text-white/45">revealed answers</h2>
                    <div className="mt-2 space-y-2">
                      {round.answers
                        .filter(({ revealed }) => revealed)
                        .map((answer) => (
                          <div
                            key={answer.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-white/12 p-3"
                          >
                            <span className="truncate font-serif">{answer.label}</span>
                            <div className="flex shrink-0 gap-2 font-mono text-[11px]">
                              {answer.awardedTeamId ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void send({
                                      type: "answer.reassign",
                                      answerId: answer.id,
                                      teamId: answer.awardedTeamId === "one" ? "two" : "one",
                                    })
                                  }
                                  className="min-h-11 px-2"
                                >
                                  move
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() =>
                                  void send({ type: "answer.hide", answerId: answer.id })
                                }
                                className="min-h-11 px-2"
                              >
                                {["round-reveal", "round-score", "finished"].includes(
                                  snapshot.phase,
                                )
                                  ? "remove points"
                                  : "hide"}
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : null}
                {snapshot.phase !== "finished" ? (
                  endConfirm ? (
                    <div className="rounded-xl border border-white/18 p-4">
                      <p className="text-sm text-white/60">
                        End now and use the current scores as the final result?
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEndConfirm(false)}
                          className="min-h-11 rounded-full border border-white/15 font-mono text-xs"
                        >
                          keep playing
                        </button>
                        <button
                          type="button"
                          onClick={() => void send({ type: "game.end" })}
                          className="min-h-11 rounded-full border border-white/15 font-mono text-xs"
                        >
                          end game
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEndConfirm(true)}
                      className="min-h-11 font-mono text-xs text-white/40"
                    >
                      end game early
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
        <p
          aria-live="polite"
          className="mt-5 min-h-5 text-center font-mono text-xs text-[var(--things-amber)]"
        >
          {message ?? live.message}
        </p>
        <div className="mt-7 text-center">
          <Link
            to="/things/family-feud"
            className="inline-flex min-h-11 items-center font-mono text-xs text-white/35"
          >
            leave controls
          </Link>
        </div>
      </main>
    </div>
  );
}
