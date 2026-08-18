import { describe, expect, it } from "vitest";

import {
  isMapProvider,
  mapSearchQuery,
  mapSearchUrl,
  nativeMapProvider,
} from "@/features/events/maps";

/**
 * An address that opens in the wrong app is worse than one that opens in none:
 * a guest at the door has to back out, copy the text and start again. These
 * cover the two decisions that can get that wrong — which app, and what string
 * gets handed to it.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("nativeMapProvider", () => {
  it("sends Apple devices to Apple Maps", () => {
    expect(nativeMapProvider(IPHONE)).toBe("apple");
    // iPadOS reports a Mac user-agent; both belong on Apple anyway.
    expect(nativeMapProvider(IPAD)).toBe("apple");
  });

  it("sends everything else to Google", () => {
    expect(nativeMapProvider(ANDROID)).toBe("google");
    expect(nativeMapProvider(WINDOWS)).toBe("google");
  });

  it("falls back to the provider whose URL works anywhere", () => {
    // No user-agent means server render, or a device we cannot identify. A web
    // map is a worse outcome than a native one, but not a broken one.
    expect(nativeMapProvider(undefined)).toBe("google");
    expect(nativeMapProvider("")).toBe("google");
  });
});

describe("mapSearchQuery", () => {
  it("prefers the address over the venue name", () => {
    expect(mapSearchQuery({ address: "12 Example Road, London E8", venueName: "The Flat" })).toBe(
      "12 Example Road, London E8",
    );
  });

  it("falls back to the venue name when there is no address", () => {
    expect(mapSearchQuery({ venueName: "Colours Hoxton" })).toBe("Colours Hoxton");
  });

  it("treats whitespace as absent so no empty search is offered", () => {
    expect(mapSearchQuery({ address: "   ", venueName: "  " })).toBeNull();
    expect(mapSearchQuery({})).toBeNull();
    expect(mapSearchQuery({ address: "  ", venueName: "The Flat" })).toBe("The Flat");
  });
});

describe("mapSearchUrl", () => {
  it("encodes the address rather than splicing it into a URL", () => {
    const query = "12 Example Road, London E8 & Co";
    expect(mapSearchUrl("apple", query)).toBe(
      "https://maps.apple.com/?q=12%20Example%20Road%2C%20London%20E8%20%26%20Co",
    );
    expect(mapSearchUrl("google", query)).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%20Example%20Road%2C%20London%20E8%20%26%20Co",
    );
  });

  it("produces a URL that parses, with the address intact", () => {
    for (const provider of ["apple", "google"] as const) {
      const url = new URL(mapSearchUrl(provider, "12 Example Road, London E8"));
      const value = url.searchParams.get("q") ?? url.searchParams.get("query");
      expect(value).toBe("12 Example Road, London E8");
    }
  });
});

describe("isMapProvider", () => {
  it("rejects anything that is not a known provider", () => {
    expect(isMapProvider("apple")).toBe(true);
    expect(isMapProvider("google")).toBe(true);
    expect(isMapProvider("Apple")).toBe(false);
    expect(isMapProvider("waze")).toBe(false);
    expect(isMapProvider(null)).toBe(false);
  });
});
