import { describe, expect, it } from "vitest";

import {
  containsResourceUrls,
  isCurrentOfflineCacheMetadata,
  isOfflineCacheMetadata,
  offlineCacheKey,
  type OfflineCacheMetadata,
} from "../../features/offline/cache-metadata";
import { THING_OFFLINE } from "../../features/things/offline";

const metadata: OfflineCacheMetadata = {
  offlineVersion: 1,
  resourceUrls: ["/things/twin", "/assets/twin.js"],
  storageVersion: 1,
  preparedAt: 100,
};

describe("offline cache metadata", () => {
  it("keeps an unchanged game valid after an unrelated site build", () => {
    expect(isCurrentOfflineCacheMetadata(metadata, THING_OFFLINE.twin)).toBe(true);
  });

  it("invalidates a bundle or storage contract change", () => {
    expect(
      isCurrentOfflineCacheMetadata({ ...metadata, offlineVersion: 2 }, THING_OFFLINE.twin),
    ).toBe(false);
    expect(
      isCurrentOfflineCacheMetadata({ ...metadata, storageVersion: 2 }, THING_OFFLINE.twin),
    ).toBe(false);
  });

  it("detects a newly required resource before reusing the cache", () => {
    expect(containsResourceUrls(metadata.resourceUrls, ["/things/twin"])).toBe(true);
    expect(containsResourceUrls(metadata.resourceUrls, ["/assets/new-twin.js"])).toBe(false);
  });

  it("accepts only well-shaped metadata", () => {
    expect(isOfflineCacheMetadata(metadata)).toBe(true);
    expect(isOfflineCacheMetadata({ ...metadata, preparedAt: "now" })).toBe(false);
    expect(isOfflineCacheMetadata({ ...metadata, resourceUrls: ["/things/twin", 1] })).toBe(false);
  });

  it("separates each game and offline release in cache storage", () => {
    expect(offlineCacheKey("twin", 1)).not.toBe(offlineCacheKey("heads-up", 1));
    expect(offlineCacheKey("twin", 1)).not.toBe(offlineCacheKey("twin", 2));
  });
});
