import { useEffect, useMemo, useState } from "react";

import { controlPresentationFn, joinPresentationFn } from "../presentation.functions";
import { listPublishedPitchesFn } from "../pitches.functions";
import type { PitchControllerCredentials, PublicPitchDeck } from "../types";
import { usePresentationPoll } from "./usePresentationPoll";

function sessionKey(roomId: string) {
  return `pitch-remote:${roomId}`;
}

function readCredentials(roomId: string): PitchControllerCredentials | undefined {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(sessionKey(roomId)) ?? "null",
    ) as PitchControllerCredentials | null;
    if (parsed?.roomId === roomId && parsed.expiresAt > Date.now()) return parsed;
    if (parsed) localStorage.removeItem(sessionKey(roomId));
    return undefined;
  } catch {
    return undefined;
  }
}

export function PresentationRemote({ roomId }: { roomId: string }) {
  const [credentials, setCredentials] = useState<PitchControllerCredentials>();
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [query, setQuery] = useState("");
  const [pitches, setPitches] = useState<PublicPitchDeck[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setHydrated(true);
    setCredentials(readCredentials(roomId));
  }, [roomId]);
  const pollCredentials = useMemo(
    () =>
      credentials
        ? {
            controllerId: credentials.controllerId,
            controllerToken: credentials.controllerToken,
          }
        : undefined,
    [credentials],
  );
  const live = usePresentationPoll(roomId, pollCredentials);
  const self = live.snapshot?.controllers.find(
    (controller) => controller.id === credentials?.controllerId,
  );

  useEffect(() => {
    if (self?.status !== "approved") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void listPublishedPitchesFn({ data: { search: query } }).then((result) => {
        if (!cancelled) setPitches(result.pitches);
      });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, self?.status]);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    setJoining(true);
    const result = await joinPresentationFn({ data: { roomId, name } });
    if (!result.ok) {
      setMessage(result.error);
      setJoining(false);
      return;
    }
    localStorage.setItem(sessionKey(roomId), JSON.stringify(result.value));
    setCredentials(result.value);
    setJoining(false);
  }

  async function act(
    action: { type: "select"; deckId: string } | { type: "go"; direction: -1 | 1 },
  ) {
    if (!credentials) return;
    const result = await controlPresentationFn({
      data: {
        roomId,
        credential: credentials.controllerToken,
        controllerId: credentials.controllerId,
        actionId: `a_${crypto.randomUUID().replaceAll("-", "")}`,
        action,
      },
    });
    if (result.ok) {
      live.setSnapshot(result.value);
      setMessage("");
    } else setMessage(result.error);
  }

  if (!credentials) {
    return (
      <main id="main" className="mx-auto min-h-screen max-w-md px-6 py-16">
        <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">
          screen {roomId}
        </p>
        <h1 className="mt-4 font-serif text-5xl text-foreground">Ask for the remote.</h1>
        <p className="mt-4 font-serif text-lg theme-muted">
          The host will see your name and decide whether to hand you the room.
        </p>
        <form onSubmit={join} className="mt-10">
          <label className="font-mono text-xs uppercase tracking-[0.12em] theme-muted">
            your name
            <input
              required
              disabled={!hydrated}
              autoComplete="name"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-3 block min-h-14 w-full border-b theme-border-strong bg-transparent font-serif text-2xl normal-case tracking-normal text-foreground outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={!hydrated || joining}
            className="mt-8 min-h-12 w-full bg-foreground px-5 font-mono text-sm text-background disabled:opacity-40"
          >
            {joining ? "asking…" : "request control →"}
          </button>
        </form>
        {message ? <p className="mt-4 font-mono text-xs theme-muted">{message}</p> : null}
      </main>
    );
  }

  if (!self || self.status === "pending") {
    return (
      <main id="main" className="flex min-h-screen items-center justify-center px-6 text-center">
        <div>
          <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
            screen {roomId}
          </p>
          <h1 className="mt-4 font-serif text-5xl text-foreground">Waiting for the nod.</h1>
          <p className="mt-4 font-mono text-sm theme-muted">
            Keep this open. The controls appear when the host approves you.
          </p>
        </div>
      </main>
    );
  }

  if (self.status === "revoked") {
    return (
      <main id="main" className="flex min-h-screen items-center justify-center px-6 text-center">
        <h1 className="font-serif text-4xl text-foreground">The host kept the remote.</h1>
      </main>
    );
  }

  return (
    <main id="main" className="mx-auto min-h-screen max-w-lg px-6 py-10">
      <p className="font-mono text-micro uppercase tracking-[0.16em] theme-muted">
        you have the room · {roomId}
      </p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void act({ type: "go", direction: -1 })}
          className="min-h-24 border theme-border-strong font-mono text-3xl active:scale-[0.98]"
        >
          ←<span className="mt-2 block text-micro theme-muted">previous</span>
        </button>
        <button
          type="button"
          onClick={() => void act({ type: "go", direction: 1 })}
          className="min-h-24 border theme-border-strong font-mono text-3xl active:scale-[0.98]"
        >
          →<span className="mt-2 block text-micro theme-muted">next</span>
        </button>
      </div>
      <label className="mt-10 block font-mono text-xs uppercase tracking-[0.12em] theme-muted">
        choose a pitch
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-3 block min-h-12 w-full border-b theme-border-strong bg-transparent font-mono text-base normal-case tracking-normal text-foreground outline-none"
          placeholder="name or idea"
        />
      </label>
      <div className="mt-4 divide-y theme-border border-y">
        {pitches.map((pitch) => (
          <button
            key={pitch.id}
            type="button"
            onClick={() => void act({ type: "select", deckId: pitch.id })}
            className="block min-h-16 w-full py-3 text-left hover:opacity-60"
          >
            <span className="block font-serif text-xl text-foreground">{pitch.title}</span>
            <span className="font-mono text-micro theme-muted">
              {pitch.ownerName} · {pitch.slideCount} slides
            </span>
          </button>
        ))}
      </div>
      {message || live.message ? (
        <p className="mt-4 font-mono text-xs theme-muted" role="status">
          {message || live.message}
        </p>
      ) : null}
    </main>
  );
}
