import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const AMBIENCE_PREFERENCE = "pitch-night:ambience";
const APARTMENT_LIFE_TRACK = "/audio/apartment-life-fete-recap-4f1012ae.mp3";
const AMBIENCE_LEVEL = 0.07;
const AMBIENCE_UNDER_MUSIC_LEVEL = 0.024;
const MUSIC_LEVEL = 0.18;

interface AmbienceEngine {
  context: AudioContext;
  beginScratch: () => void;
  endScratch: () => void;
  seekApartmentLifeBy: (seconds: number) => void;
  setApartmentLifeActive: (active: boolean) => void;
  setApartmentLifePaused: (paused: boolean) => void;
  stop: () => void;
}

interface PitchNightAudioValue {
  activated: boolean;
  beginScratch: () => void;
  enabled: boolean;
  endScratch: () => void;
  musicActive: boolean;
  musicPlaying: boolean;
  seekMusicBy: (seconds: number) => void;
  setMusicPlaying: (playing: boolean) => void;
  supported: boolean;
  toggleAmbience: () => void;
}

const PitchNightAudioContext = createContext<PitchNightAudioValue | null>(null);

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
  let apartmentLifePaused = false;
  let scratching = false;
  let pauseTimer: number | undefined;
  let music:
    | {
        element: HTMLAudioElement;
        gain: GainNode;
      }
    | undefined;

  const ramp = (gain: AudioParam, value: number, seconds: number) => {
    const now = context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(value, now + seconds);
  };

  const ensureMusic = () => {
    if (music) return music;
    const element = new Audio(APARTMENT_LIFE_TRACK);
    const gain = context.createGain();
    element.loop = true;
    element.preload = "auto";
    gain.gain.value = 0;
    context.createMediaElementSource(element).connect(gain).connect(context.destination);
    element.load();
    music = { element, gain };
    return music;
  };

  const playMusic = () => {
    if (stopped || !apartmentLifeActive || apartmentLifePaused || scratching) return;
    const current = ensureMusic();
    if (pauseTimer !== undefined) {
      window.clearTimeout(pauseTimer);
      pauseTimer = undefined;
    }
    void context.resume();
    void current.element.play().catch(() => {
      // A later direct interaction with the record can retry playback.
    });
    ramp(current.gain.gain, MUSIC_LEVEL, 0.7);
  };

  const pauseMusic = (seconds = 0.55) => {
    if (!music) return;
    const current = music;
    ramp(current.gain.gain, 0, seconds);
    if (pauseTimer !== undefined) window.clearTimeout(pauseTimer);
    pauseTimer = window.setTimeout(
      () => {
        if (!apartmentLifeActive || apartmentLifePaused || scratching || stopped) {
          current.element.pause();
        }
        pauseTimer = undefined;
      },
      seconds * 1_000 + 40,
    );
  };

  const syncMusic = () => {
    const audible = apartmentLifeActive && !apartmentLifePaused && !scratching;
    ramp(master.gain, audible ? AMBIENCE_UNDER_MUSIC_LEVEL : AMBIENCE_LEVEL, 0.8);
    if (audible) playMusic();
    else pauseMusic(scratching ? 0.08 : 0.55);
  };

  return {
    context,
    beginScratch: () => {
      scratching = true;
      music?.element.pause();
      if (music) ramp(music.gain.gain, 0, 0.06);
    },
    endScratch: () => {
      scratching = false;
      syncMusic();
    },
    seekApartmentLifeBy: (seconds) => {
      if (!Number.isFinite(seconds) || seconds === 0) return;
      const element = ensureMusic().element;
      const duration = element.duration;
      const next = element.currentTime + seconds;
      element.currentTime =
        Number.isFinite(duration) && duration > 0
          ? ((next % duration) + duration) % duration
          : Math.max(0, next);
    },
    setApartmentLifeActive: (active) => {
      apartmentLifeActive = active;
      syncMusic();
    },
    setApartmentLifePaused: (paused) => {
      apartmentLifePaused = paused;
      syncMusic();
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (pauseTimer !== undefined) window.clearTimeout(pauseTimer);
      music?.element.pause();
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

function storePreference(value: "on" | "off") {
  try {
    window.localStorage.setItem(AMBIENCE_PREFERENCE, value);
  } catch {
    // Sound remains usable when preferences are blocked.
  }
}

export function PitchNightAudioProvider({ children }: { children: ReactNode }) {
  const engineRef = useRef<AmbienceEngine | null>(null);
  const musicActiveRef = useRef(false);
  const musicPausedRef = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [activated, setActivated] = useState(false);
  const [musicActive, setMusicActive] = useState(false);
  const [musicPaused, setMusicPaused] = useState(false);
  const [supported, setSupported] = useState(true);

  const start = useCallback(() => {
    if (engineRef.current) {
      void engineRef.current.context.resume();
      engineRef.current.setApartmentLifePaused(musicPausedRef.current);
      engineRef.current.setApartmentLifeActive(musicActiveRef.current);
      setActivated(true);
      return true;
    }
    try {
      const engine = createAmbienceEngine();
      engineRef.current = engine;
      engine.setApartmentLifePaused(musicPausedRef.current);
      engine.setApartmentLifeActive(musicActiveRef.current);
      void engine.context.resume();
      setActivated(true);
      return true;
    } catch {
      setSupported(false);
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    setActivated(false);
  }, []);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(AMBIENCE_PREFERENCE) === "off") {
        setEnabled(false);
        return;
      }
    } catch {
      // Default to available when preferences are blocked.
    }

    const resumeOnIntent = (event: PointerEvent | KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-pitch-night-audio-toggle]")
      ) {
        return;
      }
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
        musicActiveRef.current = active;
        setMusicActive(active);
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
      if (document.hidden) void context.suspend();
      else if (enabled) void context.resume();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [enabled]);

  useEffect(
    () => () => {
      engineRef.current?.stop();
      engineRef.current = null;
    },
    [],
  );

  const enable = useCallback(() => {
    if (!start()) return false;
    setEnabled(true);
    storePreference("on");
    return true;
  }, [start]);

  const toggleAmbience = useCallback(() => {
    if (enabled && !activated) {
      enable();
      return;
    }
    if (enabled) {
      stop();
      setEnabled(false);
      storePreference("off");
      return;
    }
    enable();
  }, [activated, enable, enabled, stop]);

  const setMusicPlaying = useCallback(
    (playing: boolean) => {
      if (playing) {
        if (!enabled && !enable()) return;
        start();
      }
      const paused = !playing;
      musicPausedRef.current = paused;
      setMusicPaused(paused);
      engineRef.current?.setApartmentLifePaused(paused);
    },
    [enable, enabled, start],
  );

  const beginScratch = useCallback(() => {
    if (!enabled && !enable()) return;
    start();
    engineRef.current?.beginScratch();
  }, [enable, enabled, start]);

  const endScratch = useCallback(() => {
    engineRef.current?.endScratch();
  }, []);

  const seekMusicBy = useCallback((seconds: number) => {
    engineRef.current?.seekApartmentLifeBy(seconds);
  }, []);

  const value = useMemo<PitchNightAudioValue>(
    () => ({
      activated,
      beginScratch,
      enabled,
      endScratch,
      musicActive,
      musicPlaying: activated && enabled && musicActive && !musicPaused,
      seekMusicBy,
      setMusicPlaying,
      supported,
      toggleAmbience,
    }),
    [
      activated,
      beginScratch,
      enabled,
      endScratch,
      musicActive,
      musicPaused,
      seekMusicBy,
      setMusicPlaying,
      supported,
      toggleAmbience,
    ],
  );

  return (
    <PitchNightAudioContext.Provider value={value}>{children}</PitchNightAudioContext.Provider>
  );
}

export function usePitchNightAudio(): PitchNightAudioValue {
  const value = useContext(PitchNightAudioContext);
  if (!value) throw new Error("PitchNightAudioProvider is missing");
  return value;
}
