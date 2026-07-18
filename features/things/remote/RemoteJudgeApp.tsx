import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { TextMorph } from "torph/react";
import { useWebHaptics } from "web-haptics/react";
import { closeRemoteRoomFn, readRemoteJudgeFn, sendRemoteJudgeCommandFn } from "./remote-room.functions";
import type { RemoteCommandRequest, RemoteGameKind, RemoteResultDecision, RemoteSyncedSnapshot } from "./types";
import { useRemoteSocket } from "./useRemoteSocket";
import { gameBrowserKeys, legacyGameBrowserKeys } from "../shared/game-keys";
import { clearExpiredGameLocalStorage, readExpiringLocalValue, removeStorageKeys, writeExpiringLocalValue } from "../shared/game-storage.client";
import { EndGameDialog } from "../shared/EndGameDialog";
import { shareOrCopy } from "../shared/share.client";
import { useQrCode } from "../shared/useQrCode";
import { useRoomReconciler } from "../shared/useRoomReconciler";

const SAFETY_POLL_MS = 12_000;

type RemoteCommandInput =
  | { type: "correct" | "incorrect" | "pass" | "skip" | "pause" | "resume" | "undo" }
  | { type: "amend"; resultId: string; decision: RemoteResultDecision };

function commandLabel(command: RemoteCommandInput) {
  if (command.type === "amend") return "Result update";
  return command.type === "pass" || command.type === "skip" ? "Skip" : `${command.type.at(0)?.toUpperCase()}${command.type.slice(1)}`;
}

interface StoredRoomTokens {
  judgeToken: string;
  playerToken: string;
  game: RemoteGameKind | null;
}

function tokensForRoom(roomId: string): StoredRoomTokens {
  const sessionKey = gameBrowserKeys.remoteJudgeSession(roomId);
  const hash = location.hash.slice(1).trim();
  if (hash) {
    const params = new URLSearchParams(hash);
    const judgeToken = params.get("judge") ?? (hash.includes("=") ? "" : hash);
    const playerToken = params.get("player") ?? "";
    const game = params.get("game");
    const session = { judgeToken, playerToken, game: game === "heads-up" || game === "spelling-bee" ? game : null } satisfies StoredRoomTokens;
    sessionStorage.setItem(sessionKey, JSON.stringify(session));
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return session;
  }
  try {
    const current = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null") as Partial<StoredRoomTokens> | null;
    if (current && typeof current.judgeToken === "string" && typeof current.playerToken === "string") {
      return { judgeToken: current.judgeToken, playerToken: current.playerToken, game: current.game === "heads-up" || current.game === "spelling-bee" ? current.game : null };
    }
  } catch {
    sessionStorage.removeItem(sessionKey);
  }
  const legacyJudgeKey = legacyGameBrowserKeys.remoteJudgeToken(roomId);
  const legacyPlayerKey = legacyGameBrowserKeys.remotePlayerInviteToken(roomId);
  const legacyGameKey = legacyGameBrowserKeys.remoteJudgeGame(roomId);
  const game = sessionStorage.getItem(legacyGameKey);
  const migrated = { judgeToken: sessionStorage.getItem(legacyJudgeKey) ?? "", playerToken: sessionStorage.getItem(legacyPlayerKey) ?? "", game: game === "heads-up" || game === "spelling-bee" ? game : null } satisfies StoredRoomTokens;
  if (migrated.judgeToken) sessionStorage.setItem(sessionKey, JSON.stringify(migrated));
  removeStorageKeys(sessionStorage, [legacyJudgeKey, legacyPlayerKey, legacyGameKey]);
  return migrated;
}

export function RemoteJudgeApp({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [tokens, setTokens] = useState<StoredRoomTokens>({ judgeToken: "", playerToken: "", game: null });
  const [snapshot, setSnapshot] = useState<RemoteSyncedSnapshot | null>(null);
  const [playerConnected, setPlayerConnected] = useState(false);
  const [judgeActive, setJudgeActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingCommandId, setPendingCommandId] = useState<string | null>(null);
  const [pendingCommandLabel, setPendingCommandLabel] = useState<string | null>(null);
  const [controlFeedback, setControlFeedback] = useState<string | null>(null);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [endingRoom, setEndingRoom] = useState(false);
  const judgeEpoch = useRef<string | null>(null);
  if (judgeEpoch.current === null) judgeEpoch.current = crypto.randomUUID();
  const takeoverRequested = useRef(false);
  const flushingCommands = useRef(false);
  const roomExpiresAt = useRef(Date.now() + 4 * 60 * 60 * 1_000);
  const haptics = useWebHaptics();

  const playerInviteUrl = tokens.playerToken && typeof window !== "undefined"
    ? `${location.origin}/things/play/${roomId}#${tokens.playerToken}`
    : null;
  const { dataUrl: qrCode } = useQrCode(playerInviteUrl, 280);

  useEffect(() => { clearExpiredGameLocalStorage(); setTokens(tokensForRoom(roomId)); }, [roomId]);

  useEffect(() => {
    if (!controlFeedback?.endsWith("accepted.")) return;
    const timeout = window.setTimeout(() => setControlFeedback(null), 1_600);
    return () => window.clearTimeout(timeout);
  }, [controlFeedback]);

  const reconcile = useCallback(async (isCurrent: () => boolean) => {
      try {
        const result = await readRemoteJudgeFn({ data: { roomId, judgeToken: tokens.judgeToken, judgeEpoch: judgeEpoch.current, takeover: takeoverRequested.current } });
        if (!isCurrent()) return;
        if (!result.ok) {
          setError(result.error ?? "This invite is no longer available.");
          setPlayerConnected(false);
          removeStorageKeys(sessionStorage, [gameBrowserKeys.remoteJudgeSession(roomId)]);
          removeStorageKeys(localStorage, [gameBrowserKeys.remotePendingCommands(roomId), legacyGameBrowserKeys.remotePendingCommands(roomId)]);
          return;
        }
        if (result.expiresAt) roomExpiresAt.current = result.expiresAt;
        takeoverRequested.current = false;
        setJudgeActive(result.judgeActive);
        setSnapshot(result.snapshot);
        let commandResolved = false;
        if (pendingCommandId && result.snapshot) {
          const receipt = result.snapshot.commandReceipts.find(({ commandId }) => commandId === pendingCommandId);
          if (receipt) {
            commandResolved = true;
            setPendingCommandId(null);
            setPendingCommandLabel(null);
            setControlFeedback(receipt.status === "applied" ? `${pendingCommandLabel ?? "Control"} accepted.` : null);
            setError(receipt.status === "applied" ? null : `Control ignored: ${receipt.reason ?? "game moved on"}.`);
          }
        }
        setPlayerConnected(result.playerConnected);
        if (!commandResolved) setError(null);
      } catch {
        if (isCurrent()) {
          setPlayerConnected(false);
          setError("Reconnecting…");
        }
      }
  }, [pendingCommandId, pendingCommandLabel, roomId, tokens.judgeToken]);

  const pollNow = useRoomReconciler({
    enabled: Boolean(tokens.judgeToken),
    intervalMs: SAFETY_POLL_MS,
    roomKey: tokens.judgeToken ? `${roomId}:${tokens.judgeToken}` : null,
    reconcile,
  });

  const { state: transportState, notify: notifySocket } = useRemoteSocket({
    roomId: tokens.judgeToken ? roomId : null,
    role: "judge",
    token: tokens.judgeToken || null,
    onWake: () => void pollNow(),
  });

  const send = useCallback(async (command: RemoteCommandInput) => {
    if (!tokens.judgeToken || !judgeActive || !playerConnected || sending || pendingCommandId || !snapshot?.roundId || (command.type !== "amend" && !snapshot.itemId)) return;
    const label = commandLabel(command);
    setSending(true);
    setControlFeedback(`${label} sent…`);
    const payload = {
      ...command,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      roundId: snapshot.roundId,
      itemId: snapshot.itemId ?? `results:${snapshot.roundId}`,
    } as RemoteCommandRequest;
    try {
      const result = await sendRemoteJudgeCommandFn({ data: { roomId, judgeToken: tokens.judgeToken, judgeEpoch: judgeEpoch.current, command: payload } });
      if (!result.ok) {
        setControlFeedback(null);
        setError(result.error ?? "Control did not send.");
      }
      else {
        setPendingCommandId(payload.id);
        setPendingCommandLabel(label);
        notifySocket();
        void haptics.trigger("selection");
      }
    } catch {
      const queueKey = gameBrowserKeys.remotePendingCommands(roomId);
      const stored = readExpiringLocalValue<RemoteCommandRequest[]>(queueKey) ?? [];
      writeExpiringLocalValue(queueKey, [...stored.filter(({ id }) => id !== payload.id), payload].slice(-20), roomExpiresAt.current);
      setControlFeedback(null);
      setError("Saved on this phone. Reconnecting…");
    } finally {
      setSending(false);
    }
  }, [haptics, judgeActive, notifySocket, pendingCommandId, playerConnected, roomId, sending, snapshot, tokens.judgeToken]);

  useEffect(() => {
    if (transportState !== "connected" || !tokens.judgeToken || !judgeActive || flushingCommands.current) return;
    const queueKey = gameBrowserKeys.remotePendingCommands(roomId);
    let commands = readExpiringLocalValue<RemoteCommandRequest[]>(queueKey) ?? [];
    if (!commands.length) {
      try {
        commands = JSON.parse(localStorage.getItem(legacyGameBrowserKeys.remotePendingCommands(roomId)) ?? "[]") as RemoteCommandRequest[];
        localStorage.removeItem(legacyGameBrowserKeys.remotePendingCommands(roomId));
      } catch { localStorage.removeItem(legacyGameBrowserKeys.remotePendingCommands(roomId)); }
    }
    if (!commands.length) return;
    flushingCommands.current = true;
    void (async () => {
      const remaining = [...commands];
      for (const command of commands) {
        try {
          const result = await sendRemoteJudgeCommandFn({ data: { roomId, judgeToken: tokens.judgeToken, judgeEpoch: judgeEpoch.current, command } });
          if (!result.ok && result.error !== "Round changed" && result.error !== "Card changed" && result.error !== "Command expired") break;
          remaining.shift();
          if (result.ok) { setPendingCommandId(command.id); setPendingCommandLabel(commandLabel(command)); notifySocket(); }
        } catch { break; }
      }
      if (remaining.length) writeExpiringLocalValue(queueKey, remaining, roomExpiresAt.current);
      else localStorage.removeItem(queueKey);
      flushingCommands.current = false;
    })();
  }, [judgeActive, notifySocket, roomId, tokens.judgeToken, transportState]);

  const handleSharePlayerInvite = async () => {
    if (!playerInviteUrl) return;
    const result = await shareOrCopy({ title: "Join the game", text: "Open this on the phone that will run the game.", url: playerInviteUrl });
    if (result === "shared") setError("Invite shared.");
    else if (result === "copied") setError("Player link copied.");
    else if (result === "failed") setError("Could not share. Ask the player to scan the code instead.");
  };

  const handleEndRoom = async () => {
    if (endingRoom) return;
    setEndingRoom(true);
    await closeRemoteRoomFn({ data: { roomId, role: "judge", token: tokens.judgeToken } }).catch(() => null);
    removeStorageKeys(sessionStorage, [
      gameBrowserKeys.remoteJudgeSession(roomId),
      legacyGameBrowserKeys.remoteJudgeToken(roomId),
      legacyGameBrowserKeys.remotePlayerInviteToken(roomId),
      legacyGameBrowserKeys.remoteJudgeGame(roomId),
    ]);
    removeStorageKeys(localStorage, [gameBrowserKeys.remotePendingCommands(roomId), legacyGameBrowserKeys.remotePendingCommands(roomId)]);
    await navigate({ to: "/things" });
  };

  const gameKind = snapshot?.game ?? tokens.game;
  const gameName = gameKind === "spelling-bee" ? "Spelling Bee" : gameKind === "heads-up" ? "Forehead" : "game";
  const decisionLabels = useMemo(() => snapshot?.game === "spelling-bee"
    ? ({ correct: "correct", incorrect: "incorrect", pass: "skipped", timed_out: "timed out" } as const)
    : ({ correct: "correct", incorrect: "pass", pass: "pass", timed_out: "timed out" } as const), [snapshot?.game]);
  const awaitingDecision = snapshot?.game === "spelling-bee" && snapshot.pauseReason === "checking final decisions";
  const controlsBusy = sending || pendingCommandId !== null;
  const decisionWindowOpen = !snapshot?.decisionClosesAt || Date.now() <= snapshot.decisionClosesAt;
  const canDecide = Boolean(judgeActive && playerConnected && snapshot?.phase === "playing" && !snapshot.transitioning && !snapshot.paused && decisionWindowOpen && !controlsBusy);
  const connectionLabel = playerConnected
    ? transportState === "connected" ? "● player connected" : "● reconnecting"
    : transportState === "connected" ? "waiting for player" : "reconnecting";
  const roundStatus = snapshot?.pauseReason === "checking final decisions"
    ? "Time’s up · checking final decisions…"
    : snapshot?.pauseReason === "possibly complete"
      ? "Spelling may be complete · waiting for your decision"
      : snapshot?.paused ? "Round paused" : null;

  if (!tokens.judgeToken) return <JudgeMessage title="Invite missing" detail="Ask the player to share the judge link again." />;

  return (
    <div className="things-game things-game--night text-white">
      <header className="flex items-center justify-between gap-4 p-5 font-mono text-xs text-white/55">
        <button type="button" onClick={() => setEndConfirmationOpen(true)} className="min-h-11 rounded-full border border-white/15 px-4 text-white/75">
          {tokens.playerToken ? "end game" : "leave judging"}
        </button>
        <span aria-live="polite" className={playerConnected && transportState === "connected" ? "text-emerald-200" : "text-amber-200"}>
          {connectionLabel}
        </span>
      </header>

      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-8">
        <p className="mt-4 font-mono text-micro uppercase tracking-[0.2em] text-white/45">remote judge · {gameName}</p>
        {!judgeActive ? <section className="mt-4 rounded-2xl border border-white/15 bg-white/[0.05] p-4 text-center" aria-labelledby="view-only-title"><h2 id="view-only-title" className="font-serif text-xl font-semibold">View only on this screen.</h2><p className="mt-1 font-mono text-xs text-white/50">Another judge screen owns the controls.</p><button type="button" onClick={() => { takeoverRequested.current = true; setControlFeedback("Taking over controls…"); void pollNow(); notifySocket(); }} className="mt-3 min-h-11 rounded-full border border-white/20 px-5 font-mono text-xs">take over controls</button></section> : null}
        {roundStatus ? <p role="status" className="mt-4 rounded-2xl border border-amber-200/20 bg-amber-200/[0.08] px-4 py-3 text-center font-mono text-xs text-amber-100">{roundStatus}</p> : null}
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
              <button type="button" disabled={!canDecide} onClick={() => void send({ type: snapshot.game === "spelling-bee" ? "incorrect" : "pass" })} className={`min-h-16 rounded-full border border-white/20 font-mono text-sm font-semibold disabled:opacity-30 ${pendingCommandLabel === (snapshot.game === "spelling-bee" ? "Incorrect" : "Skip") ? "ring-2 ring-white/35" : ""}`}>{snapshot.game === "spelling-bee" ? "incorrect" : "pass"}</button>
              <button type="button" disabled={!canDecide} onClick={() => void send({ type: "correct" })} className={`min-h-16 rounded-full bg-[var(--things-amber)] font-mono text-sm font-bold text-black disabled:opacity-30 ${pendingCommandLabel === "Correct" ? "ring-2 ring-white/70 ring-offset-2 ring-offset-[var(--things-night)]" : ""}`}>correct</button>
              {snapshot.game === "spelling-bee" ? <button type="button" disabled={!canDecide} onClick={() => void send({ type: "skip" })} className={`col-span-2 min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30 ${pendingCommandLabel === "Skip" ? "ring-2 ring-white/35" : ""}`}>skip this word</button> : null}
            </div>
            <p aria-live="polite" className="mt-3 min-h-5 text-center font-mono text-xs text-emerald-200">{controlFeedback}</p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button type="button" disabled={!judgeActive || !playerConnected || controlsBusy || snapshot.phase !== "playing" || snapshot.transitioning || snapshot.results.length === 0} onClick={() => void send({ type: "undo" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">undo last</button>
              <button type="button" disabled={!judgeActive || !playerConnected || controlsBusy || snapshot.phase !== "playing" || snapshot.transitioning || awaitingDecision} onClick={() => void send({ type: snapshot.paused ? "resume" : "pause" })} className="min-h-12 rounded-full border border-white/12 font-mono text-xs text-white/60 disabled:opacity-30">{snapshot.paused ? "resume round" : "pause round"}</button>
            </div>

              {snapshot.results.length > 0 ? <section className="mt-8" aria-labelledby="judged-items"><h2 id="judged-items" className="font-mono text-micro uppercase tracking-[0.18em] text-white/40">judged · tap to correct</h2><ul className="mt-3 border-t border-white/12">{snapshot.results.toReversed().slice(0, 8).map((result) => <li key={result.id} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-white/12 py-3"><span className="min-w-0 truncate font-serif text-lg">{result.label}</span><select aria-label={`Change result for ${result.label}`} value={result.decision} onChange={(event) => void send({ type: "amend", resultId: result.id, decision: event.target.value as RemoteResultDecision })} disabled={!judgeActive || !playerConnected || controlsBusy || !snapshot.roundId} className="min-h-11 rounded-full border border-white/15 bg-[var(--things-night)] px-3 font-mono text-xs text-white"><option value="correct">{decisionLabels.correct}</option><option value="incorrect">{decisionLabels.incorrect}</option>{snapshot.game === "spelling-bee" ? <option value="skipped">{decisionLabels.pass}</option> : <option value="pass">{decisionLabels.pass}</option>}{snapshot.game === "spelling-bee" ? <option value="timed_out">{decisionLabels.timed_out}</option> : null}</select></li>)}</ul></section> : null}
          </>
        )}
        <p aria-live="polite" className="mt-4 min-h-5 text-center font-mono text-xs text-amber-200/80">{error}</p>
      </main>

      {endConfirmationOpen ? (
        <EndGameDialog tone="dark" eyebrow={tokens.playerToken ? "end game" : "leave judging"} title={tokens.playerToken ? "End this game?" : "Leave judging?"} description={tokens.playerToken ? "This ends the game for both phones. It cannot be undone." : "The game will keep working on the player’s phone without this judge."} cancelLabel={tokens.playerToken ? "keep playing" : "stay"} confirmLabel={tokens.playerToken ? "end game" : "leave judging"} pending={endingRoom} onCancel={() => setEndConfirmationOpen(false)} onConfirm={() => void handleEndRoom()} />
      ) : null}
    </div>
  );
}

function JudgeMessage({ title, detail }: { title: string; detail: string }) {
  return <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white"><div><h1 className="font-serif text-5xl font-semibold">{title}</h1><p className="mt-4 font-serif text-lg text-white/60">{detail}</p></div></main>;
}
