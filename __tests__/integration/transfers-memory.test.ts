import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for the transfer module using in-memory fallback.
 *
 * When Redis is unavailable, transfers fall back to a Map — this tests
 * that the full save → get → validate → delete flow works correctly
 * through the actual code paths (not mocked logic).
 */

// Force in-memory fallback by mocking redis to return null
vi.mock("@/lib/redis", () => ({
  getRedis: () => null,
}));

import {
  saveTransfer,
  getTransfer,
  deleteTransferData,
  validateDeleteToken,
  generateTransferId,
  generateDeleteToken,
  type TransferData,
} from "@/lib/transfers";

function makeTransfer(overrides?: Partial<TransferData>): TransferData {
  return {
    id: generateTransferId(),
    title: "Test Transfer",
    files: [
      {
        id: "photo-1",
        filename: "photo.jpg",
        kind: "image",
        size: 1024,
        mimeType: "image/jpeg",
      },
    ],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
    deleteToken: generateDeleteToken(),
    ...overrides,
  };
}

describe("transfers (in-memory fallback)", () => {
  beforeEach(() => {
    // Each test gets a fresh transfer to avoid cross-test pollution
  });

  it("saves and retrieves a transfer", async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer, 3600);

    const retrieved = await getTransfer(transfer.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(transfer.id);
    expect(retrieved!.title).toBe("Test Transfer");
    expect(retrieved!.files).toHaveLength(1);
  });

  it("returns null for a non-existent transfer", async () => {
    const result = await getTransfer("does-not-exist");
    expect(result).toBeNull();
  });

  it("validates correct delete token", async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer, 3600);

    const valid = await validateDeleteToken(transfer.id, transfer.deleteToken);
    expect(valid).toBe(true);
  });

  it("rejects incorrect delete token", async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer, 3600);

    const valid = await validateDeleteToken(transfer.id, "wrong-token");
    expect(valid).toBe(false);
  });

  it("rejects empty delete token", async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer, 3600);

    const valid = await validateDeleteToken(transfer.id, "");
    expect(valid).toBe(false);
  });

  it("deletes a transfer and confirms it's gone", async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer, 3600);

    const deleted = await deleteTransferData(transfer.id);
    expect(deleted).toBe(true);

    const retrieved = await getTransfer(transfer.id);
    expect(retrieved).toBeNull();
  });

  it("returns false when deleting a non-existent transfer", async () => {
    const deleted = await deleteTransferData("nonexistent-id");
    expect(deleted).toBe(false);
  });

  it("generateTransferId returns a 3-word hyphenated id", () => {
    const id = generateTransferId();
    const parts = id.split("-");
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });

  it("generateDeleteToken returns a non-empty string", () => {
    const token = generateDeleteToken();
    expect(token.length).toBeGreaterThan(0);
    // 16 bytes → 22 chars in base64url
    expect(token.length).toBe(22);
  });
});
