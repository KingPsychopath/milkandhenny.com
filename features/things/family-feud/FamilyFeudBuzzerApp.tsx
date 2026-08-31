import { useEffect, useRef, useState } from "react";

import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import type { MultiplayerActionInput } from "../shared/multiplayer";
import { useReliableMultiplayerAction } from "../shared/useReliableMultiplayerAction";
import { FamilyFeudTeamMark } from "./FamilyFeudBoard";
import { parseFamilyFeudBuzzerFragment } from "./family-feud-invite";
import { familyFeudBrowserKeys } from "./family-feud-keys";
import { applyFamilyFeudBuzzerActionFn } from "./family-feud-room.functions";
import type { FamilyFeudBuzzerAction, FamilyFeudTeamId } from "./types";
import { useFamilyFeudRoom } from "./useFamilyFeudRoom";

interface BuzzerSession {
  token: string;
  teamId?: FamilyFeudTeamId;
}

function loadBuzzerSession(roomId: string): BuzzerSession | null {
  const key = familyFeudBrowserKeys.buzzerSession(roomId);
  const fragment = consumeLocationFragment();
  if (fragment) {
    const invite = parseFamilyFeudBuzzerFragment(fragment);
    if (invite) {
      const session = { token: invite.token, teamId: invite.teamId };
      try {
        sessionStorage.setItem(key, JSON.stringify(session));
      } catch {
        // The expiring local fallback below retains the role where storage is partially available.
      }
      writeExpiringLocalValue(key, session, invite.expiresAt);
      return session;
    }
  }
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(key);
  } catch {
    // Continue to the local recovery record.
  }
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as BuzzerSession;
      if (parsed.token) return parsed;
    } catch {
      return { token: stored };
    }
  }
  const recovered = readExpiringLocalValue<BuzzerSession | string>(key);
  return typeof recovered === "string" ? { token: recovered } : recovered;
}

export function FamilyFeudBuzzerApp({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<BuzzerSession | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    setSession(loadBuzzerSession(roomId));
    setReady(true);
  }, [roomId]);
  const live = useFamilyFeudRoom({ roomId, role: "buzzer", credential: session?.token ?? "" });
  const snapshot = live.snapshot;
  const dispatchBuzzerAction = useReliableMultiplayerAction(
    (action: MultiplayerActionInput<FamilyFeudBuzzerAction>, actionId) =>
      applyFamilyFeudBuzzerActionFn({
        data: {
          roomId,
          buzzerToken: session?.token ?? "",
          action: { ...action, actionId },
        },
      }),
    `${roomId}:${session?.teamId ?? "shared"}:${snapshot?.sequence ?? "loading"}`,
  );
  const hit = async (teamId: FamilyFeudTeamId) => {
    if (
      !session ||
      busyRef.current ||
      snapshot?.phase !== "faceoff" ||
      snapshot.round?.faceoffTeamId
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    navigator.vibrate?.(24);
    try {
      const result = await dispatchBuzzerAction({ type: "buzzer.hit", teamId });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.accepted) setMessage(result.error ?? "Someone already buzzed.");
      else live.notify();
    } catch {
      setMessage("Connection missed that buzz. The MC can assign it.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  if (!ready || (session && !snapshot))
    return (
      <div
        className="things-game things-game--night flex items-center justify-center px-6 text-white"
        aria-busy="true"
      >
        <p className="font-mono text-sm text-white/50">opening buzzers…</p>
      </div>
    );
  if (!session)
    return (
      <div className="things-game things-game--night flex items-center justify-center px-6 text-center text-white">
        <main className="max-w-md">
          <h1 className="font-serif text-4xl">Buzzer link missing.</h1>
          <p className="mt-4 text-white/55">Ask the MC to show the optional buzzer QR again.</p>
        </main>
      </div>
    );
  if (!snapshot) return null;
  const open = snapshot.phase === "faceoff" && snapshot.round?.faceoffTeamId === null;
  const buzzed = snapshot.round?.faceoffTeamId
    ? snapshot.teams.find(({ id }) => id === snapshot.round?.faceoffTeamId)
    : null;
  const teams = session.teamId
    ? snapshot.teams.filter((team) => team.id === session.teamId)
    : snapshot.teams;
  return (
    <div className="things-game things-game--night flex min-h-[100dvh] flex-col text-white">
      <header className="px-5 py-4 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          Family Feud · {session.teamId ? "team buzzer" : "shared buzzer"} · {roomId}
        </p>
        <h1 className="mx-auto mt-2 max-w-3xl font-serif text-2xl sm:text-4xl">
          {snapshot.round?.prompt ?? "Wait for the category."}
        </h1>
        <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-[var(--things-amber)]">
          {message ??
            (open
              ? "Buzzers open"
              : buzzed
                ? `${buzzed.name} buzzed first`
                : "MC will open the buzzers")}
        </p>
      </header>
      <main
        id="main"
        className={`grid flex-1 gap-1 p-2 sm:gap-3 sm:p-4 ${session.teamId ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            disabled={!open || busy}
            onClick={() => void hit(team.id)}
            className={`flex min-h-72 items-center justify-center rounded-3xl border-2 p-3 text-center transition-transform active:scale-[0.98] disabled:opacity-30 ${team.id === "one" ? "border-[var(--things-amber)] bg-[var(--things-amber)]/10" : "border-[var(--things-frost)] bg-[var(--things-frost)]/10"}`}
          >
            <span className="font-serif text-2xl font-semibold sm:text-5xl">
              <FamilyFeudTeamMark team={team} />
              <span className="mt-4 block font-mono text-xs font-normal uppercase tracking-[0.18em] text-white/45">
                tap to buzz
              </span>
            </span>
          </button>
        ))}
      </main>
    </div>
  );
}
