export interface SpellingPreferences {
  positionLock: boolean;
  tiltEnabled: boolean;
  voiceURI: string;
}

export const DEFAULT_SPELLING_PREFERENCES: SpellingPreferences = {
  positionLock: false,
  tiltEnabled: true,
  voiceURI: "",
};

const STORAGE_KEY = "spelling-bee:preferences:v1";

export function readSpellingPreferences(): SpellingPreferences {
  if (typeof window === "undefined") return DEFAULT_SPELLING_PREFERENCES;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!stored || typeof stored !== "object") return DEFAULT_SPELLING_PREFERENCES;
    const value = stored as Partial<SpellingPreferences>;
    return {
      positionLock:
        typeof value.positionLock === "boolean"
          ? value.positionLock
          : DEFAULT_SPELLING_PREFERENCES.positionLock,
      tiltEnabled:
        typeof value.tiltEnabled === "boolean"
          ? value.tiltEnabled
          : DEFAULT_SPELLING_PREFERENCES.tiltEnabled,
      voiceURI: typeof value.voiceURI === "string" ? value.voiceURI.slice(0, 300) : "",
    };
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable entirely, not merely contain bad data.
    }
    return DEFAULT_SPELLING_PREFERENCES;
  }
}

export function writeSpellingPreferences(preferences: SpellingPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are an enhancement; private browsing or a full quota must
    // not stop the game from working.
  }
}
