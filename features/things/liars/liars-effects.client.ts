import { hapticFeedback } from "@/lib/client/feedback";
import { playGameSound, primeGameAudio } from "../shared/game-sound.client";

/**
 * Sound and haptics for the dawn beats. The visual side lives in `globals.css` as keyframes so the
 * cascade owns it and `prefers-reduced-motion` can replace it wholesale.
 *
 * There is deliberately no sustained strobe. A full-screen red/white flicker in the 5–30Hz band is
 * squarely in the photosensitive seizure range, and this is a game handed round a room of people.
 * Death lands through contrast, scale and sound instead: one hard blowout, a snap to black, then a
 * slow red bleed with the long vibration carrying the menace.
 */

let context: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const Constructor =
    window.AudioContext ||
    (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  context ??= new Constructor();
  if (context.state === "suspended") void context.resume();
  return context;
}

function tone(input: {
  frequency: number;
  start: number;
  duration: number;
  volume?: number;
  type?: OscillatorType;
  sweepTo?: number;
}) {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime + input.start;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = input.type ?? "sine";
  oscillator.frequency.setValueAtTime(input.frequency, at);
  if (input.sweepTo !== undefined)
    oscillator.frequency.exponentialRampToValueAtTime(input.sweepTo, at + input.duration);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(input.volume ?? 0.09, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + input.duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(at);
  oscillator.stop(at + input.duration + 0.02);
}

/** Filtered noise, for the whisper at nightfall. */
function breath(duration: number, volume = 0.05) {
  const ctx = audio();
  if (!ctx) return;
  const frames = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    const envelope = Math.sin((Math.PI * index) / frames);
    channel[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.8;
  gain.gain.value = volume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();
}

export type LiarsSound =
  | "dusk"
  | "dawn"
  | "report"
  | "death"
  | "revive"
  | "toll"
  | "heartbeat"
  | "select"
  | "lock"
  | "win"
  | "lose";

export function primeLiarsAudio() {
  primeGameAudio();
  audio();
}

export function playLiarsSound(sound: LiarsSound, enabled: boolean) {
  if (!enabled) return;
  switch (sound) {
    case "dusk":
      breath(1.6, 0.045);
      tone({ frequency: 130, start: 0.2, duration: 1.4, volume: 0.05, sweepTo: 82 });
      break;
    /*
     * Dawn had no sound at all — the one transition in the game that happens to everybody at once
     * was landing in silence while dusk got a breath and a descending drone.
     *
     * Synthesised birdsong is a trap: it either sounds like a sample library or it sounds like a
     * modem, and either way it belongs to a different game than one set in Lora on warm stone. So
     * this is dusk's shape run backwards — the same drone rising instead of falling, with a chime
     * over the top of it. Restrained on purpose: the thing that comes next is somebody's name.
     */
    case "dawn":
      breath(1.8, 0.03);
      tone({ frequency: 82, start: 0, duration: 1.5, volume: 0.045, sweepTo: 147 });
      tone({ frequency: 523, start: 0.55, duration: 0.9, volume: 0.045 });
      tone({ frequency: 784, start: 0.85, duration: 1.1, volume: 0.035 });
      break;
    case "report":
      tone({ frequency: 880, start: 0, duration: 0.09, volume: 0.05 });
      tone({ frequency: 1_170, start: 0.07, duration: 0.12, volume: 0.04 });
      break;
    case "death":
      tone({ frequency: 210, start: 0, duration: 0.5, volume: 0.14, sweepTo: 48, type: "sawtooth" });
      tone({ frequency: 62, start: 0.1, duration: 1.8, volume: 0.1 });
      break;
    case "revive":
      tone({ frequency: 392, start: 0, duration: 0.5, volume: 0.08 });
      tone({ frequency: 523, start: 0.16, duration: 0.5, volume: 0.08 });
      tone({ frequency: 784, start: 0.34, duration: 0.7, volume: 0.07 });
      break;
    case "toll":
      tone({ frequency: 147, start: 0, duration: 2.2, volume: 0.11 });
      tone({ frequency: 220, start: 0.02, duration: 1.6, volume: 0.05 });
      break;
    case "heartbeat":
      tone({ frequency: 55, start: 0, duration: 0.16, volume: 0.12 });
      tone({ frequency: 48, start: 0.19, duration: 0.2, volume: 0.09 });
      break;
    case "select":
      playGameSound("tick", true);
      break;
    case "lock":
      tone({ frequency: 440, start: 0, duration: 0.08, volume: 0.06 });
      tone({ frequency: 330, start: 0.06, duration: 0.14, volume: 0.05 });
      break;
    case "win":
      tone({ frequency: 523, start: 0, duration: 0.22, volume: 0.09 });
      tone({ frequency: 659, start: 0.15, duration: 0.24, volume: 0.09 });
      tone({ frequency: 784, start: 0.32, duration: 0.5, volume: 0.09 });
      break;
    case "lose":
      tone({ frequency: 330, start: 0, duration: 0.3, volume: 0.08 });
      tone({ frequency: 262, start: 0.22, duration: 0.34, volume: 0.08 });
      tone({ frequency: 196, start: 0.48, duration: 0.7, volume: 0.08 });
      break;
  }
}

export function liarsHaptic(
  kind: "death" | "revive" | "report" | "select" | "lock" | "toll" | "turn",
) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  switch (kind) {
    case "death":
      navigator.vibrate([400, 120, 400, 120, 900]);
      break;
    case "revive":
      navigator.vibrate([20, 60, 20, 60, 30]);
      break;
    case "report":
      navigator.vibrate([15, 40, 15]);
      break;
    case "turn":
      // Long enough to feel through a pocket or a table.
      navigator.vibrate([220, 90, 220, 90, 320]);
      break;
    case "toll":
      hapticFeedback("reveal");
      break;
    case "lock":
      hapticFeedback("medium");
      break;
    default:
      hapticFeedback("light");
  }
}
