import { describe, expect, it } from "vitest";
import { toPublicTransfer } from "@/features/transfers/public";

describe("public transfer projection", () => {
  it("should remove delete credentials and private object keys", () => {
    const result = toPublicTransfer({
      id: "private-transfer",
      title: "private",
      createdAt: "2026-07-15T00:00:00.000Z",
      expiresAt: "2026-07-16T00:00:00.000Z",
      deleteToken: "delete-secret",
      files: [
        {
          id: "photo",
          filename: "photo.jpg",
          kind: "image",
          size: 10,
          mimeType: "image/jpeg",
          storageKey: "transfers/private-transfer/originals/photo.jpg",
          originalStorageKey: "transfers/private-transfer/originals/photo.raw",
        },
      ],
    });

    expect(result).not.toHaveProperty("deleteToken");
    expect(result.files[0]).not.toHaveProperty("storageKey");
    expect(result.files[0]).not.toHaveProperty("originalStorageKey");
    expect(result.files[0]).toMatchObject({ id: "photo", filename: "photo.jpg" });
  });
});
