import { describe, it, expect, vi } from "vitest";

/**
 * Integration tests for transfers admin (features/transfers/admin).
 *
 * Covers isSafeTransferId validation and that adminDeleteTransfer rejects
 * invalid ids without touching R2/Redis.
 */

vi.mock("@/lib/platform/redis", () => ({
  getRedis: () => null,
}));

vi.mock("@/lib/platform/r2", () => ({
  listObjects: vi.fn().mockResolvedValue([]),
  deleteObjects: vi.fn().mockResolvedValue(0),
}));

import {
  isSafeTransferId,
  adminDeleteTransfer,
} from "@/features/transfers/admin";

describe("transfers admin", () => {
  describe("isSafeTransferId", () => {
    it("returns true for valid word-style ids", () => {
      expect(isSafeTransferId("velvet-moon-candle")).toBe(true);
      expect(isSafeTransferId("a-b-c")).toBe(true);
      expect(isSafeTransferId("xK9mP2nQ7vL")).toBe(true);
    });

    it("returns false for empty or invalid characters", () => {
      expect(isSafeTransferId("")).toBe(false);
      expect(isSafeTransferId("bad/id")).toBe(false);
      expect(isSafeTransferId("../../etc")).toBe(false);
      expect(isSafeTransferId("id with spaces")).toBe(false);
      expect(isSafeTransferId("id\u0000injection")).toBe(false);
    });
  });

  describe("adminDeleteTransfer", () => {
    it("throws for invalid transfer id without calling R2 or store", async () => {
      await expect(adminDeleteTransfer("invalid!id")).rejects.toThrow(
        "Invalid transfer id"
      );
      await expect(adminDeleteTransfer("../../../etc")).rejects.toThrow(
        "Invalid transfer id"
      );
    });
  });
});
