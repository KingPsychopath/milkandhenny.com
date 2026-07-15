import { Link } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { applyPresenterActionFn } from "./party-room.functions";
import { usePartyLiveSnapshot } from "./usePartyLiveSnapshot";
import { useSynchronizedPartyStage } from "./useSynchronizedPartyStage";

function roomTokens(roomId: string) {
  const presenterKey = `spelling-party-presenter:v1:${roomId}`;
  const joinKey = `spelling-party-join:v1:${roomId}`;
  const params = new URLSearchParams(location.hash.slice(1));
  const presenter = params.get("presenter"); const join = params.get("join");
  if (presenter) sessionStorage.setItem(presenterKey, presenter);
  if (join) sessionStorage.setItem(joinKey, join);
  if (presenter || join) history.replaceState(null, "", location.pathname);
  return { presenterToken: presenter ?? sessionStorage.getItem(presenterKey) ?? "", joinToken: join ?? sessionStorage.getItem(joinKey) ?? "" };
}

function unlockAudio() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain();
  gain.gain.value = 0.0001; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.02); void context.resume();
}

export function PartyPresenterApp({ roomId }: { roomId: string }) {
  const [tokens, setTokens] = useState({ presenterToken: "", joinToken: "" });
  const [qr, setQr] = useState<string | null>(null);
  const playedAudio = useRef(new Set<string>());
  const haptics = useWebHaptics();
  useEffect(() => setTokens(roomTokens(roomId)), [roomId]);
  const live = usePartyLiveSnapshot({ roomId, role: "presenter", credential: tokens.presenterToken });
  const stage = useSynchronizedPartyStage(live.snapshot, live.clockOffset);
  const snapshot = live.snapshot;
  const setMessage = live.setMessage;
  const invite = tokens.joinToken ? `${location.origin}/things/spelling-party/${roomId}#${tokens.joinToken}` : null;

  useEffect(() => {
    if (!invite) return;
    let active = true;
    void QRCode.toDataURL(invite, { width: 320, margin: 1 }).then((value) => { if (active) setQr(value); });
    return () => { active = false; };
  }, [invite]);

  useEffect(() => {
    const round = snapshot?.round;
    if (!round || snapshot?.phase !== "countdown") return;
    const audio = new Audio(round.wordAudioUrl); audio.preload = "auto"; audio.load();
    const delay = Math.max(0, round.audioPlaysAt - (Date.now() + live.clockOffset));
    const timer = window.setTimeout(() => {
      if (playedAudio.current.has(`word:${round.roundId}`)) return;
      playedAudio.current.add(`word:${round.roundId}`);
      void audio.play().catch(() => setMessage("Tap ‘play word’—this browser blocked automatic audio."));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [live.clockOffset, setMessage, snapshot?.phase, snapshot?.round]);

  const clueId = snapshot?.round?.activeClue?.id;
  useEffect(() => {
    const clue = snapshot?.round?.activeClue;
    if (!clue || playedAudio.current.has(`clue:${clue.id}`)) return;
    playedAudio.current.add(`clue:${clue.id}`);
    void new Audio(clue.audioUrl).play().catch(() => setMessage("Tap the clue notice to play it."));
  }, [clueId, setMessage, snapshot?.round?.activeClue]);

  const previousStage = useRef("");
  const previousPhase = useRef(snapshot?.phase);
  useEffect(() => {
    if (stage.label === previousStage.current) return;
    if (/^[123]$/.test(stage.label)) void haptics.trigger("selection");
    previousStage.current = stage.label;
  }, [haptics, stage.label]);
  useEffect(() => {
    if (snapshot?.phase === "answer" && previousPhase.current !== "answer") void haptics.trigger("selection");
    if (snapshot?.phase === "finished" && previousPhase.current !== "finished") void haptics.trigger("success");
    previousPhase.current = snapshot?.phase;
  }, [haptics, snapshot?.phase]);

  const send = async (type: "round.start" | "round.next") => {
    if (!tokens.presenterToken) return;
    unlockAudio();
    try {
      const result = await applyPresenterActionFn({ data: { roomId, presenterToken: tokens.presenterToken, action: { actionId: crypto.randomUUID(), type } } });
      if (result.snapshot) live.setSnapshot(result.snapshot);
      if (!result.accepted) live.setMessage(result.error ?? "That action is not ready yet.");
      else { live.notify(); live.setMessage(null); }
    } catch { live.setMessage("Reconnecting… Try that once more."); }
  };

  const replay = () => {
    const url = live.snapshot?.round?.wordAudioUrl;
    if (url) void new Audio(url).play().catch(() => live.setMessage("Audio could not play on this screen."));
  };
  const players = snapshot?.players ?? [];
  const leaderboard = useMemo(() => [...(snapshot?.players ?? [])].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)), [snapshot?.players]);

  if (!tokens.presenterToken) return <PartyScreenMessage title="Presenter link missing" detail="Open the private presenter link created with this room." />;
  if (!snapshot) return <PartyScreenMessage title="Opening the room…" detail={live.message ?? "Keep this screen open."} />;
  const round = snapshot.round;
  return <div className="things-game things-game--night text-white">
    <header className="flex items-center justify-between gap-4 p-5 font-mono text-xs text-white/55"><Link to="/things/spelling-party" className="inline-flex min-h-11 items-center">← end</Link><span aria-live="polite">{live.connectionState === "connected" ? "● live" : live.connectionState === "offline" ? "playing offline · reconnecting" : "reconnecting"}</span></header>
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-10">
      {snapshot.phase === "lobby" ? <section className="flex flex-1 flex-col items-center justify-center py-8 text-center" aria-labelledby="party-room-title">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">{snapshot.deckName} · room {roomId}</p><h1 id="party-room-title" className="mt-3 font-serif text-6xl font-semibold">Scan to spell.</h1>
        {qr ? <img src={qr} alt="QR code for players to join this spelling room" className="mt-7 w-60 rounded-3xl bg-white p-3" /> : null}
        <ul className="mt-7 flex flex-wrap justify-center gap-2" aria-label="Players in the room">{players.map((player) => <li key={player.id} className="rounded-full border border-white/15 px-4 py-2 font-mono text-sm">{player.name}</li>)}</ul>
        <p aria-live="polite" className="mt-4 font-mono text-xs text-white/45">{players.length ? `${players.length} ready` : "Waiting for the first player…"}</p>
        <button type="button" onClick={() => void send("round.start")} disabled={!players.length} className="mt-7 min-h-16 w-full max-w-sm rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-30">start round</button>
      </section> : snapshot.phase === "finished" ? <section className="flex flex-1 flex-col justify-center py-10 text-center"><p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">final scores</p><h1 className="mt-3 font-serif text-6xl font-semibold">{leaderboard[0]?.name ?? "Well played"}</h1><Leaderboard players={leaderboard} /><Link to="/things/spelling-party" className="mx-auto mt-8 inline-flex min-h-12 items-center rounded-full border border-white/20 px-6 font-mono text-sm">new room</Link></section> : <>
        <section className="flex flex-1 flex-col items-center justify-center py-8 text-center" aria-live="polite"><p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">word {round?.number} of {round?.total}</p><TextMorph as="h1" className="mt-4 break-words font-serif text-7xl font-semibold leading-none [overflow-wrap:anywhere]">{stage.label}</TextMorph>{stage.seconds !== null ? <p className="mt-4 font-mono text-xl text-white/55">{stage.seconds}s</p> : null}
          {snapshot.phase === "answer" ? <p className="mt-6 font-serif text-xl text-white/55">{players.filter(({ status }) => status === "locked").length} of {players.length} locked in</p> : null}
          {snapshot.phase === "locked" ? <p className="mt-5 font-serif text-lg text-white/55">Everyone reveals together.</p> : null}
          {snapshot.phase === "reveal" && round ? <div className="mt-8 w-full"><ul className="border-t border-white/12">{round.answers?.map((answer) => <li key={answer.playerId} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-white/12 py-3 text-left"><span className="font-serif text-lg">{answer.name}</span><span className="font-mono text-sm text-white/60">{answer.answer || "no answer"}</span><span aria-label={answer.correct ? "correct" : "incorrect"}>{answer.correct ? "✓" : "—"}</span></li>)}</ul><Leaderboard players={leaderboard} /><button type="button" onClick={() => void send("round.next")} className="mt-7 min-h-14 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black">{round.number >= round.total ? "finish game" : "next word"}</button></div> : null}
        </section>
        {snapshot.phase !== "reveal" ? <section className="rounded-3xl border border-white/12 p-4"><ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{players.map((player) => <li key={player.id} className="flex min-h-12 items-center justify-between rounded-2xl bg-white/[0.04] px-3"><span className="truncate font-serif">{player.name}</span><span className="font-mono text-micro text-white/45">{player.status}</span></li>)}</ul>{snapshot.recentClues.at(-1) ? <button type="button" onClick={() => { const clue = snapshot.recentClues.at(-1); if (clue) void new Audio(clue.audioUrl).play(); }} className="mt-3 min-h-11 w-full text-left font-mono text-xs text-amber-200">{snapshot.recentClues.at(-1)?.message}</button> : null}</section> : null}
      </>}
      {round && snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? <button type="button" onClick={replay} className="mx-auto mt-3 min-h-11 px-4 font-mono text-xs text-white/45">play word again on this screen</button> : null}
      <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200">{live.message}</p>
    </main>
  </div>;
}

function Leaderboard({ players }: { players: Array<{ id: string; name: string; score: number }> }) { return <ol className="mx-auto mt-8 max-w-md border-t border-white/12">{players.map((player, index) => <li key={player.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-white/12 py-3 text-left transition-transform motion-reduce:transition-none"><span className="font-mono text-xs text-white/40">{index + 1}</span><span className="font-serif text-xl">{player.name}</span><span className="font-mono text-sm">{player.score}</span></li>)}</ol>; }
function PartyScreenMessage({ title, detail }: { title: string; detail: string }) { return <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"><div><h1 className="font-serif text-5xl font-semibold">{title}</h1><p className="mt-4 font-serif text-lg text-white/60">{detail}</p></div></main>; }
