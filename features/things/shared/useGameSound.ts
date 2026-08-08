import { useCallback, useEffect, useState } from "react";

/**
 * Three states, not two. "Off" and "on" is the wrong shape for a game with a narrator: the person
 * who wants the bells and the heartbeat but not a voice reading over the top of the room has
 * nowhere to go, and their only option is silence.
 *
 * Device-wide rather than per room — whichever phone you mute stays muted for the next game.
 */
export type GameSoundMode = "all" | "ambient" | "off";

export const GAME_SOUND_LABEL: Record<GameSoundMode, string> = {
  all: "sound",
  ambient: "no voice",
  off: "muted",
};

export const GAME_SOUND_DESCRIPTION: Record<GameSoundMode, string> = {
  all: "effects and the narrator",
  ambient: "effects only — nobody reads aloud",
  off: "silent",
};

const ORDER: GameSoundMode[] = ["all", "ambient", "off"];

function parse(value: string | null): GameSoundMode {
  return value === "all" || value === "ambient" || value === "off" ? value : "all";
}

export function useGameSound(storageKey: string) {
  const [mode, setMode] = useState<GameSoundMode>("all");

  useEffect(() => {
    try {
      setMode(parse(localStorage.getItem(storageKey)));
    } catch {
      // A browser refusing storage just means this device always starts at "all".
    }
  }, [storageKey]);

  const set = useCallback(
    (next: GameSoundMode) => {
      setMode(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // Preference is still honoured for this session.
      }
    },
    [storageKey],
  );

  const cycle = useCallback(() => {
    setMode((current) => {
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // As above.
      }
      return next;
    });
  }, [storageKey]);

  return {
    mode,
    set,
    cycle,
    /** Bells, heartbeats, the death sting. */
    effects: mode !== "off",
    /** Anything spoken aloud. */
    voice: mode === "all",
    label: GAME_SOUND_LABEL[mode],
    description: GAME_SOUND_DESCRIPTION[mode],
  };
}
