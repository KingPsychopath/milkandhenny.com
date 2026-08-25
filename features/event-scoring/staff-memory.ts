export type RememberedStaffAccess = {
  eventSlug: string;
  eventTitle: string;
  token: string;
  label: string;
  rolePreset?: string;
  assignmentType: "personal" | "station";
  expiresAt?: string;
  savedAt: string;
};

const STORAGE_KEY = "mah-staff-access";
const MAX_REMEMBERED = 4;
const REMEMBER_DAYS = 14;
export const STAFF_PROMPT_WINDOW_HOURS = 48;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is RememberedStaffAccess {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.eventSlug === "string" &&
    typeof entry.eventTitle === "string" &&
    typeof entry.token === "string" &&
    typeof entry.label === "string" &&
    (entry.assignmentType === "personal" || entry.assignmentType === "station") &&
    typeof entry.savedAt === "string"
  );
}

export function readRememberedStaffAccess(now = Date.now()): RememberedStaffAccess[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const cutoff = now - REMEMBER_DAYS * 24 * 60 * 60 * 1_000;
    return parsed
      .filter(isEntry)
      .filter((entry) => {
        const saved = Date.parse(entry.savedAt);
        const expires = entry.expiresAt ? Date.parse(entry.expiresAt) : Number.POSITIVE_INFINITY;
        return Number.isFinite(saved) && saved >= cutoff && expires > now;
      })
      .slice(0, MAX_REMEMBERED);
  } catch {
    return [];
  }
}

export function rememberStaffAccess(entry: Omit<RememberedStaffAccess, "savedAt">): void {
  const store = storage();
  if (!store) return;
  try {
    const existing = readRememberedStaffAccess().filter(
      (item) => item.token !== entry.token || item.eventSlug !== entry.eventSlug,
    );
    store.setItem(
      STORAGE_KEY,
      JSON.stringify(
        [{ ...entry, savedAt: new Date().toISOString() }, ...existing].slice(0, MAX_REMEMBERED),
      ),
    );
  } catch {
    // Private browsing or quota failure only disables the resume convenience.
  }
}

export function forgetStaffAccess(eventSlug: string, token: string): void {
  const store = storage();
  if (!store) return;
  try {
    const remaining = readRememberedStaffAccess().filter(
      (item) => item.token !== token || item.eventSlug !== eventSlug,
    );
    if (remaining.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Nothing to clean when storage is unavailable.
  }
}

export function staffAccessToPromptFor(now = Date.now()): RememberedStaffAccess | null {
  const [latest] = readRememberedStaffAccess(now);
  if (!latest) return null;
  const saved = Date.parse(latest.savedAt);
  return Number.isFinite(saved) && now - saved <= STAFF_PROMPT_WINDOW_HOURS * 60 * 60 * 1_000
    ? latest
    : null;
}
