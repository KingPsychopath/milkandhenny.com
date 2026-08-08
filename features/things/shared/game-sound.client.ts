let context: AudioContext | null = null;

/**
 * One context for the whole site.
 *
 * Browsers cap how many an origin may open, and a second one would also mean a second thing to resume
 * after a gesture — so games build their own sounds on these primitives rather than their own engine.
 */
export function gameAudioContext() {
  return audioContext();
}

function audioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  context ??= new AudioContextConstructor();
  if (context.state === "suspended") void context.resume();
  return context;
}

export function gameNote(
  frequency: number,
  start: number,
  duration: number,
  volume = 0.09,
  type: OscillatorType = "sine",
) {
  note(frequency, start, duration, volume, type);
}

function note(
  frequency: number,
  start: number,
  duration: number,
  volume = 0.09,
  type: OscillatorType = "sine",
) {
  const audio = audioContext();
  if (!audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime + start);
  gain.gain.setValueAtTime(0.001, audio.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(volume, audio.currentTime + start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + start + duration);
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(audio.currentTime + start);
  oscillator.stop(audio.currentTime + start + duration + 0.02);
}

export function primeGameAudio() {
  audioContext();
}

export function playGameSound(sound: "correct" | "pass" | "tick" | "end", enabled: boolean) {
  if (!enabled) return;
  if (sound === "correct") {
    note(523, 0, 0.1);
    note(784, 0.08, 0.16);
  } else if (sound === "pass") {
    note(280, 0, 0.11, 0.06);
    note(220, 0.07, 0.14, 0.05);
  } else if (sound === "tick") {
    note(660, 0, 0.05, 0.04);
  } else {
    note(392, 0, 0.16);
    note(330, 0.15, 0.18);
    note(262, 0.3, 0.32);
  }
}
