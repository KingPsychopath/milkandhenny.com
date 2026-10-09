import { GameFrame, GameFrameHeader } from "@/features/things/shared/GameFrame";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PairsBoard } from "./PairsBoard";
import { joinPairsRaceFn } from "./pairs-race.functions";
import { loadPairsRaceSession, savePairsRaceSession } from "./pairs-race-session.client";
import type { PairsRaceSession } from "./pairs-race-session.client";
import { usePairsRace } from "./usePairsRace";
import "./pairs.css";

export function PairsRaceApp({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<PairsRaceSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSession(loadPairsRaceSession(roomId));
    setLoaded(true);
  }, [roomId]);
  async function join() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      let attempt = loadPairsRaceSession(roomId, true);
      if (!attempt) {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        attempt = {
          roomId,
          playerId: crypto.randomUUID(),
          playerToken: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
          expiresAt: Date.now() + 6 * 60 * 60 * 1000,
        };
        if (!savePairsRaceSession(attempt, true))
          throw new Error("Allow browser storage to keep your player session, then try again.");
      }
      const joined = await joinPairsRaceFn({ data: { ...attempt, name: name.trim() } });
      savePairsRaceSession(joined);
      setSession(joined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join this table");
    } finally {
      setBusy(false);
    }
  }
  if (session) return <RaceTable key={`${roomId}:${session.playerId}`} session={session} />;
  return (
    <GameFrame className="pairs-app">
      <GameFrameHeader className="pairs-header">
        <Link to="/things/pairs">← pairs</Link>
        <span>table {roomId}</span>
      </GameFrameHeader>
      <main id="main" className="pairs-main">
        <p className="pairs-eyebrow">two devices · first to two rounds</p>
        <h1 className="pairs-title">A table for two.</h1>
        <p className="pairs-description">
          Same cards. Same shuffle. Clear your table first to take the round.
        </p>
        {loaded ? (
          <form
            className="pairs-race-join"
            onSubmit={(event) => {
              event.preventDefault();
              void join();
            }}
          >
            <label className="pairs-race-field">
              your name
              <input
                required
                maxLength={24}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
              />
            </label>
            <button type="submit" className="mh-action mh-action--primary" disabled={busy}>
              {busy ? "joining…" : "take the other seat"}
            </button>
            {error ? <p role="alert">{error}</p> : null}
          </form>
        ) : (
          <p role="status">finding your seat…</p>
        )}
      </main>
    </GameFrame>
  );
}

export function RaceTable({ session }: { session: PairsRaceSession }) {
  const race = usePairsRace(session);
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  const [concedeOpen, setConcedeOpen] = useState(false);
  const snapshot = race.snapshot;
  const phase = snapshot?.phase;
  const startsAt = snapshot?.startsAt;
  const countdown =
    snapshot?.phase === "playing"
      ? Math.max(0, Math.ceil((snapshot.startsAt - now - race.clockOffset) / 1000))
      : 0;
  useEffect(() => {
    if (!startsAt || phase !== "playing" || countdown === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [phase, startsAt, countdown]);
  useEffect(() => {
    setNow(Date.now());
    setConcedeOpen(false);
  }, [snapshot?.phase, snapshot?.round]);
  const player = snapshot?.players.find((candidate) => candidate.id === session.playerId);
  const opponent = snapshot?.players.find((candidate) => candidate.id !== session.playerId);
  const winner = snapshot?.players.find((candidate) => candidate.id === snapshot.winnerId);
  const ready =
    snapshot?.players.length === 2 && snapshot.players.every((candidate) => candidate.ready);
  const headline = !snapshot
    ? "Finding your table…"
    : snapshot.phase === "lobby"
      ? opponent
        ? "Two seats. One winner."
        : "Save the other seat."
      : snapshot.phase === "playing"
        ? countdown
          ? `Ready in ${countdown}.`
          : "Clear your table first."
        : snapshot.phase === "finished"
          ? `${winner?.name} takes the match.`
          : `${winner?.name} takes round ${snapshot.round}.`;
  return (
    <GameFrame className="pairs-app">
      <GameFrameHeader className="pairs-header">
        <Link to="/things/pairs">← pairs</Link>
        <span>
          table <strong>{session.roomId}</strong>
        </span>
      </GameFrameHeader>
      <main id="main" className="pairs-main pairs-main--playing">
        <p className="pairs-eyebrow">
          two-device race · {snapshot?.round ? `round ${snapshot.round} · ` : ""}first to two wins
        </p>
        <h1 className="pairs-title">{headline}</h1>
        <p className="pairs-description" role="status">
          {!snapshot
            ? "Your player session restores after a refresh."
            : snapshot.phase === "lobby"
              ? opponent
                ? "Both get ready, then deal the same board to each device."
                : "Send your friend the invite or ask them to enter the table code on their device."
              : snapshot.phase === "playing"
                ? countdown
                  ? "Cards stay hidden until you both start."
                  : "Match the ranks, whatever the suit. Your opponent is solving the same shuffle."
                : snapshot.conceded
                  ? "The match was conceded. Get ready together for a rematch."
                  : snapshot.phase === "finished"
                    ? `${winner?.wins} round wins. Look up, celebrate, and get ready for a rematch.`
                    : "Look up and compare notes. Both get ready when you want the next round."}
        </p>
        {race.message ? (
          <p role="alert" className="pairs-race-message">
            {race.message}
          </p>
        ) : null}
        {race.uncertain ? (
          <button
            type="button"
            className="mh-action mh-action--secondary"
            onClick={() => void race.retry()}
          >
            retry move
          </button>
        ) : null}
        {snapshot ? (
          <div className="pairs-play-layout">
            <section className="pairs-table" aria-label="Your race board">
              {snapshot.game &&
              (snapshot.phase === "playing" ||
                (!snapshot.conceded &&
                  snapshot.winnerId === session.playerId &&
                  snapshot.game.phase === "review")) ? (
                <>
                  <div className="pairs-table-meta">
                    <span>
                      {player?.pairs} / {snapshot.pairCount} pairs
                    </span>
                    <span>{player?.tries} tries</span>
                  </div>
                  <PairsBoard
                    key={snapshot.round}
                    game={snapshot.game}
                    onFlip={
                      snapshot.phase === "playing" && !race.busy && !race.ended && !countdown
                        ? (index) => void race.send({ type: "flip", index, round: snapshot.round })
                        : undefined
                    }
                  />
                </>
              ) : (
                <div className="pairs-clear-table">
                  <span aria-hidden="true">
                    ♠ <span>♥</span>
                  </span>
                  <p>
                    {snapshot.phase === "lobby"
                      ? "same shuffle. separate tables."
                      : snapshot.conceded
                        ? `${winner?.name} wins by concession.`
                        : `${winner?.name} cleared the table first.`}
                  </p>
                </div>
              )}
              {snapshot.phase !== "playing" && opponent && !race.ended ? (
                <div className="pairs-ready-controls">
                  <button
                    type="button"
                    className={`mh-action ${ready ? "mh-action--secondary" : "mh-action--primary"}`}
                    aria-pressed={player?.ready}
                    disabled={race.busy}
                    onClick={() => void race.send({ type: "ready", ready: !player?.ready })}
                  >
                    {player?.ready
                      ? "ready · waiting for the other seat"
                      : snapshot.phase === "finished"
                        ? "ready for a rematch"
                        : "I’m ready"}
                  </button>
                  {ready ? (
                    <button
                      type="button"
                      className="mh-action mh-action--primary"
                      disabled={race.busy}
                      onClick={() => void race.send({ type: "begin" })}
                    >
                      {snapshot.phase === "lobby"
                        ? "start the race"
                        : snapshot.phase === "finished"
                          ? "deal a rematch"
                          : "deal next round"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
            <aside className="pairs-sidebar" aria-label="Race scores">
              <p className="pairs-eyebrow">round wins</p>
              <ol className="pairs-scores">
                {snapshot.players.map((candidate) => (
                  <li key={candidate.id}>
                    <span>
                      {candidate.name}
                      <small>{candidate.id === session.playerId ? "you" : "opponent"}</small>
                    </span>
                    <strong>
                      {candidate.wins}
                      <small>
                        {snapshot.phase === "playing"
                          ? `${candidate.pairs}/${snapshot.pairCount} pairs`
                          : candidate.ready
                            ? "ready"
                            : "not ready"}
                      </small>
                    </strong>
                  </li>
                ))}
              </ol>
              {snapshot.phase === "lobby" ? (
                <button
                  type="button"
                  className="mh-action mh-action--secondary pairs-next"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(window.location.href)
                      .then(() => setCopied(true))
                      .catch(() => setCopied(false));
                  }}
                >
                  {copied ? "invite copied" : "copy invite"}
                </button>
              ) : null}
              {snapshot.phase === "playing" ? (
                <button
                  type="button"
                  className="mh-action mh-action--quiet"
                  onClick={() => setConcedeOpen(!concedeOpen)}
                >
                  concede match
                </button>
              ) : null}
              {concedeOpen ? (
                <div className="pairs-note">
                  <p>Give the match to {opponent?.name}?</p>
                  <button
                    type="button"
                    className="mh-action mh-action--danger"
                    disabled={race.busy}
                    onClick={() => void race.send({ type: "concede" })}
                  >
                    concede this match
                  </button>
                  <button
                    type="button"
                    className="mh-action mh-action--quiet"
                    onClick={() => setConcedeOpen(false)}
                  >
                    keep racing
                  </button>
                </div>
              ) : null}
              <div className="pairs-note">
                <p>
                  Two matching ranks make a pair. Clear every pair to win a round. First to two
                  rounds wins the match.
                </p>
                <p>
                  One player missing? A refresh restores their seat. You can leave this page and
                  return using the same invite.
                </p>
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </GameFrame>
  );
}
