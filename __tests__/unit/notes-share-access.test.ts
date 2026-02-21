import { afterAll, describe, expect, it } from "vitest";
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

  afterAll(() => {
    process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
  });
});
