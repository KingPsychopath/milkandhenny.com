import { gameNote, primeGameAudio } from "../shared/game-sound.client";

/**
 * Twin's voice. Synthesised, not sampled — a handful of oscillators weighs nothing, needs no network,
 * and works in the offline board where an audio file would not.
 *
 * The set is deliberately small. Everything here fires while somebody is staring at two cards under
 * time pressure, so each sound has to be over before it becomes something to listen to rather than
 * something to feel: the longest is 260ms, and the heartbeat is felt more than heard.
 */

export type TwinSoundName = "connection" | "miss" | "heat" | "settle" | "win" | "heartbeat";

export function primeTwinAudio() {
  primeGameAudio();
}

export function playTwinSound(sound: TwinSoundName, enabled: boolean) {
  if (!enabled) return;
  switch (sound) {
    /** You found it. Rising, bright, and done in a quarter of a second. */
    case "connection":
      gameNote(587, 0, 0.07, 0.08);
      gameNote(880, 0.05, 0.09, 0.08);
      gameNote(1175, 0.11, 0.13, 0.06);
      return;
    /**
     * Wrong one. A short saw-edged thud rather than a buzzer — it has to read as a cost without
     * being the loudest thing in the game, because the people making mistakes are already behind.
     */
    case "miss":
      gameNote(150, 0, 0.1, 0.05, "sawtooth");
      gameNote(96, 0.04, 0.12, 0.04, "sawtooth");
      return;
    /** A new pair is live. Barely there — it marks the moment rather than announcing it. */
    case "heat":
      gameNote(1046, 0, 0.04, 0.035);
      return;
    /** The heat closed. Two notes falling, so the ear knows the hunt is over before the eye does. */
    case "settle":
      gameNote(523, 0, 0.09, 0.05);
      gameNote(392, 0.08, 0.14, 0.045);
      return;
    /** Somebody is out of cards. */
    case "win":
      gameNote(523, 0, 0.11, 0.07);
      gameNote(659, 0.1, 0.11, 0.07);
      gameNote(784, 0.2, 0.13, 0.07);
      gameNote(1046, 0.31, 0.26, 0.06);
      return;
    /**
     * Lub-dub, low and quiet. Two notes a beat apart at the bottom of hearing, so on a phone speaker it
     * arrives as pressure rather than melody — and it never competes with the connection.
     */
    case "heartbeat":
      gameNote(72, 0, 0.07, 0.055);
      gameNote(56, 0.1, 0.1, 0.045);
      return;
  }
}

/**
 * How long until the next heartbeat, given what is left on the clock.
 *
 * Silent until the last few seconds, then the gap closes from a resting beat to a racing one. Pure, so
 * the ramp can be reasoned about — and tested — without an audio device.
 */
export const TWIN_HEARTBEAT = {
  /** Nothing at all above this. A heartbeat running the whole heat is just noise. */
  startsAtMs: 3_600,
  slowestGapMs: 620,
  fastestGapMs: 230,
} as const;

export function twinHeartbeatGapMs(remainingMs: number) {
  if (remainingMs > TWIN_HEARTBEAT.startsAtMs || remainingMs <= 0) return null;
  const urgency = 1 - remainingMs / TWIN_HEARTBEAT.startsAtMs;
  return Math.round(
    TWIN_HEARTBEAT.slowestGapMs -
      (TWIN_HEARTBEAT.slowestGapMs - TWIN_HEARTBEAT.fastestGapMs) * urgency,
  );
}
