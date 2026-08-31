import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { useQrCode } from "@/hooks/useQrCode";
import { useWakeLock } from "@/hooks/useWakeLock";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import {
  readExpiringLocalValue,
  removeStorageKeys,
  writeExpiringLocalValue,
} from "../shared/game-storage.client";
import { useFullscreen } from "../shared/useFullscreen";
import { playFamilyFeudSound, unlockFamilyFeudAudio } from "./family-feud-audio.client";
import { FamilyFeudAnswerBoard, FamilyFeudScoreboard, FamilyFeudTeamMark } from "./FamilyFeudBoard";
import { familyFeudControllerUrl, parseFamilyFeudPresenterFragment } from "./family-feud-invite";
import { familyFeudBrowserKeys } from "./family-feud-keys";
import { FAMILY_FEUD_PHASE_LABELS } from "./family-feud-rules";
import type { FamilyFeudTeamId } from "./types";
import { useFamilyFeudRoom } from "./useFamilyFeudRoom";
import { useFamilyFeudCountdown } from "./useFamilyFeudCountdown";

interface PresenterSession {
  presenterToken: string;
  controllerPairingToken: string;
  buzzerToken: string;
  buzzerTokens?: Record<FamilyFeudTeamId, string>;
}

function loadPresenterSession(roomId: string): PresenterSession | null {
  const fragment = consumeLocationFragment();
  if (fragment) {
    const invite = parseFamilyFeudPresenterFragment(fragment);
    if (invite) {
      const session = {
        presenterToken: invite.token,
        controllerPairingToken: invite.controllerPairingToken,
        buzzerToken: invite.buzzerToken,
        buzzerTokens: invite.buzzerTokens,
      };
      try {
        sessionStorage.setItem(
          familyFeudBrowserKeys.presenterSession(roomId),
          JSON.stringify(session),
        );
      } catch {
        // The local expiring recovery below is enough when session storage is unavailable.
      }
      writeExpiringLocalValue(
        familyFeudBrowserKeys.presenterRecovery(roomId),
        session,
        invite.expiresAt,
      );
      return session;
    }
  }
  try {
    const stored = JSON.parse(
      sessionStorage.getItem(familyFeudBrowserKeys.presenterSession(roomId)) ?? "null",
    ) as PresenterSession | null;
    if (stored?.presenterToken) return stored;
  } catch {
    removeStorageKeys(sessionStorage, [familyFeudBrowserKeys.presenterSession(roomId)]);
  }
  return readExpiringLocalValue<PresenterSession>(familyFeudBrowserKeys.presenterRecovery(roomId));
}

function Timer({
  endsAt,
  paused,
  pausedRemainingMs,
  offset,
}: {
  endsAt: number;
  paused: boolean;
  pausedRemainingMs: number;
  offset: number;
}) {
  const remaining = useFamilyFeudCountdown(endsAt, offset, paused, pausedRemainingMs);
  if (!endsAt && !paused) return null;
  return (
    <div
      className={`font-mono text-5xl font-semibold tabular-nums sm:text-7xl ${remaining <= 5 ? "text-[var(--things-amber)]" : "text-white"}`}
      aria-label={
        paused ? `Timer paused at ${remaining} seconds` : `${remaining} seconds remaining`
      }
    >
      {paused ? `PAUSED · ${remaining}` : remaining}
    </div>
  );
}

export function FamilyFeudPresenterApp({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<PresenterSession | null>(null);
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const fullscreen = useFullscreen();
  useEffect(() => {
    setSession(loadPresenterSession(roomId));
    try {
      setMuted(localStorage.getItem(familyFeudBrowserKeys.muted()) === "1");
    } catch {
      setMuted(false);
    }
    setReady(true);
  }, [roomId]);
  const live = useFamilyFeudRoom({
    roomId,
    role: "presenter",
    credential: session?.presenterToken ?? "",
  });
  const snapshot = live.snapshot;
  useWakeLock(Boolean(snapshot) && snapshot?.phase !== "finished");
  const controllerInvite = useMemo(() => {
    if (!session || typeof location === "undefined") return null;
    return familyFeudControllerUrl(location.origin, roomId, {
      token: session.controllerPairingToken,
      buzzerToken: session.buzzerToken,
      buzzerTokens: session.buzzerTokens ?? {
        one: session.buzzerToken,
        two: session.buzzerToken,
      },
      expiresAt: snapshot?.expiresAt ?? Date.now() + 60_000,
    });
  }, [roomId, session, snapshot?.expiresAt]);
  const controllerQr = useQrCode(controllerInvite, 360);
  const claimQr = useQrCode(snapshot?.claimDisplay?.claimUrl ?? null, 460);
  const priorCue = useRef<string | null>(null);
  useEffect(() => {
    const next = snapshot?.cue;
    if (!next || next.id === priorCue.current) return;
    priorCue.current = next.id;
    if (audioEnabled) playFamilyFeudSound(next.kind, muted);
  }, [audioEnabled, muted, snapshot?.cue]);
  useEffect(() => {
    if (!snapshot?.round?.phaseEndsAt || snapshot.round.paused || muted || !audioEnabled) return;
    const remaining = snapshot.round.phaseEndsAt - (Date.now() + live.clockOffset);
    if (remaining <= 0) return;
    const timers = [5, 4, 3, 2, 1]
      .map((seconds) => remaining - seconds * 1_000)
      .filter((delay) => delay >= 0)
      .map((delay) => window.setTimeout(() => playFamilyFeudSound("timer", muted), delay));
    return () => timers.forEach(window.clearTimeout);
  }, [
    audioEnabled,
    live.clockOffset,
    muted,
    snapshot?.round?.paused,
    snapshot?.round?.phaseEndsAt,
  ]);

  if (!ready) return <div className="things-game things-game--night" aria-busy="true" />;
  if (!session)
    return (
      <div className="things-game things-game--night flex items-center justify-center px-6 text-center text-white">
        <main className="max-w-lg">
          <h1 className="font-serif text-4xl">This screen link has expired.</h1>
          <p className="mt-4 text-white/55">
            Create a fresh Family Feud room from the setup screen.
          </p>
          <Link
            to="/things/family-feud"
            className="mt-8 inline-flex min-h-12 items-center rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm text-black"
          >
            return to setup
          </Link>
        </main>
      </div>
    );
  if (!snapshot)
    return (
      <div
        className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"
        aria-busy="true"
      >
        <p className="font-mono text-sm text-white/50">{live.message ?? "opening the room…"}</p>
      </div>
    );

  const round = snapshot.round;
  const activeTeam = round
    ? snapshot.teams.find(({ id }) => id === round.activeTeamId)!
    : snapshot.teams[0];
  const faceoffTeam = round?.faceoffTeamId
    ? snapshot.teams.find(({ id }) => id === round.faceoffTeamId)!
    : null;
  const winnerNames = snapshot.winnerTeamIds
    .map((id) => snapshot.teams.find((team) => team.id === id)!.name)
    .join(" and ");

  return (
    <div ref={fullscreen.targetRef} className="things-game-fullscreen">
      <div className="things-game things-game--night min-h-screen text-white">
        <header className="flex items-center justify-between gap-3 px-5 py-3 font-mono text-[11px] text-white/45 sm:px-7">
          <span>Family Feud · {roomId}</span>
          <div className="flex items-center gap-3">
            <span>{live.connectionState}</span>
            <button
              type="button"
              onClick={() => {
                unlockFamilyFeudAudio();
                if (!audioEnabled) {
                  setAudioEnabled(true);
                  setMuted(false);
                  removeStorageKeys(localStorage, [familyFeudBrowserKeys.muted()]);
                  return;
                }
                const nextMuted = !muted;
                setMuted(nextMuted);
                try {
                  localStorage.setItem(familyFeudBrowserKeys.muted(), nextMuted ? "1" : "0");
                } catch {
                  // Sound still changes for this session when preferences cannot be persisted.
                }
              }}
              className="min-h-11 px-2"
              aria-label={
                !audioEnabled ? "Enable game sounds" : muted ? "Turn game sounds on" : "Mute sounds"
              }
            >
              {!audioEnabled ? "enable sound" : muted ? "sound off" : "sound on"}
            </button>
            {fullscreen.supported ? (
              <button
                type="button"
                onClick={() => void fullscreen.toggle()}
                className="min-h-11 px-2"
              >
                {fullscreen.active ? "exit full" : "full screen"}
              </button>
            ) : null}
          </div>
        </header>

        {!snapshot.controllerConnected && snapshot.phase !== "lobby" ? (
          <aside
            className="mx-5 flex flex-col items-center justify-between gap-4 rounded-2xl border border-[var(--things-amber)]/35 bg-[var(--things-night)] p-4 text-center sm:mx-7 sm:flex-row sm:text-left"
            aria-live="polite"
          >
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--things-amber)]">
                MC disconnected
              </p>
              <p className="mt-2 font-serif text-xl">
                Scan to reclaim the controls. The current game is safe.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="rounded-xl bg-white p-2">
                {controllerQr.dataUrl ? (
                  <img
                    src={controllerQr.dataUrl}
                    alt="QR code to recover the Family Feud MC controls"
                    className="h-28 w-28"
                  />
                ) : (
                  <div className="h-28 w-28 animate-pulse bg-black/5" />
                )}
              </div>
              {controllerInvite ? (
                <a
                  href={controllerInvite}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center font-mono text-[11px] text-white/40 underline decoration-white/20 underline-offset-4"
                >
                  open controls
                </a>
              ) : null}
            </div>
          </aside>
        ) : null}

        {snapshot.claimDisplay ? (
          <main id="main" className="flex flex-1 items-center justify-center px-6 py-8 text-center">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
                {snapshot.claimDisplay.teamName} · event points
              </p>
              <h1 className="mt-4 font-serif text-5xl font-semibold sm:text-7xl">
                Scan to claim +{snapshot.claimDisplay.points}
              </h1>
              <p className="mt-4 text-lg text-white/55">
                Only people who played on this team should scan. One claim per person for this
                match.
              </p>
              <div className="mx-auto mt-8 w-fit rounded-3xl bg-white p-4">
                {claimQr.dataUrl ? (
                  <img
                    src={claimQr.dataUrl}
                    alt={`QR code to claim points for ${snapshot.claimDisplay.teamName}`}
                    className="h-[min(54vw,23rem)] w-[min(54vw,23rem)]"
                  />
                ) : (
                  <div className="h-80 w-80 animate-pulse bg-black/5" aria-label="Making QR code" />
                )}
              </div>
              <p className="mt-5 font-mono text-sm tabular-nums text-white/55">
                {snapshot.claimDisplay.claimed}/{snapshot.claimDisplay.maximumClaims} claimed · MC
                can hide this at any time
              </p>
            </div>
          </main>
        ) : snapshot.phase === "lobby" ? (
          <main id="main" className="flex flex-1 items-center justify-center px-6 py-8">
            <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_auto]">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
                  room {roomId}
                </p>
                <h1 className="mt-4 max-w-xl font-serif text-6xl font-semibold leading-[0.92] sm:text-8xl">
                  Family Feud.
                </h1>
                <p className="mt-6 max-w-xl text-xl text-white/60 sm:text-2xl">
                  {snapshot.controllerConnected
                    ? "MC connected. Start the game from the phone."
                    : "MC: scan once to take the private controls."}
                </p>
                <div className="mt-8 grid max-w-xl gap-3 font-mono text-sm text-white/55 sm:grid-cols-3">
                  <span>1 shared screen</span>
                  <span>1 MC phone</span>
                  <span>0 player phones</span>
                </div>
              </div>
              <div className={`text-center ${snapshot.controllerConnected ? "opacity-20" : ""}`}>
                <div className="rounded-3xl bg-white p-4">
                  {controllerQr.dataUrl ? (
                    <img
                      src={controllerQr.dataUrl}
                      alt="QR code for the Family Feud MC controls"
                      className="h-72 w-72 sm:h-80 sm:w-80"
                    />
                  ) : (
                    <div className="h-72 w-72 animate-pulse bg-black/5 sm:h-80 sm:w-80" />
                  )}
                </div>
                <p className="mt-4 font-mono text-xs text-white/45">
                  {snapshot.controllerConnected ? "paired" : "MC controller code"}
                </p>
                {!snapshot.controllerConnected && controllerInvite ? (
                  <a
                    href={controllerInvite}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center font-mono text-[11px] text-white/35 underline decoration-white/20 underline-offset-4"
                  >
                    open controller on this device
                  </a>
                ) : null}
              </div>
            </div>
          </main>
        ) : snapshot.phase === "rules" ? (
          <main id="main" className="flex flex-1 items-center justify-center px-6 py-10">
            <div className="w-full max-w-5xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
                how to play
              </p>
              <h1 className="mt-4 font-serif text-5xl font-semibold sm:text-7xl">
                Shout together. The MC reveals.
              </h1>
              <div className="mt-10 grid gap-px overflow-hidden rounded-2xl bg-white/12 sm:grid-cols-2">
                {[
                  ["01", "The board runs from 10 points at #1 down to 1 point at #10."],
                  [
                    "02",
                    "Face-off: buzz first and answer in five seconds. A match earns its tile value.",
                  ],
                  [
                    "03",
                    "The main team keeps each tile it finds. The other team gets one answer worth double.",
                  ],
                  [
                    "04",
                    `${snapshot.rounds} rounds, cumulative score, no bank swaps. Most points wins; a tie goes to sudden death.`,
                  ],
                ].map(([number, copy]) => (
                  <div key={number} className="bg-[var(--things-night)] p-6 sm:p-8">
                    <span className="font-mono text-xs text-[var(--things-amber)]">{number}</span>
                    <p className="mt-3 font-serif text-2xl leading-snug">{copy}</p>
                  </div>
                ))}
              </div>
              <p className="mt-7 font-mono text-sm text-white/45">
                MC: start practice when ready. Event rewards are applied separately after the final
                result is confirmed.
              </p>
            </div>
          </main>
        ) : snapshot.phase === "round-intro" && round ? (
          <main id="main" className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <p className="font-mono text-sm uppercase tracking-[0.22em] text-[var(--things-amber)]">
                {round.number > snapshot.rounds
                  ? "sudden death"
                  : `round ${round.number} of ${snapshot.rounds}`}
              </p>
              <h1 className="mt-6 font-serif text-6xl font-semibold sm:text-8xl">
                {round.number > snapshot.rounds
                  ? "One answer wins."
                  : `Round ${round.number} is coming up.`}
              </h1>
              <p className="mt-4 text-white/50">
                {round.number > snapshot.rounds
                  ? "Buzz first and find a match."
                  : "The MC is choosing the card."}
              </p>
            </div>
          </main>
        ) : snapshot.phase === "finished" ? (
          <main
            id="main"
            className="flex flex-1 items-center justify-center px-6 py-10 text-center"
          >
            <div className="w-full max-w-4xl">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--things-amber)]">
                final score
              </p>
              <h1 className="mt-5 font-serif text-6xl font-semibold sm:text-8xl">
                {snapshot.winnerTeamIds.length > 1 ? "A tie." : `${winnerNames} win.`}
              </h1>
              <div className="mx-auto mt-10 max-w-2xl">
                <FamilyFeudScoreboard snapshot={snapshot} />
              </div>
              <p className="mt-8 font-mono text-sm text-white/50">
                {snapshot.resultConfirmed
                  ? snapshot.eventScoring
                    ? "Result confirmed. The MC can now open one team’s point claim."
                    : "Result confirmed."
                  : snapshot.winnerTeamIds.length > 1
                    ? "MC: start sudden death from your phone. A tied result cannot be confirmed."
                    : "MC: check the scores, then confirm the result on your phone."}
              </p>
            </div>
          </main>
        ) : (
          <main id="main" className="flex flex-1 flex-col pb-8">
            <FamilyFeudScoreboard snapshot={snapshot} animateAwards />
            <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-5 py-6 sm:px-8">
              <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                <div>
                  <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--things-amber)]">
                    {FAMILY_FEUD_PHASE_LABELS[snapshot.phase]}{" "}
                    {round?.number ? `· ${round.number}/${round.total}` : ""}
                  </p>
                  {round?.prompt ? (
                    <h1 className="mt-3 max-w-4xl text-balance font-serif text-3xl font-semibold leading-tight sm:text-5xl">
                      {round.prompt}
                    </h1>
                  ) : null}
                </div>
                {round ? (
                  <Timer
                    endsAt={round.phaseEndsAt}
                    paused={round.paused}
                    pausedRemainingMs={round.pausedRemainingMs}
                    offset={live.clockOffset}
                  />
                ) : null}
              </div>
              {snapshot.phase === "category" ? (
                <p className="mt-8 text-balance font-serif text-xl leading-snug text-white/60 sm:text-3xl">
                  Get one player from each team ready to buzz.
                </p>
              ) : snapshot.phase === "faceoff" && !faceoffTeam ? (
                <p className="mt-8 animate-pulse text-balance font-serif text-2xl leading-snug text-white/65 sm:text-4xl">
                  Buzzers are open.
                </p>
              ) : snapshot.phase === "faceoff" && faceoffTeam ? (
                <div className="mt-7 text-balance font-serif text-lg leading-snug min-[360px]:text-xl sm:text-3xl">
                  <FamilyFeudTeamMark team={faceoffTeam} />{" "}
                  <span className="text-white/55">— answer now</span>
                </div>
              ) : snapshot.phase === "main-ready" ? (
                <p className="mt-8 text-balance font-serif text-lg leading-snug min-[360px]:text-xl sm:text-3xl">
                  <FamilyFeudTeamMark team={activeTeam} />{" "}
                  <span className="text-white/60">get ready.</span>
                </p>
              ) : snapshot.phase === "steal-ready" ? (
                <p className="mt-8 text-balance font-serif text-lg leading-snug min-[360px]:text-xl sm:text-3xl">
                  <FamilyFeudTeamMark
                    team={snapshot.teams.find(({ id }) => id !== round?.activeTeamId)!}
                  />{" "}
                  <span className="text-white/60">has one chance.</span>
                </p>
              ) : null}
              {round && !["category", "round-score"].includes(snapshot.phase) ? (
                <div className="mt-7">
                  <FamilyFeudAnswerBoard
                    answers={round.answers}
                    houseAnswers={round.houseAnswers}
                    activeTeamId={round.activeTeamId}
                  />
                </div>
              ) : null}
              {snapshot.phase === "round-score" && round ? (
                <div className="mt-9 grid gap-5 text-center sm:grid-cols-2">
                  {snapshot.teams.map((team) => (
                    <div key={team.id} className="rounded-2xl border border-white/12 p-7">
                      <div className="justify-center font-serif text-2xl">
                        <FamilyFeudTeamMark team={team} />
                      </div>
                      <div className="mt-4 font-mono text-6xl tabular-nums">
                        +{team.roundPoints}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
