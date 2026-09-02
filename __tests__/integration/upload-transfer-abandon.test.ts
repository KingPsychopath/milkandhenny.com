import { beforeEach, describe, expect, it, vi } from "vitest";

const runMediaEffect = vi.fn();

vi.mock("@/features/auth/auth.server", () => ({
  requireAuthWithPayload: vi.fn().mockResolvedValue({
    error: null,
    payload: { role: "upload", jti: "upload-session" },
  }),
}));
vi.mock("@/features/system/media-worker-runtime.server", () => ({ runMediaEffect }));

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/upload/transfer/abandon", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("upload transfer abandon", () => {
  beforeEach(() => {
    runMediaEffect.mockReset();
  });

  it("removes stored parts for the authenticated recovery owner", async () => {
    runMediaEffect.mockResolvedValue({ status: "abandoned", deletedObjects: 2 });
    const { POST } = await import("@/src/routes/api/upload/transfer/abandon/route");

    const response = await POST(
      makeRequest({ transferId: "transfer-1", deleteToken: "delete-token" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "abandoned", deletedObjects: 2 });
    expect(runMediaEffect).toHaveBeenCalledOnce();
  });

  it("does not disclose or discard another upload session's reservation", async () => {
    runMediaEffect.mockResolvedValue({ status: "reservation-mismatch" });
    const { POST } = await import("@/src/routes/api/upload/transfer/abandon/route");

    const response = await POST(
      makeRequest({ transferId: "transfer-1", deleteToken: "wrong-token" }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That unfinished transfer does not belong to this upload session",
    });
  });

  it("rejects malformed discard requests", async () => {
    const { POST } = await import("@/src/routes/api/upload/transfer/abandon/route");
    const response = await POST(makeRequest({ transferId: "transfer-1" }));

    expect(response.status).toBe(400);
    expect(runMediaEffect).not.toHaveBeenCalled();
  });
});
