import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { useQrCode } from "@/hooks/useQrCode";
import { approvePresentationControllerFn, controlPresentationFn } from "../presentation.functions";
import { readPublishedPitchFn } from "../pitches.functions";
import type { PublicPitchDeckDetail } from "../types";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { loadPitchFiles } from "./files.client";
import { usePresentationPoll } from "./usePresentationPoll";

function hostToken(roomId: string): string {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const fromHash = hash.get("host");
  if (fromHash) {
    sessionStorage.setItem(`pitch-presenter:${roomId}`, fromHash);
    history.replaceState(null, "", location.pathname);
    return fromHash;
  }
  return sessionStorage.getItem(`pitch-presenter:${roomId}`) ?? "";
}

export function PresentationHost({ roomId }: { roomId: string }) {
  const [token, setToken] = useState("");
  const [pitch, setPitch] = useState<PublicPitchDeckDetail>();
  const [files, setFiles] = useState<BinaryFiles>({});
  const [dockOpen, setDockOpen] = useState(true);
  const [audioArmed, setAudioArmed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => setToken(hostToken(roomId)), [roomId]);
  const credentials = useMemo(() => (token ? { hostToken: token } : undefined), [token]);
  const live = usePresentationPoll(roomId, credentials);
  const snapshot = live.snapshot;
  const invite =
    typeof location === "undefined"
      ? null
      : `${location.origin}/things/pitches/remote/${encodeURIComponent(roomId)}`;
  const { dataUrl: qr } = useQrCode(invite, 300);

  useEffect(() => {
    if (!snapshot?.selectedDeckId) {
      setPitch(undefined);
      return;
    }
    let cancelled = false;
    void readPublishedPitchFn({ data: { deckId: snapshot.selectedDeckId } }).then(
      async (loaded) => {
        if (!loaded || cancelled) return;
        setPitch(loaded);
        setFiles(await loadPitchFiles(loaded.assets));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [snapshot?.selectedDeckId]);

  const slides = pitch?.document.slides.filter((slide) => !slide.deletedAt) ?? [];
  const slide = slides[snapshot?.slideIndex ?? 0];
  const audio = slide?.audioAssetId
    ? pitch?.assets.find((asset) => asset.id === slide.audioAssetId)
    : undefined;

  const playAudio = useCallback((url: string) => {
    const player = audioRef.current ?? new Audio();
    audioRef.current = player;
    player.preload = "metadata";
    if (player.src !== url) player.src = url;
    if (player.paused) void player.play().catch(() => setAudioArmed(false));
  }, []);

  useEffect(() => {
    if (!audioArmed) return;
    if (audio?.url) playAudio(audio.url);
    else audioRef.current?.pause();
  }, [audio?.url, audioArmed, playAudio, snapshot?.slideIndex]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  function toggleAudio() {
    if (audioArmed) {
      audioRef.current?.pause();
      setAudioArmed(false);
      return;
    }
    setAudioArmed(true);
    if (audio?.url) playAudio(audio.url);
  }

  const action = useCallback(
    async (next: { type: "go"; direction: -1 | 1 }) => {
      if (!token) return;
      const result = await controlPresentationFn({
        data: {
          roomId,
          credential: token,
          actionId: `a_${crypto.randomUUID().replaceAll("-", "")}`,
          action: next,
        },
      });
      if (result.ok) live.setSnapshot(result.value);
    },
    [live, roomId, token],
  );

  async function approve(controllerId: string, approved: boolean) {
    const result = await approvePresentationControllerFn({
      data: { roomId, hostToken: token, controllerId, approved },
    });
    if (result.ok) live.setSnapshot(result.value);
  }

  if (!token) {
    return (
      <main id="main" className="mx-auto max-w-xl px-6 py-20">
        <h1 className="font-serif text-4xl">This screen needs its host link.</h1>
        <Link
          to="/things/pitches/present"
          className="mt-8 inline-block font-mono text-sm underline"
        >
          open a new room
        </Link>
      </main>
    );
  }

  return (
    <main id="main" className="relative h-screen overflow-hidden bg-background">
      {slide ? (
        <ExcalidrawSurface
          key={`${pitch?.id}:${slide.id}`}
          elements={slide.elements}
          files={files}
          readOnly
        />
      ) : (
        <div className="flex h-full items-center justify-center px-8 text-center">
          <div>
            <p className="font-mono text-micro uppercase tracking-[0.18em] theme-muted">
              {snapshot?.eventTitle ?? "The Pitch Night"}
            </p>
            <h1 className="mt-4 font-serif text-5xl text-foreground sm:text-7xl">
              Scan. Ask nicely. Take the screen.
            </h1>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setDockOpen((open) => !open)}
        className="absolute right-4 top-4 z-20 min-h-10 rounded-full bg-foreground px-4 font-mono text-xs text-background opacity-70 hover:opacity-100"
      >
        {dockOpen ? "hide host" : `host · ${roomId}`}
      </button>

      {dockOpen ? (
        <aside className="absolute bottom-4 left-4 right-4 z-20 max-h-[65vh] overflow-auto bg-background/95 p-4 shadow-xl backdrop-blur sm:left-auto sm:w-96">
          <div className="flex items-center gap-4">
            {qr ? <img src={qr} alt={`Join presentation ${roomId}`} className="h-24 w-24" /> : null}
            <div>
              <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
                remote code
              </p>
              <p className="font-mono text-3xl tracking-[0.18em] text-foreground">{roomId}</p>
              <p className="mt-1 font-mono text-micro theme-muted">approve each phone below</p>
            </div>
          </div>

          <div className="mt-4 border-t theme-border pt-3">
            {snapshot?.controllers.length ? (
              snapshot.controllers.map((controller) => (
                <div key={controller.id} className="flex items-center gap-3 py-2 font-mono text-xs">
                  <span className="min-w-0 flex-1 truncate">{controller.name}</span>
                  <span className="theme-muted">{controller.status}</span>
                  {controller.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void approve(controller.id, true)}
                        className="underline"
                      >
                        allow
                      </button>
                      <button
                        type="button"
                        onClick={() => void approve(controller.id, false)}
                        className="theme-muted underline"
                      >
                        deny
                      </button>
                    </>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="font-mono text-xs theme-muted">Waiting for a phone…</p>
            )}
          </div>

          {slide ? (
            <div className="mt-4 flex items-center justify-between border-t theme-border pt-3">
              <button
                type="button"
                disabled={(snapshot?.slideIndex ?? 0) === 0}
                onClick={() => void action({ type: "go", direction: -1 })}
                className="min-h-10 px-3 font-mono disabled:opacity-25"
              >
                ←
              </button>
              <span className="font-mono text-xs theme-muted">
                {(snapshot?.slideIndex ?? 0) + 1} / {slides.length}
              </span>
              <button
                type="button"
                disabled={(snapshot?.slideIndex ?? 0) >= slides.length - 1}
                onClick={() => void action({ type: "go", direction: 1 })}
                className="min-h-10 px-3 font-mono disabled:opacity-25"
              >
                →
              </button>
              <button
                type="button"
                onClick={toggleAudio}
                className="min-h-10 border-b theme-border px-2 font-mono text-xs"
              >
                sound {audioArmed ? "armed" : "off"}
              </button>
            </div>
          ) : null}
          {live.message ? (
            <p className="mt-3 font-mono text-xs theme-muted">{live.message}</p>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
