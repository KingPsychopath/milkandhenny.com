import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Integration tests for the transfer module using in-memory fallback.
 *
 * When Redis is unavailable, transfers fall back to a Map — this tests
 * that the full save → get → validate → delete flow works correctly
 * through the actual code paths (not mocked logic).
 */

// Force in-memory fallback by mocking redis to return null
vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
}));

import {
  appendTransferFiles,
  saveTransfer,
  getTransfer,
  deleteTransferData,
  removeTransferFileFromGroups,
  validateDeleteToken,
  generateTransferId,
  generateDeleteToken,
  normaliseTransferTitle,
  updateTransferFile,
  updateTransferGrouping,
} from "@/features/transfers/store.server";
import type { TransferData } from "@/features/transfers/types";

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

  it("appends and regroups without overwriting a concurrent worker update", async () => {
    const transfer = makeTransfer();
    await saveTransfer(transfer, 3600);
    const appended = await appendTransferFiles(transfer.id, [
      {
        id: "motion-1",
        filename: "motion.mov",
        kind: "video",
        size: 2048,
        storedBytes: 4096,
        mimeType: "video/quicktime",
        storageKey: `transfers/${transfer.id}/originals/motion.mov`,
      },
    ]);
    expect(appended.status).toBe("updated");
    if (appended.status !== "updated") return;

    await updateTransferFile(transfer.id, {
      ...transfer.files[0],
      processingStatus: "worker_done",
      previewStatus: "ready",
    });
    await updateTransferGrouping(
      transfer.id,
      appended.transfer.files.map((file) =>
        file.id === "motion-1" ? { ...file, groupId: "live-1", groupRole: "motion" } : file,
      ),
      undefined,
    );

    expect(await getTransfer(transfer.id)).toMatchObject({
      files: [
        expect.objectContaining({
          id: "photo-1",
          processingStatus: "worker_done",
          previewStatus: "ready",
        }),
        expect.objectContaining({ id: "motion-1", groupId: "live-1" }),
      ],
    });
    expect((await getTransfer(transfer.id))?.files[1]?.storedBytes).toBe(4096);
  });

  it("enforces append limits atomically and reserves archived filenames", async () => {
    const transfer = makeTransfer({
      files: [
        {
          ...makeTransfer().files[0],
          storedBytes: 900,
          originalFilename: "camera-original.tiff",
        },
      ],
    });
    await saveTransfer(transfer, 3600);

    await expect(
      appendTransferFiles(
        transfer.id,
        [
          {
            id: "second",
            filename: "second.jpg",
            kind: "image",
            size: 200,
            storedBytes: 200,
            mimeType: "image/jpeg",
            storageKey: `transfers/${transfer.id}/originals/second.jpg`,
          },
        ],
        { maxFiles: 2, maxTotalBytes: 1_000 },
      ),
    ).resolves.toEqual({ status: "limit" });

    await expect(
      appendTransferFiles(transfer.id, [
        {
          id: "collision",
          filename: "camera-original.tiff",
          kind: "image",
          size: 10,
          mimeType: "image/tiff",
          storageKey: `transfers/${transfer.id}/originals/camera-original.tiff`,
        },
      ]),
    ).resolves.toEqual({ status: "conflict" });
  });

  it("normalises untrusted transfer titles to a bounded single line", () => {
    expect(normaliseTransferTitle({ title: "not a string" })).toBe("untitled");
    expect(normaliseTransferTitle("  party\n\tphotos  ")).toBe("party photos");
    expect(normaliseTransferTitle("x".repeat(300))).toHaveLength(160);
  });

  it("generateTransferId returns a 128-bit base64url capability id", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateTransferId()));
    expect(ids.size).toBe(20);
    expect([...ids].every((id) => id.length === 22 && /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
  });

  it("generateDeleteToken returns a non-empty string", () => {
    const token = generateDeleteToken();
    expect(token.length).toBeGreaterThan(0);
    // 16 bytes → 22 chars in base64url
    expect(token.length).toBe(22);
  });
});
