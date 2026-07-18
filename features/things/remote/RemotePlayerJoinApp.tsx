import { useEffect, useState } from "react";
import { prepareThingOffline } from "@/features/offline/client";
import { HeadsUpApp } from "../heads-up/HeadsUpApp";
import { SpellingBeeApp } from "../spelling-bee/SpellingBeeApp";
import { readPairedGamePlayerSetupFn } from "./paired-game-room.functions";
import type { RemotePlayerSession } from "./types";
import { legacyRemoteBrowserKeys, remoteBrowserKeys } from "./remote-keys";
import { removeStorageKeys } from "../shared/game-storage.client";

function sessionKey(roomId: string) {
  return remoteBrowserKeys.playerSession(roomId);
}

function playerTokenForRoom(roomId: string) {
  const hashToken = location.hash.slice(1).trim();
  if (hashToken) {
    sessionStorage.setItem(sessionKey(roomId), JSON.stringify({ playerToken: hashToken }));
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return hashToken;
  }
  try {
    const current = JSON.parse(sessionStorage.getItem(sessionKey(roomId)) ?? "null") as { playerToken?: unknown } | null;
    if (typeof current?.playerToken === "string") return current.playerToken;
  } catch { sessionStorage.removeItem(sessionKey(roomId)); }
  const legacyKey = legacyRemoteBrowserKeys.playerToken(roomId);
  const legacy = sessionStorage.getItem(legacyKey) ?? "";
  sessionStorage.removeItem(legacyKey);
  if (legacy) sessionStorage.setItem(sessionKey(roomId), JSON.stringify({ playerToken: legacy }));
  return legacy;
}

function cachedSession(roomId: string): RemotePlayerSession | null {
  try {
    let raw = sessionStorage.getItem(sessionKey(roomId));
    if (!raw) {
      const legacyKey = legacyRemoteBrowserKeys.playerSession(roomId);
      raw = sessionStorage.getItem(legacyKey);
      if (raw) sessionStorage.setItem(sessionKey(roomId), raw);
      sessionStorage.removeItem(legacyKey);
    }
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<RemotePlayerSession>;
    if (session.roomId !== roomId || typeof session.playerToken !== "string" || typeof session.expiresAt !== "number" || session.expiresAt <= Date.now() || !session.setup) {
      if (typeof session.expiresAt === "number" && session.expiresAt <= Date.now()) removeStorageKeys(sessionStorage, [sessionKey(roomId), legacyRemoteBrowserKeys.playerSession(roomId)]);
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
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const nextToken = playerTokenForRoom(roomId);
    setToken(nextToken);
    setSession(cachedSession(roomId));
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
          removeStorageKeys(sessionStorage, [sessionKey(roomId), legacyRemoteBrowserKeys.playerSession(roomId), legacyRemoteBrowserKeys.playerToken(roomId)]);
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
