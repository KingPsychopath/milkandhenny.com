import { useCallback, useEffect, useState } from "react";

/**
 * Three states, not two. "Off" and "on" is the wrong shape for a game with a narrator: the person
 * who wants the bells and the heartbeat but not a voice reading over the top of the room has
 * nowhere to go, and their only option is silence.
 *
 * Device-wide rather than per room — whichever phone you mute stays muted for the next game.
 */
export type GameSoundMode = "all" | "ambient" | "off";

/**
 * Labels say what is **on**, not what was turned off.
 *
 * `sound → no voice → muted` reads as three unrelated words, and the middle one only makes sense
 * once you have already been through it. Worse, nothing on the button says a third state exists, so
 * a table with a narrator they dislike mutes everything rather than discovering the setting that
 * keeps the effects. `voice · fx → fx only → silent` shows the ladder from any rung.
 *
 * A game with no narrator gets the plain pair — calling its two states `voice · fx` and `silent`
 * would promise a narrator it does not have.
 */
export const GAME_SOUND_LABEL: Record<GameSoundMode, string> = {
  all: "voice · fx",
  ambient: "fx only",
  off: "silent",
};

const GAME_SOUND_LABEL_NO_NARRATOR: Record<GameSoundMode, string> = {
  all: "sound",
  ambient: "fx only",
  off: "silent",
};

export const GAME_SOUND_DESCRIPTION: Record<GameSoundMode, string> = {
  all: "effects and the narrator",
  ambient: "effects only — nobody reads aloud",
  off: "silent",
};

const ALL_MODES: GameSoundMode[] = ["all", "ambient", "off"];

function parse(value: string | null, allowed: GameSoundMode[]): GameSoundMode {
  return allowed.includes(value as GameSoundMode) ? (value as GameSoundMode) : allowed[0];
}

export function useGameSound(
  storageKey: string,
  /** Which states this game offers. Default is all three. */
  modes: GameSoundMode[] = ALL_MODES,
) {
  const [mode, setMode] = useState<GameSoundMode>(modes[0]);

  useEffect(() => {
    try {
      setMode(parse(localStorage.getItem(storageKey), modes));
    } catch {
      // A browser refusing storage just means this device always starts at "all".
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modes is a literal per call site
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
      const order = modes.length > 0 ? modes : ALL_MODES;
      const next = order[(order.indexOf(current) + 1) % order.length];
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // As above.
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- modes is a literal per call site
  }, [storageKey]);

  return {
    mode,
    set,
    cycle,
    /** Bells, heartbeats, the death sting. */
    effects: mode !== "off",
    /** Anything spoken aloud. */
    voice: mode === "all",
    label: (modes.includes("ambient") ? GAME_SOUND_LABEL : GAME_SOUND_LABEL_NO_NARRATOR)[mode],
    description: GAME_SOUND_DESCRIPTION[mode],
  };
}
