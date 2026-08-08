/**
 * On-device memory of scanner access.
 *
 * A helper who closes the tab, follows a link elsewhere on the site, or
 * loses their place should be one tap from scanning again — without asking
 * the organiser to re-send anything. The link token is already a bearer
 * credential sitting in their browser history; remembering it in
 * localStorage adds convenience, not exposure.
 *
 * Browser-only. Every function no-ops without localStorage so imports stay
 * safe anywhere.
 */

export type RememberedScanner = {
  token: string;
  /** Who this link was made for — shown when offering to resume. */
  label: string;
  /** "door" or the checkpoint name, for display. */
  station: string;
  eventTitle: string;
  savedAt: string;
};

const STORAGE_KEY = "mah-scanner-access";
const MAX_REMEMBERED = 4;
/** Entries older than this are pruned — a past event's link is noise. */
const REMEMBER_DAYS = 14;
/** The return prompt only nags while a shift could plausibly still be on. */
export const PROMPT_WINDOW_HOURS = 48;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is RememberedScanner {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === "string" &&
    typeof record.label === "string" &&
    typeof record.station === "string" &&
    typeof record.eventTitle === "string" &&
    typeof record.savedAt === "string"
  );
}

/** Newest first, pruned of anything stale or malformed. */
export function readRememberedScanners(now = Date.now()): RememberedScanner[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const cutoff = now - REMEMBER_DAYS * 24 * 60 * 60 * 1000;
    return parsed
      .filter(isEntry)
      .filter((entry) => {
        const saved = Date.parse(entry.savedAt);
        return Number.isFinite(saved) && saved >= cutoff;
      })
      .slice(0, MAX_REMEMBERED);
  } catch {
    return [];
  }
}

export function rememberScanner(entry: Omit<RememberedScanner, "savedAt">): void {
  const store = storage();
  if (!store) return;
  try {
    const existing = readRememberedScanners().filter((item) => item.token !== entry.token);
    const next = [{ ...entry, savedAt: new Date().toISOString() }, ...existing].slice(
      0,
      MAX_REMEMBERED,
    );
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or a full quota — resuming just won't be offered.
  }
}

/** Drop one dead link (revoked/expired), or everything when token is omitted. */
export function forgetScanner(token?: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (!token) {
      store.removeItem(STORAGE_KEY);
      return;
    }
    const remaining = readRememberedScanners().filter((item) => item.token !== token);
    if (remaining.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Nothing to clean if storage is unavailable.
  }
}

/** The freshest remembered scanner, if it is recent enough to prompt about. */
export function scannerToPromptFor(now = Date.now()): RememberedScanner | null {
  const [latest] = readRememberedScanners(now);
  if (!latest) return null;
  const saved = Date.parse(latest.savedAt);
  if (!Number.isFinite(saved)) return null;
  return now - saved <= PROMPT_WINDOW_HOURS * 60 * 60 * 1000 ? latest : null;
}
