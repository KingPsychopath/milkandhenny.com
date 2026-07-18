import { useEffect, useState } from "react";
import { prepareThingOffline } from "@/features/offline/client";
import { HeadsUpApp } from "../heads-up/HeadsUpApp";
import { SpellingBeeApp } from "../spelling-bee/SpellingBeeApp";
import { readPairedGamePlayerSetupFn } from "./paired-game-room.functions";
import type { RemotePlayerSession } from "./types";
import { remoteBrowserKeys } from "./remote-keys";
import { consumeLocationFragment } from "@/lib/client/url-fragment";
import { parsePairedGamePlayerFragment } from "./paired-game-invite";

function sessionKey(roomId: string) {
  return remoteBrowserKeys.playerSession(roomId);
}

function playerTokenForRoom(roomId: string) {
  const hashToken = parsePairedGamePlayerFragment(consumeLocationFragment());
  if (hashToken) {
    sessionStorage.setItem(sessionKey(roomId), JSON.stringify({ playerToken: hashToken }));
    return hashToken;
  }
  try {
    const current = JSON.parse(sessionStorage.getItem(sessionKey(roomId)) ?? "null") as { playerToken?: unknown } | null;
    if (typeof current?.playerToken === "string") return current.playerToken;
  } catch { sessionStorage.removeItem(sessionKey(roomId)); }
  return "";
}

function cachedSession(roomId: string): RemotePlayerSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(roomId));
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<RemotePlayerSession>;
    if (session.roomId !== roomId || typeof session.playerToken !== "string" || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now() || !session.setup) {
      if (typeof session.expiresAt === "number" && session.expiresAt <= Date.now()) sessionStorage.removeItem(sessionKey(roomId));
      return null;
    }
    if (typeof session.connectionEpoch !== "string") session.connectionEpoch = crypto.randomUUID();
    return session as RemotePlayerSession;
  } catch {
    return null;
  }
}

export function RemotePlayerJoinApp({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<RemotePlayerSession | null>(null);
  const [sessionReadyForRoom, setSessionReadyForRoom] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const nextToken = playerTokenForRoom(roomId);
    setToken(nextToken);
    setSession(cachedSession(roomId));
    setSessionReadyForRoom(roomId);
  }, [roomId]);

  useEffect(() => {
    if (!token || session) return;
    let active = true;
    const load = async () => {
      setError(null);
      try {
        const result = await readPairedGamePlayerSetupFn({ data: { roomId, playerToken: token } });
        if (!active) return;
        if (!result.ok) {
          setError(result.error);
          sessionStorage.removeItem(sessionKey(roomId));
          return;
        }
        const next: RemotePlayerSession = { roomId, playerToken: token, connectionEpoch: crypto.randomUUID(), expiresAt: result.expiresAt, setup: result.setup };
        sessionStorage.setItem(sessionKey(roomId), JSON.stringify(next));
        setSession(next);
      } catch {
        if (active) setError("Could not load the game. Check your connection and try again.");
      }
    };
    void load();
    return () => { active = false; };
  }, [attempt, roomId, session, token]);

  useEffect(() => {
    if (session) void prepareThingOffline(session.setup.game, { refresh: true });
  }, [session]);

  if (session?.setup.game === "heads-up") return <HeadsUpApp remoteSession={session} />;
  if (session?.setup.game === "spelling-bee") return <SpellingBeeApp remoteSession={session} />;
  if (sessionReadyForRoom !== roomId)
    return <PlayerInviteMessage title="Opening your game…" detail="Keep this screen open for a moment." />;

  return (
    <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white">
      <div className="max-w-sm">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">player phone</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">{token ? "Loading your game…" : "Invite missing"}</h1>
        <p className="mt-4 font-serif text-lg text-white/60">{error ?? (token ? "Keep this screen open for a moment." : "Ask the judge to share the player link again.")}</p>
        {error ? <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-6 min-h-12 rounded-full bg-[var(--things-amber)] px-6 font-mono text-sm font-semibold text-black">try again</button> : null}
      </div>
    </main>
  );
}

function PlayerInviteMessage({ title, detail }: { title: string; detail: string }) {
  return (
    <main id="main" className="things-game things-game--night flex items-center justify-center px-6 text-center text-white">
      <div className="max-w-sm">
        <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/45">player phone</p>
        <h1 className="mt-3 font-serif text-5xl font-semibold">{title}</h1>
        <p className="mt-4 font-serif text-lg text-white/60">{detail}</p>
      </div>
    </main>
  );
}
