import QRCode from "qrcode";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { applyPresenterActionFn, closePartyRoomFn } from "./party-room.functions";
import { usePartyLiveSnapshot } from "./usePartyLiveSnapshot";
import { useSynchronizedPartyStage } from "./useSynchronizedPartyStage";
import { PartyClosenessBoard } from "./PartyClosenessBoard";
import type { PartyClueEvent } from "./types";
import { gameBrowserKeys, legacyGameBrowserKeys } from "../shared/game-keys";
import { readExpiringLocalValue, removeStorageKeys, writeExpiringLocalValue } from "../shared/game-storage.client";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { speakWord } from "../spelling-bee/localSpeech";

function roomTokens(roomId: string) {
  const sessionKey = gameBrowserKeys.partyPresenterSession(roomId);
  const recoveryKey = gameBrowserKeys.partyPresenterRecovery(roomId);
  const params = new URLSearchParams(location.hash.slice(1));
  const presenter = params.get("presenter"); const join = params.get("join");
  if (presenter || join) {
    const session = { presenterToken: presenter ?? "", joinToken: join ?? "" };
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    const expiresAt = Number(params.get("expires"));
    if (Number.isFinite(expiresAt) && expiresAt > Date.now()) writeExpiringLocalValue(recoveryKey, session, expiresAt);
    history.replaceState(null, "", location.pathname);
    return session;
  }
  try {
    const current = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as { presenterToken?: unknown; joinToken?: unknown } | null;
    if (typeof current?.presenterToken === "string" && typeof current.joinToken === "string") return { presenterToken: current.presenterToken, joinToken: current.joinToken };
  } catch { sessionStorage.removeItem(sessionKey); }
  const recovered = readExpiringLocalValue<{ presenterToken: string; joinToken: string }>(recoveryKey);
  if (recovered && typeof recovered.presenterToken === "string" && typeof recovered.joinToken === "string") {
    sessionStorage.setItem(sessionKey, JSON.stringify(recovered));
    return recovered;
  }
  const presenterToken = sessionStorage.getItem(legacyGameBrowserKeys.partyPresenterToken(roomId)) ?? "";
  const joinToken = sessionStorage.getItem(legacyGameBrowserKeys.partyJoinToken(roomId)) ?? "";
  if (presenterToken || joinToken) sessionStorage.setItem(sessionKey, JSON.stringify({ presenterToken, joinToken }));
  removeStorageKeys(sessionStorage, [legacyGameBrowserKeys.partyPresenterToken(roomId), legacyGameBrowserKeys.partyJoinToken(roomId)]);
  return { presenterToken, joinToken };
}

function unlockAudio() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain();
  gain.gain.value = 0.0001; oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.02); void context.resume();
}

async function playPartySpeech(audioUrl: string | null, text: string | undefined, locale: "en-GB" | "en-US" = "en-GB") {
  if (audioUrl) {
    try {
      await new Audio(audioUrl).play();
      return true;
    } catch {
      // A local voice keeps the round moving if a recorded asset is unavailable.
    }
  }
  return text ? speakWord({ id: text, word: text }, { locale }) : false;
}

export function PartyPresenterApp({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState({ presenterToken: "", joinToken: "" });
  const [qr, setQr] = useState<string | null>(null);
  const [nativeShare, setNativeShare] = useState(false);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [manualInvite, setManualInvite] = useState(false);
  const [closing, setClosing] = useState(false);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const playedAudio = useRef(new Set<string>());
  const haptics = useWebHaptics();
  useEffect(() => setTokens(roomTokens(roomId)), [roomId]);
  const live = usePartyLiveSnapshot({ roomId, role: "presenter", credential: tokens.presenterToken });
  const stage = useSynchronizedPartyStage(live.snapshot, live.clockOffset);
  const snapshot = live.snapshot;
  useUpdateReloadSafety("spelling-party-presenter", snapshot?.phase === "lobby" || snapshot?.phase === "finished");
  const setMessage = live.setMessage;
  const invite = tokens.joinToken ? `${location.origin}/things/spelling-party/${roomId}#${tokens.joinToken}` : null;

  useEffect(() => {
    setNativeShare(typeof navigator.share === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    if (!invite) return;
    let active = true;
    void QRCode.toDataURL(invite, { width: 320, margin: 1 }).then((value) => { if (active) setQr(value); });
    return () => { active = false; };
  }, [invite]);

  const copyInvite = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.readOnly = true;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      try { return document.execCommand("copy"); } finally { textarea.remove(); }
    }
  };

  const shareInvite = async () => {
    if (!invite) return;
    setManualInvite(false);
    const share = { title: "Join our Spelling Bee", text: `Join room ${roomId} and type along.`, url: invite };
    if (nativeShare && navigator.share && (!navigator.canShare || navigator.canShare(share))) {
      try {
        await navigator.share(share);
        setInviteMessage("Invite shared.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    if (await copyInvite(invite)) setInviteMessage("Player link copied.");
    else { setManualInvite(true); setInviteMessage("Copy the player link below."); }
  };

  useEffect(() => {
    const round = snapshot?.round;
    if (!round || snapshot?.phase !== "countdown") return;
    const audio = round.wordAudioUrl ? new Audio(round.wordAudioUrl) : null;
    if (audio) { audio.preload = "auto"; audio.load(); }
    const delay = Math.max(0, round.audioPlaysAt - (Date.now() + live.clockOffset));
    const timer = window.setTimeout(() => {
      if (playedAudio.current.has(`word:${round.roundId}`)) return;
      playedAudio.current.add(`word:${round.roundId}`);
      const playback = playPartySpeech(round.wordAudioUrl, round.spokenWord, round.speechLocale);
      void playback.then((played) => { if (played === false) setMessage("Tap ‘play word’—this browser blocked automatic audio."); }).catch(() => setMessage("Tap ‘play word’—this browser blocked automatic audio."));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [live.clockOffset, setMessage, snapshot?.phase, snapshot?.round]);

  const clueId = snapshot?.round?.activeClue?.id;
  useEffect(() => {
    const clue = snapshot?.round?.activeClue;
    if (!clue || playedAudio.current.has(`clue:${clue.id}`)) return;
    playedAudio.current.add(`clue:${clue.id}`);
    const playback = playPartySpeech(clue.audioUrl, clue.speechText, snapshot?.round?.speechLocale);
    void playback.then((played) => { if (played === false) setMessage("Tap the clue notice to play it."); }).catch(() => setMessage("Tap the clue notice to play it."));
  }, [clueId, setMessage, snapshot?.round?.activeClue, snapshot?.round?.speechLocale]);

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
    const currentRound = live.snapshot?.round;
    if (currentRound) void playPartySpeech(currentRound.wordAudioUrl, currentRound.spokenWord, currentRound.speechLocale).then((played) => { if (!played) live.setMessage("Audio could not play on this screen."); });
  };
  const replayClue = (clue: PartyClueEvent) => {
    void playPartySpeech(clue.audioUrl, clue.speechText, snapshot?.round?.speechLocale).then((played) => { if (!played) live.setMessage("That clue could not play."); });
  };
  const handleEnd = async (confirmFirst = true) => {
    if (closing || !tokens.presenterToken) return;
    if (confirmFirst && snapshot?.phase !== "finished" && players.length > 0) { setEndConfirmationOpen(true); return; }
    setEndConfirmationOpen(false);
    setClosing(true);
    await closePartyRoomFn({ data: { roomId, presenterToken: tokens.presenterToken } }).catch(() => null);
    removeStorageKeys(sessionStorage, [
      gameBrowserKeys.partyPresenterSession(roomId),
      legacyGameBrowserKeys.partyPresenterToken(roomId),
      legacyGameBrowserKeys.partyJoinToken(roomId),
    ]);
    removeStorageKeys(localStorage, [gameBrowserKeys.partyPresenterRecovery(roomId)]);
    await navigate({ to: "/things/spelling-party" });
  };
  const players = snapshot?.players ?? [];
  const leaderboard = useMemo(() => [...(snapshot?.players ?? [])].sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)), [snapshot?.players]);

  useEffect(() => {
    if (!live.ended) return;
    removeStorageKeys(sessionStorage, [gameBrowserKeys.partyPresenterSession(roomId), legacyGameBrowserKeys.partyPresenterToken(roomId), legacyGameBrowserKeys.partyJoinToken(roomId)]);
    removeStorageKeys(localStorage, [gameBrowserKeys.partyPresenterRecovery(roomId)]);
  }, [live.ended, roomId]);

  if (!tokens.presenterToken) return <PartyScreenMessage title="Presenter link missing" detail="Open the private presenter link created with this room." />;
  if (live.ended) return <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"><div><h1 className="font-serif text-5xl font-semibold">Party ended.</h1><p className="mt-4 font-serif text-lg text-white/60">This room has been cleared.</p><button type="button" onClick={() => void navigate({ to: "/things/spelling-party" })} className="mt-6 min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm">start a new room</button></div></main>;
  if (!snapshot) return <PartyScreenMessage title="Opening the room…" detail={live.message ?? "Keep this screen open."} />;
  const round = snapshot.round;
  return <div className="things-game things-game--night text-white">
    <header className="flex items-center justify-between gap-4 p-5 font-mono text-xs text-white/55"><button type="button" onClick={() => void handleEnd()} disabled={closing} className="min-h-11 disabled:opacity-40">{closing ? "ending…" : "end game"}</button><span aria-live="polite">{live.connectionState === "connected" ? "● live" : live.connectionState === "offline" ? "playing offline · reconnecting" : "reconnecting"}</span></header>
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 pb-10">
      {snapshot.phase === "lobby" ? <section className="flex flex-1 flex-col items-center justify-center py-8 text-center" aria-labelledby="party-room-title">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">{snapshot.deckName}</p><h1 id="party-room-title" className="mt-3 font-serif text-6xl font-semibold">Join the room.</h1>
        {qr ? <img src={qr} alt="QR code for players to join this spelling room" className="mt-7 w-60 rounded-3xl bg-white p-3" /> : null}
        <div className="mt-5"><p className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">room code</p><p className="mt-1 font-mono text-3xl tracking-[0.2em]">{roomId}</p></div>
        <button type="button" onClick={() => void shareInvite()} disabled={!invite} className="mt-5 min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm font-semibold disabled:opacity-35">{nativeShare ? "share player invite" : "copy player link"}</button>
        <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-amber-200">{inviteMessage}</p>
        {manualInvite && invite ? <input readOnly value={invite} aria-label="Player invite link" onFocus={(event) => event.currentTarget.select()} className="mt-2 min-h-11 w-full max-w-md rounded-xl border border-white/15 bg-white/[0.04] px-3 font-mono text-xs text-white/70" /> : null}
        <ul className="mt-7 flex flex-wrap justify-center gap-2" aria-label="Players in the room">{players.map((player) => <li key={player.id} className="rounded-full border border-white/15 px-4 py-2 font-mono text-sm">{player.name}</li>)}</ul>
        <p aria-live="polite" className="mt-4 font-mono text-xs text-white/45">{players.length ? `${players.length} ready` : "Waiting for the first player…"}</p>
        <button type="button" onClick={() => void send("round.start")} disabled={!players.length} className="mt-7 min-h-16 w-full max-w-sm rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black disabled:opacity-30">start round</button>
      </section> : snapshot.phase === "finished" ? <section className="flex flex-1 flex-col justify-center py-10 text-center"><p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">final scores</p><h1 className="mt-3 font-serif text-6xl font-semibold">{leaderboard[0]?.name ?? "Well played"}</h1><Leaderboard players={leaderboard} /><button type="button" onClick={() => void handleEnd()} disabled={closing} className="mx-auto mt-8 min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm disabled:opacity-40">{closing ? "closing room…" : "new room"}</button></section> : <>
        <section className="flex flex-1 flex-col items-center justify-center py-8 text-center" aria-live="polite"><p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">word {round?.number} of {round?.total}</p><TextMorph as="h1" className="mt-4 break-words font-serif text-7xl font-semibold leading-none [overflow-wrap:anywhere]">{stage.label}</TextMorph>{stage.seconds !== null ? <p className="mt-4 font-mono text-xl text-white/55">{stage.seconds}s</p> : null}
          {snapshot.phase === "answer" ? <p className="mt-6 font-serif text-xl text-white/55">{players.filter(({ status }) => status === "locked").length} of {players.length} locked in</p> : null}
          {snapshot.phase === "locked" ? <p className="mt-5 font-serif text-lg text-white/55">Everyone reveals together.</p> : null}
          {snapshot.phase === "reveal" && round ? <div className="mt-8 w-full"><p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">closest spellings</p>{round.answers ? <PartyClosenessBoard answers={round.answers} /> : null}<p className="mt-6 font-serif text-base text-white/45">Scores stay hidden until the end.</p><button type="button" onClick={() => void send("round.next")} className="mt-7 min-h-14 w-full rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-bold text-black">{round.number >= round.total ? "reveal final scores" : "next word"}</button></div> : null}
        </section>
        {snapshot.phase !== "reveal" ? <section className="rounded-3xl border border-white/12 p-4"><ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{players.map((player) => <li key={player.id} className="flex min-h-12 items-center justify-between rounded-2xl bg-white/[0.04] px-3"><span className="truncate font-serif">{player.name}</span><span className="font-mono text-micro text-white/45">{player.status}</span></li>)}</ul>{snapshot.recentClues.at(-1) ? <button type="button" onClick={() => { const clue = snapshot.recentClues.at(-1); if (clue) replayClue(clue); }} className="mt-3 min-h-11 w-full text-left font-mono text-xs text-amber-200">{snapshot.recentClues.at(-1)?.message}</button> : null}</section> : null}
      </>}
      {round && snapshot.phase !== "lobby" && snapshot.phase !== "finished" ? <button type="button" onClick={replay} className="mx-auto mt-3 min-h-11 px-4 font-mono text-xs text-white/45">play word again on this screen</button> : null}
      <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-amber-200">{live.message}</p>
    </main>
    {endConfirmationOpen ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="end-party-title"><section className="w-full max-w-md rounded-[2rem] border border-white/12 bg-[var(--things-night)] p-6 text-center shadow-2xl"><p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">end party</p><h2 id="end-party-title" className="mt-3 font-serif text-4xl font-semibold">End for everyone?</h2><p className="mt-3 font-serif text-base text-white/60">Players will see that the room has ended. This cannot be undone.</p><div className="mt-7 grid grid-cols-2 gap-3"><button type="button" autoFocus onClick={() => setEndConfirmationOpen(false)} className="min-h-14 rounded-full border border-white/20 font-mono text-sm font-semibold">keep playing</button><button type="button" onClick={() => void handleEnd(false)} className="min-h-14 rounded-full bg-white font-mono text-sm font-bold text-black">end party</button></div></section></div> : null}
  </div>;
}

function Leaderboard({ players }: { players: Array<{ id: string; name: string; score: number }> }) { return <ol className="mx-auto mt-8 max-w-md border-t border-white/12">{players.map((player, index) => <li key={player.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-white/12 py-3 text-left transition-transform motion-reduce:transition-none"><span className="font-mono text-xs text-white/40">{index + 1}</span><span className="font-serif text-xl">{player.name}</span><span className="font-mono text-sm">{player.score}</span></li>)}</ol>; }
function PartyScreenMessage({ title, detail }: { title: string; detail: string }) { return <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"><div><h1 className="font-serif text-5xl font-semibold">{title}</h1><p className="mt-4 font-serif text-lg text-white/60">{detail}</p></div></main>; }
