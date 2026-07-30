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
  playPourAccent: () => void;
  scratchApartmentLifeBy: (seconds: number, velocity: number) => void;
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
  scratching: boolean;
  scratchMusicBy: (seconds: number, velocity: number) => void;
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
  const scratchNoise = context.createBufferSource();
  const scratchFilter = context.createBiquadFilter();
  const scratchNoiseGain = context.createGain();
  const scratchBus = context.createGain();
  const scratchCompressor = context.createDynamicsCompressor();

  master.gain.setValueAtTime(0, context.currentTime);
  master.gain.linearRampToValueAtTime(AMBIENCE_LEVEL, context.currentTime + 1.8);
  master.connect(context.destination);

  const sharedNoise = noiseBuffer(context);
  texture.buffer = sharedNoise;
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

  scratchNoise.buffer = sharedNoise;
  scratchNoise.loop = true;
  scratchFilter.type = "bandpass";
  scratchFilter.frequency.value = 1_450;
  scratchFilter.Q.value = 0.7;
  scratchNoiseGain.gain.value = 0;
  scratchBus.gain.value = 0.86;
  scratchCompressor.threshold.value = -14;
  scratchCompressor.knee.value = 10;
  scratchCompressor.ratio.value = 6;
  scratchCompressor.attack.value = 0.004;
  scratchCompressor.release.value = 0.12;
  scratchNoise.connect(scratchFilter).connect(scratchNoiseGain).connect(scratchBus);
  scratchBus.connect(scratchCompressor).connect(context.destination);

  texture.start();
  lowTone.start();
  highTone.start();
  drift.start();
  scratchNoise.start();

  let stopped = false;
  let apartmentLifeActive = false;
  let apartmentLifePaused = false;
  let scratching = false;
  let pourPlayed = false;
  let pauseTimer: number | undefined;
  let lastScratchGrainAt = 0;
  let scratchAudio:
    | {
        forward: AudioBuffer;
        reverse: AudioBuffer;
      }
    | undefined;
  let scratchAudioPromise: Promise<typeof scratchAudio> | undefined;
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

  const wrapTime = (seconds: number, duration: number) =>
    ((seconds % duration) + duration) % duration;

  const ensureScratchAudio = () => {
    if (scratchAudio) return Promise.resolve(scratchAudio);
    scratchAudioPromise ??= fetch(APARTMENT_LIFE_TRACK)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the Apartment Life soundtrack");
        return response.arrayBuffer();
      })
      .then((encoded) => (stopped ? undefined : context.decodeAudioData(encoded)))
      .then((forward) => {
        if (!forward || stopped) return undefined;
        const reverse = context.createBuffer(
          forward.numberOfChannels,
          forward.length,
          forward.sampleRate,
        );
        for (let channelIndex = 0; channelIndex < forward.numberOfChannels; channelIndex += 1) {
          const source = forward.getChannelData(channelIndex);
          const destination = reverse.getChannelData(channelIndex);
          for (let index = 0; index < source.length; index += 1) {
            destination[index] = source[source.length - index - 1] ?? 0;
          }
        }
        scratchAudio = { forward, reverse };
        return scratchAudio;
      })
      .catch(() => {
        scratchAudioPromise = undefined;
        return undefined;
      });
    return scratchAudioPromise;
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

  const playMusic = (fadeSeconds = 0.7) => {
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
    ramp(current.gain.gain, MUSIC_LEVEL, fadeSeconds);
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

  const syncMusic = (resumeSeconds = 0.7) => {
    const audible = apartmentLifeActive && !apartmentLifePaused && !scratching;
    ramp(master.gain, audible ? AMBIENCE_UNDER_MUSIC_LEVEL : AMBIENCE_LEVEL, 0.8);
    if (audible) playMusic(resumeSeconds);
    else pauseMusic(scratching ? 0.08 : 0.55);
  };

  const playScratchGrain = (position: number, velocity: number) => {
    if (!scratchAudio || context.state !== "running") return;
    const now = context.currentTime;
    if (now - lastScratchGrainAt < 0.042) return;
    lastScratchGrainAt = now;

    const reverse = velocity < 0;
    const speed = Math.min(4, Math.max(0.42, Math.abs(velocity)));
    const duration = scratchAudio.forward.duration;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const audibleFor = Math.min(0.16, 0.085 + speed * 0.018);

    source.buffer = reverse ? scratchAudio.reverse : scratchAudio.forward;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = duration;
    source.playbackRate.setValueAtTime(speed, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(reverse ? 2_100 : 3_400, now);
    filter.Q.value = 0.48;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.1, now + 0.012);
    gain.gain.setValueAtTime(0.1, now + Math.max(0.014, audibleFor - 0.025));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + audibleFor);
    source.connect(filter).connect(gain).connect(scratchBus);
    source.start(now, wrapTime(reverse ? duration - position : position, duration));
    source.stop(now + audibleFor + 0.01);
  };

  return {
    context,
    beginScratch: () => {
      scratching = true;
      void ensureScratchAudio();
      music?.element.pause();
      if (music) ramp(music.gain.gain, 0, 0.06);
      ramp(scratchNoiseGain.gain, 0.008, 0.025);
    },
    endScratch: () => {
      scratching = false;
      ramp(scratchNoiseGain.gain, 0, 0.055);
      syncMusic(0.16);
    },
    playPourAccent: () => {
      if (stopped || pourPlayed || context.state !== "running") return;
      pourPlayed = true;

      const duration = 2.15;
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let softened = 0;

      for (let index = 0; index < channel.length; index += 1) {
        const progress = index / channel.length;
        const attack = Math.min(1, progress / 0.08);
        const release = Math.max(0, 1 - progress) ** 0.72;
        softened = softened * 0.84 + (Math.random() * 2 - 1) * 0.16;
        channel[index] = softened * attack * release;
      }

      source.buffer = buffer;
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(980, context.currentTime);
      filter.frequency.exponentialRampToValueAtTime(520, context.currentTime + duration);
      filter.Q.value = 0.7;
      gain.gain.setValueAtTime(0.14, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
      source.connect(filter).connect(gain).connect(master);
      source.start();
      source.stop(context.currentTime + duration);

      [0.42, 0.92, 1.46].forEach((offset, index) => {
        const bubble = context.createOscillator();
        const bubbleGain = context.createGain();
        const begins = context.currentTime + offset;
        bubble.type = "sine";
        bubble.frequency.setValueAtTime(360 + index * 70, begins);
        bubble.frequency.exponentialRampToValueAtTime(610 + index * 90, begins + 0.13);
        bubbleGain.gain.setValueAtTime(0.0001, begins);
        bubbleGain.gain.exponentialRampToValueAtTime(0.045, begins + 0.025);
        bubbleGain.gain.exponentialRampToValueAtTime(0.0001, begins + 0.16);
        bubble.connect(bubbleGain).connect(master);
        bubble.start(begins);
        bubble.stop(begins + 0.18);
      });
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
    scratchApartmentLifeBy: (seconds, velocity) => {
      if (!scratching || !Number.isFinite(seconds) || seconds === 0) return;
      const element = ensureMusic().element;
      const duration = element.duration;
      const next = element.currentTime + seconds;
      element.currentTime =
        Number.isFinite(duration) && duration > 0 ? wrapTime(next, duration) : Math.max(0, next);

      const speed = Math.min(6, Math.abs(velocity));
      ramp(scratchNoiseGain.gain, 0.008 + speed * 0.004, 0.018);
      const now = context.currentTime;
      scratchFilter.frequency.cancelScheduledValues(now);
      scratchFilter.frequency.setTargetAtTime(900 + speed * 330, now, 0.018);
      playScratchGrain(element.currentTime, velocity);
    },
    setApartmentLifeActive: (active) => {
      apartmentLifeActive = active;
      if (active) void ensureScratchAudio();
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
      scratchNoiseGain.gain.cancelScheduledValues(now);
      scratchNoiseGain.gain.setValueAtTime(scratchNoiseGain.gain.value, now);
      scratchNoiseGain.gain.linearRampToValueAtTime(0, now + 0.04);
      window.setTimeout(() => {
        texture.stop();
        lowTone.stop();
        highTone.stop();
        drift.stop();
        scratchNoise.stop();
        scratchAudio = undefined;
        scratchAudioPromise = undefined;
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
  const scratchingRef = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [activated, setActivated] = useState(false);
  const [musicActive, setMusicActive] = useState(false);
  const [musicPaused, setMusicPaused] = useState(false);
  const [scratching, setScratching] = useState(false);
  const [supported, setSupported] = useState(true);

  const start = useCallback(async () => {
    let engine = engineRef.current;
    if (!engine) {
      try {
        engine = createAmbienceEngine();
        engineRef.current = engine;
      } catch {
        setActivated(false);
        setSupported(false);
        return false;
      }
    }
    try {
      await engine.context.resume();
      const running = engine.context.state === "running";
      if (running) {
        // Media playback must be requested after the context resumes. Doing this
        // in the opposite order leaves the record visually paused after the
        // browser grants audio on a user gesture.
        engine.setApartmentLifePaused(musicPausedRef.current);
        engine.setApartmentLifeActive(musicActiveRef.current);
      }
      setActivated(running);
      return running;
    } catch {
      setActivated(false);
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    scratchingRef.current = false;
    setScratching(false);
    engineRef.current?.stop();
    engineRef.current = null;
    setActivated(false);
  }, []);

  useEffect(() => {
    const removeResumeListeners = () => {
      window.removeEventListener("pointerdown", resumeOnIntent);
      window.removeEventListener("keydown", resumeOnIntent);
    };
    const resumeOnIntent = (event: PointerEvent | KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-pitch-night-audio-toggle]")
      ) {
        return;
      }
      void start().then((running) => {
        if (running) removeResumeListeners();
      });
    };

    try {
      if (window.localStorage.getItem(AMBIENCE_PREFERENCE) === "off") {
        setEnabled(false);
        return;
      }
    } catch {
      // Default to available when preferences are blocked.
    }

    window.addEventListener("pointerdown", resumeOnIntent);
    window.addEventListener("keydown", resumeOnIntent);
    void start().then((running) => {
      if (running) removeResumeListeners();
    });
    return () => {
      removeResumeListeners();
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
      { rootMargin: "-6% 0px -6% 0px", threshold: 0.04 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const section = document.querySelector("[data-supper-scene]");
    const engine = engineRef.current;
    if (!section || !engine || !enabled || !activated) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        engine.playPourAccent();
        observer.disconnect();
      },
      { threshold: 0.42 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [activated, enabled]);

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

  const enable = useCallback(async () => {
    if (!(await start())) return false;
    setEnabled(true);
    storePreference("on");
    return true;
  }, [start]);

  const toggleAmbience = useCallback(() => {
    if (enabled && !activated) {
      void enable();
      return;
    }
    if (enabled) {
      stop();
      setEnabled(false);
      storePreference("off");
      return;
    }
    void enable();
  }, [activated, enable, enabled, stop]);

  const setMusicPlaying = useCallback(
    (playing: boolean) => {
      void (async () => {
        if (playing) {
          const running = enabled ? await start() : await enable();
          if (!running) return;
        }
        const paused = !playing;
        musicPausedRef.current = paused;
        setMusicPaused(paused);
        engineRef.current?.setApartmentLifePaused(paused);
      })();
    },
    [enable, enabled, start],
  );

  const beginScratch = useCallback(() => {
    scratchingRef.current = true;
    setScratching(true);
    void (async () => {
      const running = enabled ? await start() : await enable();
      if (!running || !scratchingRef.current) {
        setScratching(false);
        return;
      }
      engineRef.current?.beginScratch();
    })();
  }, [enable, enabled, start]);

  const endScratch = useCallback(() => {
    scratchingRef.current = false;
    setScratching(false);
    engineRef.current?.endScratch();
  }, []);

  const scratchMusicBy = useCallback((seconds: number, velocity: number) => {
    engineRef.current?.scratchApartmentLifeBy(seconds, velocity);
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
      scratching,
      scratchMusicBy,
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
      scratching,
      scratchMusicBy,
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
