import { describe, expect, it } from "vitest";
import {
  applyTransferTimeFinderFilter,
  buildTransferTimeFinderModel,
  isTransferTimeFinderEligible,
  parseWallClockTime,
  resolveTransferTimeFinderBucket,
  type TransferTimeFinderInput,
} from "@/features/transfers/time-finder";

type Entry = TransferTimeFinderInput<{ label: string }>;

function makeEntry(
  id: string,
  kind: Entry["kind"],
  takenAt?: unknown
): Entry {
  return {
    id,
    kind,
    takenAt,
    item: { label: id },
  };
}

describe("transfer time finder", () => {
  describe("parseWallClockTime", () => {
    it("should parse stored ISO strings while ignoring trailing Z", () => {
      expect(parseWallClockTime("2024-06-01T14:30:22.000Z")).toEqual({
        year: 2024,
        month: 6,
        day: 1,
        hour: 14,
        minute: 30,
        second: 22,
      });
    });

    it("should parse strings with offset-like suffixes without using the offset", () => {
      expect(parseWallClockTime("2024-06-01T14:30:22+02:00")).toEqual({
        year: 2024,
        month: 6,
        day: 1,
        hour: 14,
        minute: 30,
        second: 22,
      });
    });

    it("should return null for null, non-string, malformed, impossible, and zeroed values", () => {
      expect(parseWallClockTime(null)).toBeNull();
      expect(parseWallClockTime(42)).toBeNull();
      expect(parseWallClockTime("2024/06/01 14:30:22")).toBeNull();
      expect(parseWallClockTime("2024-13-01T14:30:22")).toBeNull();
      expect(parseWallClockTime("2024-06-01T25:30:22")).toBeNull();
      expect(parseWallClockTime("0000-00-00T00:00:00")).toBeNull();
    });
  });

  describe("eligibility", () => {
    it("should only include still images in the time finder", () => {
      expect(isTransferTimeFinderEligible("image")).toBe(true);
      expect(isTransferTimeFinderEligible("gif")).toBe(false);
      expect(isTransferTimeFinderEligible("video")).toBe(false);
      expect(isTransferTimeFinderEligible("audio")).toBe(false);
      expect(isTransferTimeFinderEligible("file")).toBe(false);
    });
  });

  describe("buildTransferTimeFinderModel", () => {
    it("should bucket wall-clock values at day edges without shifting dates", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("early", "image", "2024-06-01T00:05:00.000Z"),
        makeEntry("late", "image", "2024-06-01T23:55:00.000Z"),
      ]);

      expect(model.buckets.map((bucket) => bucket.key)).toEqual([
        "2024-06-01T00:00",
        "2024-06-01T23:45",
      ]);
    });

    it("should use the bucket floor for labels and URL params", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("a", "image", "2024-06-01T14:15:00.000Z"),
        makeEntry("b", "image", "2024-06-01T14:29:59.000Z"),
        makeEntry("c", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("d", "image", "2024-06-01T14:45:00.000Z"),
      ]);

      expect(model.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, param: bucket.param }))).toEqual([
        { key: "2024-06-01T14:15", label: "14:15", param: "2024-06-01T14:15" },
        { key: "2024-06-01T14:30", label: "14:30", param: "2024-06-01T14:30" },
        { key: "2024-06-01T14:45", label: "14:45", param: "2024-06-01T14:45" },
      ]);
    });

    it("should hide the finder when every eligible image lands in one bucket", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("a", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("b", "image", "2024-06-01T14:34:59.000Z"),
        makeEntry("c", "image", "2024-06-01T14:31:00.000Z"),
      ]);

      expect(model.buckets).toHaveLength(1);
      expect(model.showFinder).toBe(false);
    });

    it("should hide the finder for a single eligible dated item", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("solo", "image", "2024-06-01T14:30:00.000Z"),
      ]);

      expect(model.buckets).toHaveLength(1);
      expect(model.showFinder).toBe(false);
    });

    it("should classify invalid eligible timestamps as undated", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("dated-a", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("dated-b", "image", "2024-06-01T15:00:00.000Z"),
        makeEntry("bad", "image", "0000-00-00T00:00:00"),
        makeEntry("video", "video", "2024-06-01T14:35:00.000Z"),
      ]);

      expect(model.entries.find((entry) => entry.id === "bad")?.classification).toBe("undated");
      expect(model.entries.find((entry) => entry.id === "video")?.classification).toBe("undated");
      expect(model.showFinder).toBe(true);
    });

    it("should exclude obvious date outliers from bucket generation", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("event-a", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("event-b", "image", "2024-06-01T15:00:00.000Z"),
        makeEntry("event-c", "image", "2024-06-02T10:00:00.000Z"),
        makeEntry("outlier", "image", "2018-02-03T09:00:00.000Z"),
      ]);

      expect(model.modeDateKey).toBe("2024-06-01");
      expect(model.entries.find((entry) => entry.id === "outlier")?.classification).toBe("outlier");
      expect(model.buckets.map((bucket) => bucket.key)).toEqual([
        "2024-06-01T14:30",
        "2024-06-01T15:00",
        "2024-06-02T10:00",
      ]);
      expect(model.showFinder).toBe(true);
    });
  });

  describe("resolveTransferTimeFinderBucket", () => {
    it("should clear stored params that no longer map to a populated bucket", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("a", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("b", "image", "2024-06-01T15:00:00.000Z"),
      ]);

      expect(resolveTransferTimeFinderBucket("2024-06-01T14:30", model.buckets)?.key).toBe("2024-06-01T14:30");
      expect(resolveTransferTimeFinderBucket("2024-06-01T16:30", model.buckets)).toBeNull();
    });
  });

  describe("applyTransferTimeFinderFilter", () => {
    it("should use inclusive +/- 15 minute matching boundaries", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("start", "image", "2024-06-01T14:15:00.000Z"),
        makeEntry("center", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("end", "image", "2024-06-01T14:45:00.000Z"),
        makeEntry("outside", "image", "2024-06-01T14:46:00.000Z"),
      ]);
      const bucket = resolveTransferTimeFinderBucket("2024-06-01T14:30", model.buckets);

      const filtered = applyTransferTimeFinderFilter(model, bucket);

      expect(filtered.orderedEntries.map((entry) => entry.id)).toEqual(["start", "center", "end"]);
      expect(Array.from(filtered.categoryById.entries())).toEqual([
        ["start", "matched"],
        ["center", "matched"],
        ["end", "matched"],
      ]);
    });

    it("should never match across midnight even when minute values are close", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("previous-day", "image", "2024-06-01T23:52:00.000Z"),
        makeEntry("selected-day", "image", "2024-06-02T00:05:00.000Z"),
        makeEntry("later", "image", "2024-06-02T00:15:00.000Z"),
      ]);
      const bucket = resolveTransferTimeFinderBucket("2024-06-02T00:00", model.buckets);

      const filtered = applyTransferTimeFinderFilter(model, bucket);

      expect(filtered.orderedEntries.map((entry) => entry.id)).toEqual(["selected-day", "later"]);
    });

    it("should append undated media and outliers after matched results while preserving order", () => {
      const model = buildTransferTimeFinderModel([
        makeEntry("match-a", "image", "2024-06-01T14:30:00.000Z"),
        makeEntry("match-b", "image", "2024-06-01T14:40:00.000Z"),
        makeEntry("undated-image", "image"),
        makeEntry("video", "video", "2024-06-01T14:35:00.000Z"),
        makeEntry("outlier", "image", "2018-02-03T09:00:00.000Z"),
      ]);
      const bucket = resolveTransferTimeFinderBucket("2024-06-01T14:30", model.buckets);

      const filtered = applyTransferTimeFinderFilter(model, bucket);

      expect(filtered.orderedEntries.map((entry) => entry.id)).toEqual([
        "match-a",
        "match-b",
        "undated-image",
        "video",
        "outlier",
      ]);
      expect(filtered.categoryById.get("video")).toBe("undated");
      expect(filtered.categoryById.get("outlier")).toBe("outlier");
    });
  });
});
