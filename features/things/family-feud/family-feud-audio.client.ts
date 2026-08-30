export type FamilyFeudSound = "buzz" | "open" | "correct" | "miss" | "timer" | "steal" | "victory";

let context: AudioContext | null = null;

function audioContext() {
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(
  target: AudioContext,
  frequency: number,
  startsAt: number,
  duration: number,
  volume = 0.075,
  type: OscillatorType = "sine",
) {
  const oscillator = target.createOscillator();
  const gain = target.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
  oscillator.connect(gain).connect(target.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.02);
}

export function unlockFamilyFeudAudio() {
  try {
    audioContext();
  } catch {
    // A muted or unsupported browser should never stop the host controls.
  }
}

export function playFamilyFeudSound(sound: FamilyFeudSound, muted = false) {
  if (muted) return;
  try {
    const target = audioContext();
    const now = target.currentTime + 0.01;
    if (sound === "buzz") {
      tone(target, 150, now, 0.18, 0.12, "square");
      tone(target, 110, now + 0.06, 0.2, 0.08, "square");
    } else if (sound === "correct") {
      tone(target, 523.25, now, 0.11, 0.075, "triangle");
      tone(target, 659.25, now + 0.07, 0.14, 0.075, "triangle");
      tone(target, 783.99, now + 0.14, 0.22, 0.08, "triangle");
    } else if (sound === "open") {
      tone(target, 261.63, now, 0.12, 0.055, "triangle");
      tone(target, 329.63, now + 0.09, 0.14, 0.06, "triangle");
      tone(target, 392, now + 0.18, 0.24, 0.07, "triangle");
    } else if (sound === "miss") {
      tone(target, 180, now, 0.18, 0.1, "sawtooth");
      tone(target, 120, now + 0.15, 0.25, 0.08, "sawtooth");
    } else if (sound === "timer") {
      tone(target, 760, now, 0.07, 0.05, "square");
    } else if (sound === "steal") {
      tone(target, 293.66, now, 0.13, 0.055, "triangle");
      tone(target, 369.99, now + 0.12, 0.13, 0.06, "triangle");
      tone(target, 523.25, now + 0.24, 0.24, 0.075, "triangle");
    } else {
      [392, 494, 587, 784].forEach((frequency, index) =>
        tone(target, frequency, now + index * 0.11, 0.28, 0.07, "triangle"),
      );
    }
  } catch {
    // Sound is enhancement only.
  }
}
