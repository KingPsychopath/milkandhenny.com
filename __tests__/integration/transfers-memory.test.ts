import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for the transfer module using in-memory fallback.
 *
 * When Redis is unavailable, transfers fall back to a Map — this tests
 * that the full save → get → validate → delete flow works correctly
 * through the actual code paths (not mocked logic).
 */

// Force in-memory fallback by mocking redis to return null
vi.mock("@/lib/platform/redis", () => ({
  getRedis: () => null,
}));

import {
  saveTransfer,
  getTransfer,
  deleteTransferData,
  removeTransferFileFromGroups,
  validateDeleteToken,
  generateTransferId,
  generateDeleteToken,
  type TransferData,
} from "@/features/transfers/store";

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
        storageKey: "transfers/test-transfer/originals/photo.jpg",
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

  it("dissolves groups and clears dangling file metadata", () => {
    const transfer = makeTransfer({
      files: [
        {
          id: "still",
          filename: "IMG_1234.HEIC",
          kind: "image",
          size: 1024,
          mimeType: "image/heic",
          storageKey: "transfers/test-transfer/original/still.heic",
          groupId: "raw_pair:primary:still:raw:raw",
          groupRole: "primary",
        },
        {
          id: "raw",
          filename: "IMG_1234.ARW",
          kind: "image",
          size: 4096,
          mimeType: "image/x-sony-arw",
          storageKey: "transfers/test-transfer/original/raw.arw",
          groupId: "raw_pair:primary:still:raw:raw",
          groupRole: "raw",
        },
      ],
      groups: [
        {
          id: "raw_pair:primary:still:raw:raw",
          type: "raw_pair",
          members: [
            { fileId: "still", role: "primary", mimeType: "image/heic" },
            { fileId: "raw", role: "raw", mimeType: "image/x-sony-arw" },
          ],
        },
      ],
    });

    const updated = removeTransferFileFromGroups(transfer, "raw");
    expect(updated.groups).toBeUndefined();
    expect(updated.files.find((file) => file.id === "still")).toMatchObject({ id: "still" });
    expect(updated.files.find((file) => file.id === "still")).not.toHaveProperty("groupId");
    expect(updated.files.find((file) => file.id === "still")).not.toHaveProperty("groupRole");
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
