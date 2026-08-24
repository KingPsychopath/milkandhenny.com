import { eventPath } from "@/features/events/routes";
import { isUpcoming, type EventRecord } from "@/features/events/types";

/** Used when there is no active event and no custom footer destination. */
export const DEFAULT_PARTY_PATH = "/party";

const MAX_INTERNAL_PATH_LENGTH = 200;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

export type FooterPartyPathResult =
  | { ok: true; path: string | null }
  | { ok: false; error: string };

/** Footer destinations stay on this site. Empty input means automatic mode. */
export function parseFooterPartyPath(value: unknown): FooterPartyPathResult {
  if (value === null || value === undefined || value === "") {
    return { ok: true, path: null };
  }
  if (typeof value !== "string") {
    return { ok: false, error: "The footer destination must be a local path" };
  }

  const path = value.trim();
  if (!path) return { ok: true, path: null };
  if (
    path.length > MAX_INTERNAL_PATH_LENGTH ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    hasControlCharacter(path)
  ) {
    return { ok: false, error: "The footer destination must be a local path beginning with /" };
  }
  return { ok: true, path };
}

function isActiveEvent(event: Pick<EventRecord, "status">): boolean {
  return event.status === "published" || event.status === "sold-out";
}

/** Picks the latest active event for automatic footer navigation. */
export function defaultFooterPartyPath(
  events: ReadonlyArray<Pick<EventRecord, "slug" | "status" | "startsAt" | "endsAt">>,
  now = Date.now(),
): string {
  const active = events
    .filter(isActiveEvent)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  const event = active.find((candidate) => isUpcoming(candidate, now)) ?? active[0];
  return event ? eventPath(event.slug) : DEFAULT_PARTY_PATH;
}
