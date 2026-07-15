import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { readRemoteJudgeFn, sendRemoteJudgeCommandFn } from "./remote-room.functions";
import type { RemoteCommand, RemoteGameSnapshot, RemoteResultDecision } from "./types";

const POLL_MS = 850;

type RemoteCommandInput =
  | { type: "correct" | "incorrect" | "pass" | "pause" | "resume" | "undo" }
  | { type: "amend"; resultId: string; decision: RemoteResultDecision };

function tokenForRoom(roomId: string) {
  const key = `thing-judge-token:${roomId}`;
  const hashToken = location.hash.slice(1).trim();
  if (hashToken) {
    sessionStorage.setItem(key, hashToken);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return hashToken;
  }
  return sessionStorage.getItem(key) ?? "";
}

export function RemoteJudgeApp({ roomId }: { roomId: string }) {
  const [token, setToken] = useState("");
  const [snapshot, setSnapshot] = useState<RemoteGameSnapshot | null>(null);
  const [hostConnected, setHostConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const haptics = useWebHaptics();

  useEffect(() => setToken(tokenForRoom(roomId)), [roomId]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await readRemoteJudgeFn({ data: { roomId, judgeToken: token } });
        if (!active) return;
        if (!result.ok) {
          setError(result.error ?? "This invite is no longer available.");
          setHostConnected(false);
          return;
        }
        setSnapshot(result.snapshot);
        setHostConnected(result.hostConnected);
        setError(null);
      } catch {
        if (active) {
          setHostConnected(false);
          setError("Reconnecting…");
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [roomId, token]);

  const send = useCallback(
    async (command: RemoteCommandInput) => {
      if (!token || !hostConnected || sending) return;
      setSending(true);
      const payload = {
        ...command,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      } as RemoteCommand;
      try {
        const result = await sendRemoteJudgeCommandFn({
          data: { roomId, judgeToken: token, command: payload },
        });
        if (!result.ok) setError(result.error ?? "Control did not send.");
        else void haptics.trigger("selection");
      } catch {
        setError("Control did not send. The local game is unaffected.");
      } finally {
        setSending(false);
      }
    },
    [haptics, hostConnected, roomId, sending, token],
  );

  const gameName = snapshot?.game === "spelling-bee" ? "Spelling Bee" : "Forehead";
  const decisionLabels = useMemo(
    () =>
      snapshot?.game === "spelling-bee"
        ? ({ correct: "correct", incorrect: "incorrect", pass: "skip" } as const)
        : ({ correct: "correct", incorrect: "pass", pass: "pass" } as const),
    [snapshot?.game],
  );

  if (!token) {
    return <JudgeMessage title="Invite missing" detail="Ask the player to share the judge link again." />;
  }

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between gap-4 p-5 font-mono text-xs text-white/55">
        <Link to="/things" className="inline-flex min-h-11 items-center">← things</Link>
        <span aria-live="polite" className={hostConnected ? "text-emerald-200" : "text-amber-200"}>
          {hostConnected ? "● game connected" : "○ reconnecting"}
        </span>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-8">
        <p className="mt-4 font-mono text-micro uppercase tracking-[0.2em] text-white/45">remote judge · {gameName}</p>
        {!snapshot ? (
          <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
            <h1 className="font-serif text-5xl font-semibold">Waiting for the game.</h1>
            <p className="mt-4 font-serif text-lg text-white/55">Keep this screen open. It will connect automatically.</p>
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-[2rem] border border-white/12 bg-white/[0.05] p-6 text-center" aria-labelledby="current-item">
              <div className="flex items-center justify-between font-mono text-xs text-white/45">
                <span className="max-w-[50%] truncate">{snapshot.deckName}</span>
                <span>{snapshot.secondsRemaining === null ? "untimed" : `${snapshot.secondsRemaining}s`}</span>
              </div>
              <p className="mt-9 font-mono text-micro uppercase tracking-[0.2em] text-white/40">current</p>
              <div id="current-item"><TextMorph as="h1" className="mt-3 break-words font-serif text-5xl font-semibold leading-none [overflow-wrap:anywhere]">
                {snapshot.currentLabel ?? (snapshot.phase === "results" ? "Round complete" : "Get ready")}
              </TextMorph></div>
              {snapshot.currentPartOfSpeech || snapshot.currentDefinition ? (
                <p className="mx-auto mt-4 max-w-sm font-serif text-base leading-relaxed text-white/55">
                  {snapshot.currentPartOfSpeech ? <em>{snapshot.currentPartOfSpeech}</em> : null}
                  {snapshot.currentPartOfSpeech && snapshot.currentDefinition ? " · " : null}
                  {snapshot.currentDefinition}
                </p>
              ) : null}
              {snapshot.transcript ? <p className="mt-5 font-mono text-sm tracking-[0.12em] text-amber-200">heard · {snapshot.transcript}</p> : null}
              <div className="mt-8 border-t border-white/10 pt-4 text-left">
                <p className="font-mono text-micro uppercase tracking-[0.16em] text-white/35">up next</p>
                <p className="mt-1 truncate font-serif text-lg text-white/60">{snapshot.nextLabel ?? "—"}</p>
              </div>
            </section>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" disabled={!hostConnected || sending || snapshot.phase !== "playing"} onClick={() => void send({ type: snapshot.game === "spelling-bee" ? "incorrect" : "pass" })} className="min-h-16 rounded-full border border-white/20 font-mono text-sm font-semibold disabled:opacity-30">
                {snapshot.game === "spelling-bee" ? "incorrect / skip" : "pass"}
              </button>
              <button type="button" disabled={!hostConnected || sending || snapshot.phase !== "playing"} onClick={() => void send({ type: "correct" })} className="min-h-16 rounded-full bg-[var(--things-amber)] font-mono text-sm font-bold text-black disabled:opacity-30">
                correct
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" disabled={!hostConnected || snapshot.results.length === 0} onClick={() => void send({ type: "undo" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">undo</button>
              <button type="button" disabled={!hostConnected || snapshot.phase !== "playing" || snapshot.paused} onClick={() => void send({ type: "pause" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">pause</button>
              <button type="button" disabled={!hostConnected || snapshot.phase !== "playing" || !snapshot.paused} onClick={() => void send({ type: "resume" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">resume</button>
            </div>

            {snapshot.results.length > 0 ? (
              <section className="mt-8" aria-labelledby="judged-items">
                <h2 id="judged-items" className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">judged · tap to correct</h2>
                <ul className="mt-3 border-t border-white/12">
                  {snapshot.results.toReversed().slice(0, 8).map((result) => (
                    <li key={result.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/12 py-3">
                      <span className="min-w-0 truncate font-serif text-lg">{result.label}</span>
                      <select
                        aria-label={`Change result for ${result.label}`}
                        value={result.decision}
                        onChange={(event) => void send({ type: "amend", resultId: result.id, decision: event.target.value as RemoteResultDecision })}
                        disabled={!hostConnected}
                        className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-3 font-mono text-xs text-white"
                      >
                        <option value="correct">{decisionLabels.correct}</option>
                        <option value="incorrect">{decisionLabels.incorrect}</option>
                        <option value="pass">{decisionLabels.pass}</option>
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
        <p aria-live="polite" className="mt-4 min-h-5 text-center font-mono text-xs text-amber-200/80">{error}</p>
      </main>
    </div>
  );
}

function JudgeMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white">
      <div><h1 className="font-serif text-5xl font-semibold">{title}</h1><p className="mt-4 font-serif text-lg text-white/60">{detail}</p></div>
    </main>
  );
}
