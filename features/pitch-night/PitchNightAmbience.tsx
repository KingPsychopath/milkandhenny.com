import { useCallback, useEffect, useRef, useState } from "react";

const AMBIENCE_PREFERENCE = "pitch-night:ambience";
const APARTMENT_LIFE_TRACK = "/audio/apartment-life-fete-recap-4f1012ae.mp3";
const AMBIENCE_LEVEL = 0.07;
const AMBIENCE_UNDER_MUSIC_LEVEL = 0.024;
const MUSIC_LEVEL = 0.18;

interface AmbienceEngine {
  context: AudioContext;
  setApartmentLifeActive: (active: boolean) => void;
  stop: () => void;
}

function noiseBuffer(context: AudioContext): AudioBuffer {
  const duration = 2;
  const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let softened = 0;

  for (let index = 0; index < channel.length; index += 1) {
    softened = softened * 0.92 + (Math.random() * 2 - 1) * 0.08;
    channel[index] = softened;
  }

  return buffer;
}

function createAmbienceEngine(): AmbienceEngine {
  const context = new AudioContext({ latencyHint: "playback" });
  const master = context.createGain();
  const air = context.createGain();
  const rain = context.createGain();
  const airFilter = context.createBiquadFilter();
  const rainFilter = context.createBiquadFilter();
  const texture = context.createBufferSource();
  const lowTone = context.createOscillator();
  const highTone = context.createOscillator();
  const toneGain = context.createGain();
  const drift = context.createOscillator();
  const driftDepth = context.createGain();

  master.gain.setValueAtTime(0, context.currentTime);
  master.gain.linearRampToValueAtTime(AMBIENCE_LEVEL, context.currentTime + 1.8);
  master.connect(context.destination);

  texture.buffer = noiseBuffer(context);
  texture.loop = true;

  airFilter.type = "lowpass";
  airFilter.frequency.value = 760;
  airFilter.Q.value = 0.35;
  air.gain.value = 0.22;

  rainFilter.type = "bandpass";
  rainFilter.frequency.value = 3_200;
  rainFilter.Q.value = 0.45;
  rain.gain.value = 0.035;

  texture.connect(airFilter).connect(air).connect(master);
  texture.connect(rainFilter).connect(rain).connect(master);

  lowTone.type = "sine";
  lowTone.frequency.value = 73.42;
  highTone.type = "sine";
  highTone.frequency.value = 110;
  toneGain.gain.value = 0.018;
  lowTone.connect(toneGain);
  highTone.connect(toneGain);
  toneGain.connect(master);

  drift.type = "sine";
  drift.frequency.value = 0.055;
  driftDepth.gain.value = 0.045;
  drift.connect(driftDepth).connect(air.gain);

  texture.start();
  lowTone.start();
  highTone.start();
  drift.start();

  let stopped = false;
  let apartmentLifeActive = false;
  let musicBuffer: AudioBuffer | undefined;
  let loadingMusic: Promise<AudioBuffer> | undefined;
  let music:
    | {
        source: AudioBufferSourceNode;
        gain: GainNode;
      }
    | undefined;

  const ramp = (gain: AudioParam, value: number, seconds: number) => {
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(value, now + seconds);
  };

  const fadeOutMusic = () => {
    const current = music;
    if (!current) return;
    music = undefined;
    ramp(current.gain.gain, 0, 0.8);
    window.setTimeout(() => {
      try {
        current.source.stop();
      } catch {
        // The audio context may already have closed.
      }
    }, 850);
  };

  const loadMusic = () => {
    if (musicBuffer) return Promise.resolve(musicBuffer);
    loadingMusic ??= fetch(APARTMENT_LIFE_TRACK)
      .then((response) => {
        if (!response.ok) throw new Error("Apartment Life track could not be loaded");
        return response.arrayBuffer();
      })
      .then((buffer) => context.decodeAudioData(buffer))
      .then((buffer) => {
        musicBuffer = buffer;
        return buffer;
      });
    return loadingMusic;
  };

  const startMusic = async () => {
    try {
      const buffer = await loadMusic();
      if (stopped || !apartmentLifeActive || music) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(gain).connect(context.destination);
      source.start();
      music = { source, gain };
      ramp(gain.gain, MUSIC_LEVEL, 1.4);
    } catch {
      // The procedural ambience remains available if the track cannot load.
    }
  };

  return {
    context,
    setApartmentLifeActive: (active) => {
      apartmentLifeActive = active;
      ramp(master.gain, active ? AMBIENCE_UNDER_MUSIC_LEVEL : AMBIENCE_LEVEL, 1.2);
      if (active) {
        void startMusic();
      } else {
        fadeOutMusic();
      }
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      fadeOutMusic();
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.45);
      window.setTimeout(() => {
        texture.stop();
        lowTone.stop();
        highTone.stop();
        drift.stop();
        void context.close();
      }, 500);
    },
  };
}

export function PitchNightAmbience() {
  const engineRef = useRef<AmbienceEngine | null>(null);
  const apartmentLifeActiveRef = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [supported, setSupported] = useState(true);

  const start = useCallback(() => {
    if (engineRef.current) {
      void engineRef.current.context.resume();
      engineRef.current.setApartmentLifeActive(apartmentLifeActiveRef.current);
      return true;
    }
    try {
      const engine = createAmbienceEngine();
      engineRef.current = engine;
      engine.setApartmentLifeActive(apartmentLifeActiveRef.current);
      void engine.context.resume();
      return true;
    } catch {
      setSupported(false);
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
  }, []);

  useEffect(() => {
    const preference = window.localStorage.getItem(AMBIENCE_PREFERENCE);
    if (preference === "off") {
      setEnabled(false);
      return;
    }

    const resumeOnIntent = () => {
      start();
      window.removeEventListener("pointerdown", resumeOnIntent);
      window.removeEventListener("keydown", resumeOnIntent);
    };
    window.addEventListener("pointerdown", resumeOnIntent);
    window.addEventListener("keydown", resumeOnIntent);
    return () => {
      window.removeEventListener("pointerdown", resumeOnIntent);
      window.removeEventListener("keydown", resumeOnIntent);
    };
  }, [start]);

  useEffect(() => {
    const section = document.querySelector("[data-dj-scene]");
    if (!section) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const active = entry?.isIntersecting === true;
        apartmentLifeActiveRef.current = active;
        engineRef.current?.setApartmentLifeActive(active);
      },
      { threshold: 0.18 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      const context = engineRef.current?.context;
      if (!context) return;
      if (document.hidden) {
        void context.suspend();
      } else if (enabled) {
        void context.resume();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [enabled]);

  useEffect(() => stop, [stop]);

  function toggle() {
    if (enabled) {
      stop();
      setEnabled(false);
      window.localStorage.setItem(AMBIENCE_PREFERENCE, "off");
      return;
    }
    if (!start()) return;
    setEnabled(true);
    window.localStorage.setItem(AMBIENCE_PREFERENCE, "on");
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      className="pitch-night-sound"
      aria-label={`Turn ambient sound ${enabled ? "off" : "on"}`}
      aria-pressed={enabled}
      onClick={toggle}
    >
      <span
        className="pitch-night-sound-wave"
        data-active={enabled || undefined}
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
      </span>
      <span>sound {enabled ? "on" : "off"}</span>
    </button>
  );
}
