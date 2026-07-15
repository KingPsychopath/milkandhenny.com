import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import QRCode from "qrcode";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { closeRemoteRoomFn, readRemoteJudgeFn, sendRemoteJudgeCommandFn } from "./remote-room.functions";
import type { RemoteCommandRequest, RemoteGameKind, RemoteResultDecision, RemoteSyncedSnapshot } from "./types";
import { useRemoteSocket } from "./useRemoteSocket";

const SAFETY_POLL_MS = 12_000;

type RemoteCommandInput =
  | { type: "correct" | "incorrect" | "pass" | "pause" | "resume" | "undo" }
  | { type: "amend"; resultId: string; decision: RemoteResultDecision };

interface StoredRoomTokens {
  judgeToken: string;
  playerToken: string;
  game: RemoteGameKind | null;
}

function tokensForRoom(roomId: string): StoredRoomTokens {
  const judgeKey = `thing-judge-token:v2:${roomId}`;
  const playerKey = `thing-player-invite-token:v2:${roomId}`;
  const gameKey = `thing-judge-game:v2:${roomId}`;
  const hash = location.hash.slice(1).trim();
  if (hash) {
    const params = new URLSearchParams(hash);
    const judgeToken = params.get("judge") ?? (hash.includes("=") ? "" : hash);
    const playerToken = params.get("player") ?? "";
    const game = params.get("game");
    if (judgeToken) sessionStorage.setItem(judgeKey, judgeToken);
    if (playerToken) sessionStorage.setItem(playerKey, playerToken);
    if (game === "heads-up" || game === "spelling-bee") sessionStorage.setItem(gameKey, game);
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
  return {
    judgeToken: sessionStorage.getItem(judgeKey) ?? "",
    playerToken: sessionStorage.getItem(playerKey) ?? "",
    game: sessionStorage.getItem(gameKey) === "spelling-bee" ? "spelling-bee" : sessionStorage.getItem(gameKey) === "heads-up" ? "heads-up" : null,
  };
}

export function RemoteJudgeApp({ roomId }: { roomId: string }) {
  const [tokens, setTokens] = useState<StoredRoomTokens>({ judgeToken: "", playerToken: "", game: null });
  const [snapshot, setSnapshot] = useState<RemoteSyncedSnapshot | null>(null);
  const [playerConnected, setPlayerConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const pollNowRef = useRef<(() => void) | null>(null);
  const flushingCommands = useRef(false);
  const haptics = useWebHaptics();

  const { state: transportState, notify: notifySocket } = useRemoteSocket({
    roomId: tokens.judgeToken ? roomId : null,
    role: "judge",
    token: tokens.judgeToken || null,
    onWake: () => pollNowRef.current?.(),
  });

  const playerInviteUrl = tokens.playerToken && typeof window !== "undefined"
    ? `${location.origin}/things/play/${roomId}#${tokens.playerToken}`
    : null;

  useEffect(() => setTokens(tokensForRoom(roomId)), [roomId]);

  useEffect(() => {
    if (!playerInviteUrl) {
      setQrCode(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(playerInviteUrl, { width: 280, margin: 1 }).then((value) => {
      if (active) setQrCode(value);
    });
    return () => { active = false; };
  }, [playerInviteUrl]);

  useEffect(() => {
    if (!tokens.judgeToken) return;
    let active = true;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      try {
        const result = await readRemoteJudgeFn({ data: { roomId, judgeToken: tokens.judgeToken } });
        if (!active) return;
        if (!result.ok) {
          setError(result.error ?? "This invite is no longer available.");
          setPlayerConnected(false);
          return;
        }
        setSnapshot(result.snapshot);
        let commandResolved = false;
        if (pendingCommandId && result.snapshot) {
          const receipt = result.snapshot.commandReceipts.find(({ commandId }) => commandId === pendingCommandId);
          if (receipt) {
            commandResolved = true;
            setPendingCommandId(null);
            setError(receipt.status === "applied" ? null : `Control ignored: ${receipt.reason ?? "game moved on"}.`);
          }
        }
        setPlayerConnected(result.playerConnected);
        if (!commandResolved) setError(null);
      } catch {
        if (active) {
          setPlayerConnected(false);
          setError("Reconnecting…");
        }
      } finally {
        inFlight = false;
      }
    };
    const handleResume = () => void poll();
    pollNowRef.current = () => void poll();
    void poll();
    const interval = window.setInterval(() => void poll(), SAFETY_POLL_MS);
    window.addEventListener("online", handleResume);
    document.addEventListener("visibilitychange", handleResume);
    return () => {
      active = false;
      pollNowRef.current = null;
      window.clearInterval(interval);
      window.removeEventListener("online", handleResume);
      document.removeEventListener("visibilitychange", handleResume);
    };
  }, [pendingCommandId, roomId, tokens.judgeToken]);

  const send = useCallback(async (command: RemoteCommandInput) => {
    if (!tokens.judgeToken || !playerConnected || sending || !snapshot?.roundId || !snapshot.itemId) return;
    setSending(true);
    const payload = {
      ...command,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      roundId: snapshot.roundId,
      itemId: snapshot.itemId,
    } as RemoteCommandRequest;
    try {
      const result = await sendRemoteJudgeCommandFn({ data: { roomId, judgeToken: tokens.judgeToken, command: payload } });
      if (!result.ok) setError(result.error ?? "Control did not send.");
      else {
        setPendingCommandId(payload.id);
        notifySocket();
        void haptics.trigger("selection");
      }
    } catch {
      const queueKey = `thing-judge-command-queue:v2:${roomId}`;
      try {
        const stored = JSON.parse(localStorage.getItem(queueKey) ?? "[]") as RemoteCommandRequest[];
        localStorage.setItem(queueKey, JSON.stringify([...stored.filter(({ id }) => id !== payload.id), payload].slice(-20)));
      } catch { localStorage.setItem(queueKey, JSON.stringify([payload])); }
      setError("Saved on this phone. Reconnecting…");
    } finally {
      setSending(false);
    }
  }, [haptics, notifySocket, playerConnected, roomId, sending, snapshot, tokens.judgeToken]);

  useEffect(() => {
    if (transportState !== "connected" || !tokens.judgeToken || flushingCommands.current) return;
    const queueKey = `thing-judge-command-queue:v2:${roomId}`;
    let commands: RemoteCommandRequest[] = [];
    try { commands = JSON.parse(localStorage.getItem(queueKey) ?? "[]") as RemoteCommandRequest[]; } catch { localStorage.removeItem(queueKey); }
    if (!commands.length) return;
    flushingCommands.current = true;
    void (async () => {
      const remaining = [...commands];
      for (const command of commands) {
        try {
          const result = await sendRemoteJudgeCommandFn({ data: { roomId, judgeToken: tokens.judgeToken, command } });
          if (!result.ok && result.error !== "Round changed" && result.error !== "Card changed" && result.error !== "Command expired") break;
          remaining.shift();
          if (result.ok) { setPendingCommandId(command.id); notifySocket(); }
        } catch { break; }
      }
      localStorage.setItem(queueKey, JSON.stringify(remaining));
      flushingCommands.current = false;
    })();
  }, [notifySocket, roomId, tokens.judgeToken, transportState]);

  const handleSharePlayerInvite = async () => {
    if (!playerInviteUrl) return;
    try {
      if (navigator.share) await navigator.share({ title: "Join the game", text: "Open this on the phone that will run the game.", url: playerInviteUrl });
      else {
        await navigator.clipboard.writeText(playerInviteUrl);
        setError("Player link copied.");
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      setError("Could not share. Ask the player to scan the code instead.");
    }
  };

  const handleEndRoom = async () => {
    if (!tokens.playerToken || !window.confirm("End this remote game for both phones?")) return;
    await closeRemoteRoomFn({ data: { roomId, role: "judge", token: tokens.judgeToken } }).catch(() => null);
    sessionStorage.removeItem(`thing-judge-token:v2:${roomId}`);
    sessionStorage.removeItem(`thing-player-invite-token:v2:${roomId}`);
    sessionStorage.removeItem(`thing-judge-game:v2:${roomId}`);
    window.location.assign("/things");
  };

  const gameKind = snapshot?.game ?? tokens.game;
  const gameName = gameKind === "spelling-bee" ? "Spelling Bee" : gameKind === "heads-up" ? "Forehead" : "game";
  const decisionLabels = useMemo(() => snapshot?.game === "spelling-bee"
    ? ({ correct: "correct", incorrect: "incorrect", pass: "skip" } as const)
    : ({ correct: "correct", incorrect: "pass", pass: "pass" } as const), [snapshot?.game]);

  if (!tokens.judgeToken) return <JudgeMessage title="Invite missing" detail="Ask the player to share the judge link again." />;

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between gap-4 p-5 font-mono text-xs text-white/55">
        {tokens.playerToken ? <button type="button" onClick={() => void handleEndRoom()} className="min-h-11">end game</button> : <Link to="/things" className="inline-flex min-h-11 items-center">← things</Link>}
        <span aria-live="polite" className={playerConnected ? "text-emerald-200" : "text-amber-200"}>
          {playerConnected ? (transportState === "connected" ? "● player connected" : "● connected · recovering") : "reconnecting / waiting"}
        </span>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-8">
        <p className="mt-4 font-mono text-micro uppercase tracking-[0.2em] text-white/45">remote judge · {gameName}</p>
        {!snapshot ? (
          playerInviteUrl ? (
            <section className="flex flex-1 flex-col items-center justify-center py-10 text-center" aria-labelledby="player-invite-title">
              <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">this phone is the judge</p>
              <h1 id="player-invite-title" className="mt-3 font-serif text-5xl font-semibold">Scan to play.</h1>
              <p className="mt-4 max-w-sm font-serif text-lg text-white/55">Open this code on the phone that will show the game and request any motion or microphone access.</p>
              {qrCode ? <img src={qrCode} alt="QR code to open the game on the player’s phone" className="mt-7 w-56 rounded-3xl bg-white p-3" /> : null}
              <p className="mt-4 font-mono text-sm tracking-[0.18em] text-white/60">{roomId}</p>
              <button type="button" onClick={() => void handleSharePlayerInvite()} className="mt-5 min-h-12 rounded-full border border-white/20 px-6 font-mono text-sm">share player invite</button>
              <p className="mt-5 font-mono text-xs text-white/45">{playerConnected ? "Player connected. Waiting for them to start…" : "Waiting for the player to scan…"}</p>
            </section>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
              <h1 className="font-serif text-5xl font-semibold">Waiting for the game.</h1>
              <p className="mt-4 font-serif text-lg text-white/55">Keep this screen open. It will connect automatically.</p>
            </div>
          )
        ) : (
          <>
            <section className="mt-6 rounded-[2rem] border border-white/12 bg-white/[0.05] p-6 text-center" aria-labelledby="current-item">
              <div className="flex items-center justify-between font-mono text-xs text-white/45"><span className="max-w-[50%] truncate">{snapshot.deckName}</span><span>{snapshot.secondsRemaining === null ? "untimed" : `${snapshot.secondsRemaining}s`}</span></div>
              <p className="mt-9 font-mono text-micro uppercase tracking-[0.2em] text-white/40">current</p>
              <div id="current-item"><TextMorph as="h1" className="mt-3 break-words font-serif text-5xl font-semibold leading-none [overflow-wrap:anywhere]">{snapshot.currentLabel ?? (snapshot.phase === "results" ? "Round complete" : "Get ready")}</TextMorph></div>
              {snapshot.currentPartOfSpeech || snapshot.currentDefinition ? <p className="mx-auto mt-4 max-w-sm font-serif text-base leading-relaxed text-white/55">{snapshot.currentPartOfSpeech ? <em>{snapshot.currentPartOfSpeech}</em> : null}{snapshot.currentPartOfSpeech && snapshot.currentDefinition ? " · " : null}{snapshot.currentDefinition}</p> : null}
              {snapshot.transcript ? <p className="mt-5 font-mono text-sm tracking-[0.12em] text-amber-200">heard · {snapshot.transcript}</p> : null}
              <div className="mt-8 border-t border-white/10 pt-4 text-left"><p className="font-mono text-micro uppercase tracking-[0.16em] text-white/35">up next</p><p className="mt-1 truncate font-serif text-lg text-white/60">{snapshot.nextLabel ?? "—"}</p></div>
            </section>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button type="button" disabled={!playerConnected || sending || snapshot.phase !== "playing" || snapshot.paused || snapshot.transitioning} onClick={() => void send({ type: snapshot.game === "spelling-bee" ? "incorrect" : "pass" })} className="min-h-16 rounded-full border border-white/20 font-mono text-sm font-semibold disabled:opacity-30">{snapshot.game === "spelling-bee" ? "incorrect / skip" : "pass"}</button>
              <button type="button" disabled={!playerConnected || sending || snapshot.phase !== "playing" || snapshot.paused || snapshot.transitioning} onClick={() => void send({ type: "correct" })} className="min-h-16 rounded-full bg-[var(--things-amber)] font-mono text-sm font-bold text-black disabled:opacity-30">correct</button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" disabled={!playerConnected || snapshot.results.length === 0} onClick={() => void send({ type: "undo" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">undo</button>
              <button type="button" disabled={!playerConnected || snapshot.phase !== "playing" || snapshot.paused} onClick={() => void send({ type: "pause" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">pause</button>
              <button type="button" disabled={!playerConnected || snapshot.phase !== "playing" || !snapshot.paused} onClick={() => void send({ type: "resume" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">resume</button>
            </div>

            {snapshot.results.length > 0 ? <section className="mt-8" aria-labelledby="judged-items"><h2 id="judged-items" className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">judged · tap to correct</h2><ul className="mt-3 border-t border-white/12">{snapshot.results.toReversed().slice(0, 8).map((result) => <li key={result.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/12 py-3"><span className="min-w-0 truncate font-serif text-lg">{result.label}</span><select aria-label={`Change result for ${result.label}`} value={result.decision} onChange={(event) => void send({ type: "amend", resultId: result.id, decision: event.target.value as RemoteResultDecision })} disabled={!playerConnected} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-3 font-mono text-xs text-white"><option value="correct">{decisionLabels.correct}</option><option value="incorrect">{decisionLabels.incorrect}</option><option value="pass">{decisionLabels.pass}</option></select></li>)}</ul></section> : null}
          </>
        )}
        <p aria-live="polite" className="mt-4 min-h-5 text-center font-mono text-xs text-amber-200/80">{error}</p>
      </main>
    </div>
  );
}

function JudgeMessage({ title, detail }: { title: string; detail: string }) {
  return <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"><div><h1 className="font-serif text-5xl font-semibold">{title}</h1><p className="mt-4 font-serif text-lg text-white/60">{detail}</p></div></main>;
}
