import { type CSSProperties, useEffect, useRef, useState } from "react";

import { usePitchNightAudio } from "./PitchNightAudio";

const SECONDS_PER_REVOLUTION = 12;

function pointerAngle(element: HTMLElement, clientX: number, clientY: number): number {
  const rect = element.getBoundingClientRect();
  return Math.atan2(clientY - (rect.top + rect.height / 2), clientX - (rect.left + rect.width / 2));
}

function normalizedAngleDelta(next: number, previous: number): number {
  let delta = next - previous;
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function PitchNightVinyl() {
  const {
    beginScratch,
    enabled,
    endScratch,
    musicPlaying,
    scratching,
    scratchMusicBy,
    seekMusicBy,
    setMusicPlaying,
  } = usePitchNightAudio();
  const lastAngleRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const rotationRef = useRef(0);
  const draggedRef = useRef(false);
  const scratchingRef = useRef(false);
  const pendingSeekRef = useRef(0);
  const pendingTimeRef = useRef(0);
  const frameRef = useRef<number | undefined>(undefined);
  const wasPlayingRef = useRef(false);
  const [hasScratched, setHasScratched] = useState(false);

  const flushSeek = () => {
    frameRef.current = undefined;
    const seconds = pendingSeekRef.current;
    const elapsed = pendingTimeRef.current;
    pendingSeekRef.current = 0;
    pendingTimeRef.current = 0;
    scratchMusicBy(seconds, elapsed > 0 ? seconds / elapsed : 0);
  };

  useEffect(
    () => () => {
      if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
      if (scratchingRef.current) endScratch();
    },
    [endScratch],
  );

  const finishScratch = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!scratchingRef.current) return;
    scratchingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (frameRef.current !== undefined) {
      window.cancelAnimationFrame(frameRef.current);
      flushSeek();
    }
    endScratch();
  };

  return (
    <div className="pitch-night-vinyl-wrap">
      <div className="pitch-night-vinyl-motion" data-vinyl>
        <button
          type="button"
          className="pitch-night-vinyl"
          style={{ "--vinyl-scratch-angle": "0deg" } as CSSProperties}
          aria-describedby="pitch-night-vinyl-help"
          aria-label={`Apartment Life soundtrack ${scratching ? "scratching" : musicPlaying ? "playing" : "paused"}. Drag the record and the song follows your hand, or press the arrow keys to rewind and fast-forward.`}
          aria-pressed={musicPlaying}
          data-scratching={scratching || undefined}
          onClick={(event) => {
            if (draggedRef.current) {
              event.preventDefault();
              draggedRef.current = false;
              return;
            }
            setMusicPlaying(!wasPlayingRef.current);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " " || event.key === "Space") {
              event.preventDefault();
              event.stopPropagation();
              setMusicPlaying(!musicPlaying);
              return;
            }
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            seekMusicBy(event.key === "ArrowLeft" ? -5 : 5);
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            lastAngleRef.current = pointerAngle(event.currentTarget, event.clientX, event.clientY);
            lastMoveTimeRef.current = event.timeStamp;
            draggedRef.current = false;
            scratchingRef.current = true;
            wasPlayingRef.current = musicPlaying;
            beginScratch();
          }}
          onPointerMove={(event) => {
            if (!scratchingRef.current) return;
            const angle = pointerAngle(event.currentTarget, event.clientX, event.clientY);
            const delta = normalizedAngleDelta(angle, lastAngleRef.current);
            const elapsed = Math.max(1 / 240, (event.timeStamp - lastMoveTimeRef.current) / 1_000);
            lastAngleRef.current = angle;
            lastMoveTimeRef.current = event.timeStamp;
            if (Math.abs(delta) < 0.004) return;
            draggedRef.current = true;
            setHasScratched(true);
            rotationRef.current += (delta * 180) / Math.PI;
            event.currentTarget.style.setProperty(
              "--vinyl-scratch-angle",
              `${rotationRef.current}deg`,
            );
            pendingSeekRef.current += (delta / (Math.PI * 2)) * SECONDS_PER_REVOLUTION;
            pendingTimeRef.current += elapsed;
            frameRef.current ??= window.requestAnimationFrame(flushSeek);
          }}
          onPointerUp={finishScratch}
          onPointerCancel={finishScratch}
          onLostPointerCapture={finishScratch}
        >
          <span className="pitch-night-vinyl-label" aria-hidden="true">
            <span>apartment</span>
            <span>life</span>
          </span>
        </button>
      </div>
      <div
        className="pitch-night-vinyl-gesture"
        data-hidden={hasScratched || undefined}
        aria-hidden="true"
      >
        <svg viewBox="0 0 120 70">
          <path d="M14 48C35 14 83 10 105 38" />
          <path d="m96 34 10 5-2-11" />
        </svg>
        <span>drag the record</span>
      </div>
      <p id="pitch-night-vinyl-help" className="pitch-night-vinyl-help">
        <span aria-live="polite">
          {!enabled ? "sound off" : scratching ? "scratching" : musicPlaying ? "playing" : "paused"}
        </span>
        hold + drag — the song follows your hand · tap to {musicPlaying ? "pause" : "play"} · arrows
        jump 5s
      </p>
    </div>
  );
}
