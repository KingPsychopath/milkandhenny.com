import { beforeEach, describe, expect, it, vi } from "vitest";

function makeRequest(files: Array<{ name: string; size: number; type: string }>) {
  return new Request("http://localhost/api/upload/transfer/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      transferId: "transfer-1",
      deleteToken: "delete-token",
      files,
    }),
  });
}

describe("upload transfer resume", () => {
  beforeEach(() => vi.resetModules());

  it("only remints upload URLs for files that did not fully reach storage", async () => {
    const headObject = vi
      .fn()
      .mockResolvedValueOnce({ exists: true, size: 10 })
      .mockResolvedValueOnce({ exists: false });
    const presignPutUrl = vi.fn().mockResolvedValue("https://example.com/missing");
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "upload-session" },
      }),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({
      MAX_TRANSFER_FILES: 500,
    }));
    vi.doMock("@/features/transfers/upload-reservation.server", () => ({
      getTransferUploadReservation: vi.fn().mockResolvedValue({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        actorJti: "upload-session",
        expiresSeconds: 3600,
        filesFingerprint: "fingerprint",
      }),
      transferUploadFilesFingerprint: vi.fn().mockReturnValue("fingerprint"),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({ headObject, presignPutUrl }));

    const { POST } = await import("@/src/routes/api/upload/transfer/resume/route");
    const response = await POST(
      makeRequest([
        { name: "arrived.zip", size: 10, type: "application/zip" },
        { name: "missing.zip", size: 20, type: "application/zip" },
      ]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      uploadedNames: ["arrived.zip"],
      urls: [{ name: "missing.zip", primaryUrl: "https://example.com/missing" }],
    });
    expect(presignPutUrl).toHaveBeenCalledOnce();
  });

  it("does not reveal recovery state to a different upload session", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "different-session" },
      }),
    }));
    vi.doMock("@/features/transfers/store.server", () => ({ MAX_TRANSFER_FILES: 500 }));
    vi.doMock("@/features/transfers/upload-reservation.server", () => ({
      getTransferUploadReservation: vi.fn().mockResolvedValue({
        transferId: "transfer-1",
        deleteToken: "delete-token",
        actorJti: "upload-session",
        expiresSeconds: 3600,
        filesFingerprint: "fingerprint",
      }),
      transferUploadFilesFingerprint: vi.fn().mockReturnValue("fingerprint"),
    }));
    vi.doMock("@/lib/platform/r2.server", () => ({
      headObject: vi.fn(),
      presignPutUrl: vi.fn(),
    }));

    const { POST } = await import("@/src/routes/api/upload/transfer/resume/route");
    const response = await POST(
      makeRequest([{ name: "archive.zip", size: 10, type: "application/zip" }]),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Those files do not match the interrupted upload",
    });
  });
});
