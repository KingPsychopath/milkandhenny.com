import { beforeEach, describe, expect, it, vi } from "vitest";

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockStore(validOwner: boolean) {
  vi.doMock("@/features/transfers/store.server", () => ({
    MAX_TRANSFER_FILE_BYTES: 250,
    MAX_TRANSFER_TOTAL_BYTES: 1_000,
    validateDeleteToken: vi.fn().mockResolvedValue(validOwner),
  }));
}

describe("transfer append owner access", () => {
  beforeEach(() => vi.resetModules());

  it("lets an upload-session owner add files to the same transfer", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "upload-session" },
      }),
    }));
    mockStore(true);
    const appendPresign = vi
      .fn()
      .mockResolvedValue(Response.json({ urls: [], remainingTtlSeconds: 300 }));
    vi.doMock("@/features/transfers/append.server", () => ({ appendPresign }));

    const { POST } = await import("@/src/routes/api/upload/transfer/append/presign/route");
    const response = await POST(
      request("/api/upload/transfer/append/presign", {
        transferId: "transfer-1",
        deleteToken: "owner-secret",
        files: [{ name: "more.zip", size: 10 }],
      }),
    );

    expect(response.status).toBe(200);
    expect(appendPresign).toHaveBeenCalledWith(
      expect.any(Request),
      "transfer-1",
      [{ name: "more.zip", size: 10 }],
      { maxFileBytes: 250, maxTotalBytes: 1_000 },
    );
  });

  it("rejects a non-admin without the matching private owner token", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "upload", jti: "another-session" },
      }),
    }));
    mockStore(false);
    const appendFinalize = vi.fn();
    vi.doMock("@/features/transfers/append.server", () => ({ appendFinalize }));

    const { POST } = await import("@/src/routes/api/upload/transfer/append/finalize/route");
    const response = await POST(
      request("/api/upload/transfer/append/finalize", {
        transferId: "transfer-1",
        deleteToken: "wrong-secret",
        files: [{ name: "more.zip", size: 10 }],
      }),
    );

    expect(response.status).toBe(403);
    expect(appendFinalize).not.toHaveBeenCalled();
  });

  it("keeps admin append available without an owner token", async () => {
    vi.doMock("@/features/auth/auth.server", () => ({
      requireAuthWithPayload: vi.fn().mockResolvedValue({
        error: null,
        payload: { role: "admin", jti: "admin-session" },
      }),
    }));
    mockStore(false);
    const appendFinalize = vi.fn().mockResolvedValue(Response.json({ addedCount: 1 }));
    vi.doMock("@/features/transfers/append.server", () => ({ appendFinalize }));

    const { POST } = await import("@/src/routes/api/upload/transfer/append/finalize/route");
    const response = await POST(
      request("/api/upload/transfer/append/finalize", {
        transferId: "transfer-1",
        files: [{ name: "more.zip", size: 10 }],
      }),
    );

    expect(response.status).toBe(200);
    expect(appendFinalize).toHaveBeenCalledWith(
      expect.any(Request),
      "transfer-1",
      [{ name: "more.zip", size: 10 }],
      {},
    );
  });
});
