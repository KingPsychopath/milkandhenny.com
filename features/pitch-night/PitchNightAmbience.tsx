import { usePitchNightAudio } from "./PitchNightAudio";

export function PitchNightAmbience() {
  const { activated, enabled, supported, toggleAmbience } = usePitchNightAudio();

  if (!supported) return null;

  return (
    <button
      type="button"
      className="pitch-night-sound"
      data-pitch-night-audio-toggle
      aria-label={
        enabled && !activated
          ? "Start ambient sound"
          : `Turn ambient sound ${enabled ? "off" : "on"}`
      }
      aria-pressed={enabled && activated}
      onClick={toggleAmbience}
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
      <span>{enabled && !activated ? "start sound" : `sound ${enabled ? "on" : "off"}`}</span>
    </button>
  );
}
