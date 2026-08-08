import { useEffect, useMemo, useRef, useState } from "react";
import { GameShell } from "../shared/GameShell";
import { readExpiringLocalValue } from "../shared/game-storage.client";
import { liarsBrowserKeys } from "./liars-keys";
import { LIARS_MODE_COPY, LIARS_ROLES } from "./liars-rules";
import { readLiarsSnapshotFn } from "./liars-room.functions";
import { PhaseTimer } from "./LiarsViews";
import { LiarsVillage } from "./LiarsVillage";
import { speakLiarsNarration } from "./narration.client";
import { useGameSound } from "../shared/useGameSound";
import type { LiarsSnapshot } from "./types";

const PHASE_LABEL: Record<string, string> = {
  lobby: "waiting",
  deal: "read your role",
  night: "night",
  dawn: "dawn",
  clue: "clues",
  deliberation: "talk",
  vote: "vote",
  verdict: "verdict",
  finalGuess: "one guess",
  ending: "over",
};

/**
 * The big screen in the room. Public state only — it holds no credentials of its own and reads the
 * room with the host token, so there is nothing here a player could not already see.
 *
 * During dawn this is what people should be looking at rather than their phones, which is the
 * entire reason the dawn beats are choreographed against a shared clock.
 */
export function LiarsPresenterApp({ roomId }: { roomId: string }) {
  const [snapshot, setSnapshot] = useState<LiarsSnapshot | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const sound = useGameSound(liarsBrowserKeys.muted());
  const spokenRef = useRef<string | null>(null);

  const hostToken = useMemo(() => {
    if (typeof window === "undefined") return null;
    return (
      readExpiringLocalValue<{ hostToken: string }>(liarsBrowserKeys.hostSession(roomId))
        ?.hostToken ?? null
    );
  }, [roomId]);

  useEffect(() => {
    if (!hostToken) {
      setMessage("Open this from the device that created the room.");
      return;
    }
    let active = true;
    const read = async () => {
      const startedAt = Date.now();
      const result = await readLiarsSnapshotFn({
        data: { roomId, credential: hostToken, lastSequence: 0 },
      }).catch(() => null);
      if (!active) return;
      if (!result?.ok) {
        setMessage("That room has ended.");
        return;
      }
      setClockOffset(result.snapshot.serverNow - (startedAt + Date.now()) / 2);
      setSnapshot(result.snapshot);
    };
    void read();
    const timer = window.setInterval(() => void read(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hostToken, roomId]);

  // The presenter is the narrator whenever it is attached, so phones stay quiet in a shared room.
  useEffect(() => {
    const dawn = snapshot?.dawn;
    if (!dawn || snapshot?.phase !== "dawn" || !sound.voice) return;
    if (spokenRef.current === dawn.narration) return;
    spokenRef.current = dawn.narration;
    void speakLiarsNarration(dawn.narration);
  }, [snapshot, sound.voice]);

  if (!snapshot)
    return (
      <GameShell tone="night">
        <p className="m-auto font-mono text-sm text-white/50">{message ?? "connecting…"}</p>
      </GameShell>
    );

  const alive = snapshot.players.filter(({ alive: isAlive }) => isAlive);
  const gone = snapshot.players.filter(({ alive: isAlive }) => !isAlive);
  const ending = snapshot.ending;

  return (
    <GameShell tone="night">
      <div className="flex min-h-0 flex-1 flex-col px-[4vw] py-[3vh] text-white">
        <header className="flex items-baseline justify-between font-mono text-[1.6vh] uppercase tracking-[0.2em] text-white/40">
          <span>
            {LIARS_MODE_COPY[snapshot.mode].name} · {snapshot.roomId}
          </span>
          <span>
            {PHASE_LABEL[snapshot.phase]}
            {snapshot.round > 0 ? ` · ${snapshot.round}` : ""}
          </span>
          <span>
            {alive.length} alive · {gone.length} gone
          </span>
        </header>

        <main id="main" className="flex flex-1 flex-col justify-center">
          {ending ? (
            <>
              <h1 className="font-serif text-[9vh] font-semibold leading-[1]">{ending.headline}</h1>
              {ending.word ? (
                <p className="mt-[2vh] font-serif text-[4vh] text-[var(--things-amber)]">
                  the word was {ending.word}
                </p>
              ) : null}
              <ul className="mt-[4vh] grid grid-cols-2 gap-x-[4vw] gap-y-[1vh] lg:grid-cols-3">
                {ending.roles.map(({ playerId, name, role }) => (
                  <li key={playerId} className="flex items-baseline gap-3 border-t border-white/10 pt-2">
                    <span className="font-serif text-[3vh]">{name}</span>
                    <span className="ml-auto font-mono text-[1.6vh] uppercase tracking-[0.14em] text-white/55">
                      {LIARS_ROLES[role].name}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : snapshot.phase === "dawn" && snapshot.dawn ? (
            <>
              <p className="font-serif text-[6vh] leading-[1.1]" aria-live="assertive">
                {snapshot.dawn.narration}
              </p>
              <div className="mx-auto mt-[2vh] w-full max-w-[70vw]">
                <LiarsVillage snapshot={snapshot} clockOffset={clockOffset} />
              </div>
              <div className="mt-[3vh] space-y-[1vh]">
                {snapshot.dawn.deaths.map((death) => (
                  <p
                    key={death.playerId}
                    className={`font-serif text-[5vh] ${
                      death.revived ? "text-[var(--liars-alive)]" : "text-[var(--liars-dead)]"
                    }`}
                  >
                    {death.name}
                    {death.substituteName
                      ? ` — ${death.substituteName} stepped in front of them`
                      : death.revived
                        ? " lives"
                        : " is gone"}
                  </p>
                ))}
                {snapshot.dawn.movementSeen.map((name) => (
                  <p key={name} className="font-mono text-[2vh] text-white/55">
                    {name} was seen moving last night
                  </p>
                ))}
                {snapshot.dawn.lastWords.map((entry, index) => (
                  <p key={index} className="font-serif text-[3.4vh] text-white/75">
                    “{entry.text}” — {entry.name}
                  </p>
                ))}
              </div>
            </>
          ) : snapshot.phase === "clue" && snapshot.clue ? (
            <>
              <p className="font-mono text-[2vh] uppercase tracking-[0.2em] text-white/40">
                say your word out loud
              </p>
              <h1 className="mt-[2vh] font-serif text-[12vh] font-semibold leading-[1]">
                {snapshot.players.find(({ id }) => id === snapshot.clue!.currentPlayerId)?.name}
              </h1>
              <p className="mt-[3vh] font-mono text-[2vh] text-white/45">
                {snapshot.clue.doneIds.length} of {snapshot.clue.order.length} have spoken
              </p>
            </>
          ) : (
            <>
              <h1 className="font-serif text-[10vh] font-semibold leading-[1]">
                {PHASE_LABEL[snapshot.phase]}
              </h1>
              {snapshot.phase !== "lobby" ? (
                <div className="mt-[2vh] text-[3vh]">
                  <PhaseTimer
                    endsAt={snapshot.phaseEndsAt}
                    clockOffset={clockOffset}
                    label={snapshot.phase === "night" ? "night ends in" : "ends in"}
                  />
                </div>
              ) : null}
              {snapshot.phase === "night" ? (
                <>
                  <div className="mx-auto mt-[3vh] w-full max-w-[70vw]">
                    <LiarsVillage snapshot={snapshot} clockOffset={clockOffset} />
                  </div>
                  <p className="mt-[2vh] font-mono text-[2.4vh] text-white/45">
                    {snapshot.actedCount} of {snapshot.livingCount} have acted
                  </p>
                </>
              ) : null}
              {snapshot.phase === "deliberation" ? (
                <p className="mt-[3vh] font-mono text-[2.4vh] text-white/45">
                  {snapshot.readyToVoteCount} of {snapshot.livingCount} ready to vote
                </p>
              ) : null}
            </>
          )}
        </main>

        {!ending ? (
          <footer className="border-t border-white/10 pt-[2vh]">
            <ul className="flex flex-wrap gap-x-[3vw] gap-y-[1vh] font-serif text-[2.6vh]">
              {snapshot.players.map((player) => (
                <li
                  key={player.id}
                  className={`flex items-baseline gap-2 ${player.alive ? "" : "opacity-35"}`}
                >
                  <span className={player.alive ? "" : "line-through decoration-white/40"}>
                    {player.name}
                  </span>
                  {player.votes ? (
                    <span className="font-mono text-[1.6vh] text-white/55">{player.votes}</span>
                  ) : null}
                  {player.marks.includes("moved") ? (
                    <span className="font-mono text-[1.6vh] text-[var(--things-amber)]">→</span>
                  ) : null}
                  {!player.alive ? (
                    <span className="font-mono text-[1.6vh] text-[var(--liars-dead)]">✕</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </footer>
        ) : null}
      </div>
    </GameShell>
  );
}
