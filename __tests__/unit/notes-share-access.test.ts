import { afterAll, describe, expect, it, vi } from "vitest";
import {
  createShareLink,
  signNoteAccessToken,
  updateShareLink,
  verifyNoteAccessToken,
  verifyShareLinkAccess,
} from "@/features/notes/share";

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;

describe("notes share access", () => {
  it("enforces PIN only for links configured with PIN", async () => {
    const slug = uniqueSlug("share-mixed");

    const noPin = await createShareLink({ slug, pinRequired: false });
    const withPin = await createShareLink({ slug, pinRequired: true, pin: "2580" });

    const openResult = await verifyShareLinkAccess({
      slug,
      token: noPin.token,
      ip: "127.0.0.1",
    });
    expect(openResult.ok).toBe(true);

    const pinMissing = await verifyShareLinkAccess({
      slug,
      token: withPin.token,
      ip: "127.0.0.1",
    });
    expect(pinMissing.ok).toBe(false);
    if (!pinMissing.ok) {
      expect(pinMissing.pinRequired).toBe(true);
      expect(pinMissing.status).toBe(401);
    }

    const pinCorrect = await verifyShareLinkAccess({
      slug,
      token: withPin.token,
      pin: "2580",
      ip: "127.0.0.1",
    });
    expect(pinCorrect.ok).toBe(true);
  });

  it("invalidates old note-access cookies when a link becomes PIN-protected", async () => {
    process.env.AUTH_SECRET = "test-auth-secret-with-at-least-thirty-two-characters";
    const slug = uniqueSlug("pin-toggle");

    const created = await createShareLink({ slug, pinRequired: false });
    const verified = await verifyShareLinkAccess({
      slug,
      token: created.token,
      ip: "127.0.0.2",
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const accessToken = signNoteAccessToken(verified.link);
    expect(accessToken).toBeTruthy();
    expect(await verifyNoteAccessToken(slug, accessToken ?? "")).toBe(true);

    const updated = await updateShareLink(slug, verified.link.id, {
      pinRequired: true,
      pin: "9876",
    });
    expect(updated).toBeTruthy();

    expect(await verifyNoteAccessToken(slug, accessToken ?? "")).toBe(false);

    const verifiedWithPin = await verifyShareLinkAccess({
      slug,
      token: created.token,
      pin: "9876",
      ip: "127.0.0.2",
    });
    expect(verifiedWithPin.ok).toBe(true);
  });

  it("invalidates old note-access cookies when the link token rotates", async () => {
    process.env.AUTH_SECRET = "test-auth-secret-with-at-least-thirty-two-characters";
    const slug = uniqueSlug("rotate-token");

    const created = await createShareLink({ slug, pinRequired: false });
    const verified = await verifyShareLinkAccess({
      slug,
      token: created.token,
      ip: "127.0.0.3",
    });
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const accessToken = signNoteAccessToken(verified.link);
    expect(accessToken).toBeTruthy();
    expect(await verifyNoteAccessToken(slug, accessToken ?? "")).toBe(true);

    const rotated = await updateShareLink(slug, verified.link.id, {
      rotateToken: true,
    });
    expect(rotated?.token).toBeTruthy();

    expect(await verifyNoteAccessToken(slug, accessToken ?? "")).toBe(false);
  });

  it("rejects PIN changes for expired links", async () => {
    const slug = uniqueSlug("expired-pin");
    const created = await createShareLink({ slug, pinRequired: false, expiresInDays: 1 });
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + 2 * 86400 * 1000);
    try {
      await expect(
        updateShareLink(slug, created.link.id, {
          pinRequired: true,
          pin: "4321",
        })
      ).rejects.toThrow(/expired|revoked/i);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reissues expired links when expiry is extended and token is rotated", async () => {
    const slug = uniqueSlug("expired-reissue");
    const created = await createShareLink({ slug, pinRequired: false, expiresInDays: 1 });
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + 2 * 86400 * 1000);
    try {
      const updated = await updateShareLink(slug, created.link.id, {
        rotateToken: true,
        expiresInDays: 7,
      });
      expect(updated?.token).toBeTruthy();

      const oldTokenAccess = await verifyShareLinkAccess({
        slug,
        token: created.token,
        ip: "127.0.0.4",
      });
      expect(oldTokenAccess.ok).toBe(false);

      const newTokenAccess = await verifyShareLinkAccess({
        slug,
        token: updated?.token ?? "",
        ip: "127.0.0.4",
      });
      expect(newTokenAccess.ok).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });

  afterAll(() => {
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  });
});
