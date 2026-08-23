import { useCallback, useEffect, useRef, useState } from "react";

export function usePitchMediaClock({
  slideId,
  durationMs,
  autoPlay = false,
}: {
  slideId?: string;
  durationMs: number;
  autoPlay?: boolean;
}) {
  const [playheadMs, setPlayheadState] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const playheadRef = useRef(0);
  const startedAtRef = useRef(0);

  const setPlayheadMs = useCallback(
    (value: number) => {
      const bounded = Math.max(0, Math.min(durationMs, value));
      playheadRef.current = bounded;
      startedAtRef.current = performance.now() - bounded;
      setPlayheadState(bounded);
      if (bounded >= durationMs) setPlaying(false);
    },
    [durationMs],
  );

  const play = useCallback(() => {
    if (playheadRef.current >= durationMs) {
      playheadRef.current = 0;
      setPlayheadState(0);
    }
    startedAtRef.current = performance.now() - playheadRef.current;
    setPlaying(true);
  }, [durationMs]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [pause, play, playing]);
  const replay = useCallback(() => {
    playheadRef.current = 0;
    setPlayheadState(0);
    startedAtRef.current = performance.now();
    setPlaying(true);
  }, []);

  useEffect(() => {
    playheadRef.current = 0;
    setPlayheadState(0);
    startedAtRef.current = performance.now();
    setPlaying(autoPlay);
  }, [autoPlay, slideId]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      const next = Math.min(durationMs, Math.max(0, now - startedAtRef.current));
      playheadRef.current = next;
      if (now - lastPaint >= 33 || next >= durationMs) {
        lastPaint = now;
        setPlayheadState(next);
      }
      if (next >= durationMs) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [durationMs, playing]);

  useEffect(() => {
    if (playheadRef.current <= durationMs) return;
    setPlayheadMs(durationMs);
  }, [durationMs, setPlayheadMs]);

  return { playheadMs, playing, setPlayheadMs, play, pause, toggle, replay };
}
