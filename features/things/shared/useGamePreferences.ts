import { useCallback, useEffect, useRef, useState } from "react";
import { gameBrowserKey } from "./multiplayer-keys";

/**
 * Remembered setup for a game, on this device.
 *
 * Nobody wants to re-pick eight rounds, twenty seconds, that deck and no sound every single time
 * they open a thing. Before this, one game persisted three of its settings through a bespoke module
 * and the other four persisted none, so "does it remember?" had a different answer per game.
 *
 * Rules that matter:
 *
 * - Validation is **per field against the default's type**, so one bad or renamed key does not
 *   throw the whole lot away. Adding a setting later reads as "use the default for that one".
 * - Writes are debounced, because most of these live behind a slider.
 * - Storage refusing to work is not an error. The game plays; it just forgets.
 */
type Primitive = string | number | boolean;
type Preferences = Record<string, Primitive>;

/**
 * Defaults are written as object literals, so `sound: true` infers as the literal `true` and every
 * later `set("sound", false)` fails to typecheck. Widening back to the primitive is what the caller
 * meant, and saves annotating a type beside every defaults object.
 */
type Widen<T> = {
  [K in keyof T]: T[K] extends boolean
    ? boolean
    : T[K] extends number
      ? number
      : T[K] extends string
        ? string
        : T[K];
};

export function gamePreferencesKey(game: string, version = 1) {
  return gameBrowserKey(game, version, "preferences");
}

function coerce<T extends Preferences>(stored: unknown, defaults: T): Widen<T> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults as Widen<T>;
  const source = stored as Record<string, unknown>;
  const result = { ...defaults } as Widen<T>;
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const value = source[key];
    // Same type as the default, or the default. A renamed or retyped setting is not a corruption.
    if (typeof value !== typeof defaults[key]) continue;
    // Strings get a ceiling. Nothing here is prose, and storage should not carry a novel.
    result[key] = (typeof value === "string" ? value.slice(0, 300) : value) as Widen<T>[keyof T &
      string];
  }
  return result;
}

export function useGamePreferences<T extends Preferences>(game: string, defaults: T) {
  const key = gamePreferencesKey(game);
  const [preferences, setPreferences] = useState<Widen<T>>(defaults as Widen<T>);
  /**
   * False until storage has been read. Callers that seed their own state from these need it: the
   * first render hands them defaults, and seeding from those would overwrite what was remembered.
   */
  const [loaded, setLoaded] = useState(false);
  const defaultsRef = useRef(defaults);
  const writeTimer = useRef<number | null>(null);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      setPreferences(coerce(stored, defaultsRef.current));
    } catch {
      // Unreadable or unavailable; the defaults already stand.
    }
    setLoaded(true);
  }, [key]);

  const persist = useCallback(
    (next: Widen<T>) => {
      if (writeTimer.current !== null) window.clearTimeout(writeTimer.current);
      writeTimer.current = window.setTimeout(() => {
        writeTimer.current = null;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Honoured for this session regardless.
        }
      }, 250);
    },
    [key],
  );

  const set = useCallback(
    <K extends keyof T>(field: K, value: Widen<T>[K]) => {
      setPreferences((current) => {
        if (current[field] === value) return current;
        const next = { ...current, [field]: value };
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    setPreferences(defaultsRef.current as Widen<T>);
    try {
      localStorage.removeItem(key);
    } catch {
      // As above.
    }
  }, [key]);

  const replace = useCallback(
    (value: unknown) => {
      const next = coerce(value, defaultsRef.current);
      setPreferences(next);
      persist(next);
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (writeTimer.current !== null) window.clearTimeout(writeTimer.current);
    },
    [],
  );

  return { preferences, loaded, set, replace, reset };
}
