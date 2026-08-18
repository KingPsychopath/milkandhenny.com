/**
 * Opening an address in the right map app.
 *
 * Browser-safe and pure: platform sniffing takes the user-agent as an
 * argument so it can be tested, and nothing here touches storage.
 *
 * An address that is only text is a copy-paste job at the door, in the dark,
 * one-handed. It should be a link. But "a link to maps" is not one thing —
 * an Android user sent to Apple Maps gets a web page, and an iPhone user sent
 * to Google Maps gets a browser tab asking them to install an app. So the
 * platform picks the default and the guest can overrule it.
 */

export const MAP_PROVIDERS = ["apple", "google"] as const;

export type MapProvider = (typeof MAP_PROVIDERS)[number];

export function isMapProvider(value: unknown): value is MapProvider {
  return typeof value === "string" && (MAP_PROVIDERS as readonly string[]).includes(value);
}

export const MAP_PROVIDER_LABELS: Record<MapProvider, string> = {
  apple: "Apple Maps",
  google: "Google Maps",
};

/**
 * The map app this device would use on its own.
 *
 * Google is the fallback rather than a "neither" state because its URL works
 * everywhere — on a device we cannot identify, a web map is a worse outcome
 * than a plain address only in theory.
 */
export function nativeMapProvider(userAgent: string | undefined): MapProvider {
  if (!userAgent) return "google";
  // iPadOS reports a Mac user-agent, which lands on Apple either way.
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/.test(userAgent) ? "apple" : "google";
}

/**
 * The most geocodable string for a venue.
 *
 * The address, when there is one: a venue name like "The Flat" means nothing
 * to a geocoder and prefixing it can push a good address to a bad match.
 */
export function mapSearchQuery(input: { address?: string; venueName?: string }): string | null {
  const query = input.address?.trim() || input.venueName?.trim();
  return query ? query : null;
}

export function mapSearchUrl(provider: MapProvider, query: string): string {
  const encoded = encodeURIComponent(query);
  return provider === "apple"
    ? `https://maps.apple.com/?q=${encoded}`
    : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}
