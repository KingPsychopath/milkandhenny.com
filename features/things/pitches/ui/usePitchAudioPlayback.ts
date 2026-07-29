import { useCallback, useEffect, useMemo, useRef } from "react";

import type { PitchAsset, PitchAudioCue, PitchSlide } from "../types";

interface ActiveSound {
  audio: HTMLAudioElement;
  cue: PitchAudioCue;
  slideId: string;
  stopTimer?: number;
}

function cueUrl(cue: PitchAudioCue, assets: PitchAsset[]): string | undefined {
  return assets.find((asset) => asset.id === cue.assetId)?.url;
}

export function usePitchAudioPlayback({
  slide,
  assets,
  armed,
}: {
  slide?: PitchSlide;
  assets: PitchAsset[];
  armed: boolean;
}) {
  const active = useRef(new Set<ActiveSound>());
  const scheduled = useRef(new Set<number>());
  const previous = useRef<PitchSlide | undefined>(undefined);
  const armedRef = useRef(false);
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const cueSignature = useMemo(() => JSON.stringify(slide?.audioCues ?? []), [slide?.audioCues]);

  const stopSound = useCallback((sound: ActiveSound) => {
    if (sound.stopTimer) window.clearTimeout(sound.stopTimer);
    sound.audio.pause();
    sound.audio.removeAttribute("src");
    active.current.delete(sound);
  }, []);

  const stopAll = useCallback(() => {
    for (const timer of scheduled.current) window.clearTimeout(timer);
    scheduled.current.clear();
    for (const sound of active.current) stopSound(sound);
  }, [stopSound]);

  const schedule = useCallback(
    (owner: PitchSlide, cue: PitchAudioCue) => {
      const url = cueUrl(cue, assetsRef.current);
      if (!url) return;
      const timer = window.setTimeout(() => {
        scheduled.current.delete(timer);
        const audio = new Audio(url);
        const sound: ActiveSound = { audio, cue, slideId: owner.id };
        active.current.add(sound);
        audio.preload = "auto";
        audio.volume = cue.volume;
        audio.addEventListener("ended", () => active.current.delete(sound), { once: true });
        audio.addEventListener("error", () => stopSound(sound), { once: true });
        audio.addEventListener(
          "loadedmetadata",
          () => {
            audio.currentTime = Math.min(cue.startAtMs / 1_000, audio.duration);
            void audio
              .play()
              .then(() => {
                sound.stopTimer = window.setTimeout(() => stopSound(sound), cue.playForMs);
              })
              .catch(() => active.current.delete(sound));
          },
          { once: true },
        );
        audio.load();
      }, cue.delayMs);
      scheduled.current.add(timer);
    },
    [stopSound],
  );

  const startSlide = useCallback(
    (next: PitchSlide) => {
      for (const cue of next.audioCues) {
        if (cue.trigger === "enter") schedule(next, cue);
      }
    },
    [schedule],
  );

  useEffect(() => {
    if (!armed) {
      stopAll();
      previous.current = slide;
      armedRef.current = false;
      return;
    }
    const prior = previous.current;
    const newlyArmed = !armedRef.current;
    if (prior && prior.id !== slide?.id) {
      for (const sound of active.current) {
        if (sound.slideId === prior.id && sound.cue.end === "slide-exit") stopSound(sound);
      }
      for (const cue of prior.audioCues) {
        if (cue.trigger === "exit") schedule(prior, cue);
      }
    }
    if (slide && (newlyArmed || prior?.id !== slide.id)) startSlide(slide);
    previous.current = slide;
    armedRef.current = true;
  }, [armed, cueSignature, schedule, slide, startSlide, stopAll, stopSound]);

  useEffect(() => stopAll, [stopAll]);

  const replay = useCallback(() => {
    stopAll();
    if (slide) startSlide(slide);
  }, [slide, startSlide, stopAll]);

  return { replay, stopAll };
}
