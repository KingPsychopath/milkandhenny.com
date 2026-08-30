import { describe, it, expect, beforeAll } from "vitest";

/**
 * Unit tests for ticket identity, QR signing, and payload parsing.
 *
 * The signature is the only thing standing between a scanner and a forged
 * ticket, so tamper cases are covered explicitly rather than implied.
 */

process.env.AUTH_SECRET = "test-secret-value-long-enough-to-pass";

import {
  buildTicketQrPayload,
  generateTicketId,
  hashEmail,
  hashTicketId,
  isTicketSigningConfigured,
  signTicketId,
  verifyTicketSignature,
} from "@/features/tickets/qr.server";
import {
  MANIFEST_HASH_LENGTH,
  formatTicketQrPayload,
  isValidTicketId,
  parseTicketQrPayload,
  ticketPublicId,
} from "@/features/tickets/types";
import { assessEmailAddress, isValidEmail, normaliseEmail } from "@/lib/shared/email-address";
import { projectRedeemOutcomeForScanner } from "@/features/tickets/scanner-boundary";

describe("ticket ids", () => {
  it("uses a rotated bearer reference at scanner boundaries", () => {
    const id = "0123456789ABCDEF";
    expect(ticketPublicId({ id, accessReference: "0A1B2C3D4E5F6G7H" })).toBe("0A1B2C3D4E5F6G7H");
    expect(ticketPublicId({ id })).toBe(id);
  });

  it("projects the scanned bearer reference only at the public scanner boundary", () => {
    const internalId = "0123456789ABCDEF";
    const publicId = "0A1B2C3D4E5F6G7H";
    const outcome = {
      result: "admitted" as const,
      ticket: {
        id: internalId,
        orderId: "order-1",
        holderName: "Alice",
        ticketTypeName: "Entry",
        kind: "free" as const,
        status: "valid" as const,
        isPlusOne: false,
      },
    };

    expect(projectRedeemOutcomeForScanner(outcome, publicId)).toMatchObject({
      ticket: { id: publicId },
    });
    expect(outcome.ticket.id).toBe(internalId);
  });

  it("generates ids over the unambiguous alphabet", () => {
    for (let index = 0; index < 200; index += 1) {
      const id = generateTicketId();
      expect(id).toHaveLength(16);
      expect(isValidTicketId(id)).toBe(true);
      // I, L, O and U are excluded so ids can be read aloud at a door.
      expect(id).not.toMatch(/[ILOU]/);
    }
  });

  it("does not collide across a realistic event's worth of tickets", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => generateTicketId()));
    expect(ids.size).toBe(5_000);
  });

  it("rejects malformed ids", () => {
    expect(isValidTicketId("")).toBe(false);
    expect(isValidTicketId("short")).toBe(false);
    expect(isValidTicketId("abcdefghijklmnop")).toBe(false); // lowercase
    expect(isValidTicketId("IIIIIIIIIIIIIIII")).toBe(false); // excluded letter
    expect(isValidTicketId(null)).toBe(false);
  });
});

describe("signing", () => {
  beforeAll(() => {
    expect(isTicketSigningConfigured()).toBe(true);
  });

  it("verifies a signature it produced", () => {
    const id = generateTicketId();
    expect(verifyTicketSignature(id, signTicketId(id))).toBe(true);
  });

  it("is deterministic for the same id", () => {
    const id = generateTicketId();
    expect(signTicketId(id)).toBe(signTicketId(id));
  });

  it("rejects a signature from a different ticket", () => {
    const a = generateTicketId();
    const b = generateTicketId();
    expect(verifyTicketSignature(a, signTicketId(b))).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const id = generateTicketId();
    const signature = signTicketId(id);
    const tampered = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(verifyTicketSignature(id, tampered)).toBe(false);
  });

  it("rejects an empty or wrong-length signature", () => {
    const id = generateTicketId();
    expect(verifyTicketSignature(id, "")).toBe(false);
    expect(verifyTicketSignature(id, "tooshort")).toBe(false);
  });

  it("refuses to sign a malformed id", () => {
    expect(() => signTicketId("not-a-ticket")).toThrow();
  });
});

describe("qr payload parsing", () => {
  it("round-trips a built payload", () => {
    const id = generateTicketId();
    const payload = buildTicketQrPayload(id);
    const parsed = parseTicketQrPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.ticketId).toBe(id);
    expect(verifyTicketSignature(parsed!.ticketId, parsed!.signature)).toBe(true);
  });

  it("tolerates surrounding whitespace from a scanner", () => {
    const id = generateTicketId();
    expect(parseTicketQrPayload(`  ${buildTicketQrPayload(id)}\n`)?.ticketId).toBe(id);
  });

  it("extracts a payload from a URL query parameter", () => {
    const id = generateTicketId();
    const payload = buildTicketQrPayload(id);
    expect(parseTicketQrPayload(`https://milkandhenny.com/scan?t=${payload}`)?.ticketId).toBe(id);
  });

  it("rejects an unknown version prefix", () => {
    const id = generateTicketId();
    expect(parseTicketQrPayload(`mah9.${id}.${signTicketId(id)}`)).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseTicketQrPayload("")).toBeNull();
    expect(parseTicketQrPayload("hello world")).toBeNull();
    expect(parseTicketQrPayload("mah1.short.sig")).toBeNull();
    expect(parseTicketQrPayload(formatTicketQrPayload("BAD", "x"))).toBeNull();
  });
});

describe("hashing", () => {
  it("produces manifest hashes of the agreed length", () => {
    const hash = hashTicketId(generateTicketId());
    expect(hash).toHaveLength(MANIFEST_HASH_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("hashes the same id to the same manifest entry", () => {
    const id = generateTicketId();
    expect(hashTicketId(id)).toBe(hashTicketId(id));
  });

  it("normalises email before hashing so casing and spacing do not split a buyer", () => {
    expect(hashEmail("Person@Example.com")).toBe(hashEmail("  person@example.com  "));
    expect(normaliseEmail(" A@B.COM ")).toBe("a@b.com");
  });

  it("validates email shape and public suffixes", () => {
    expect(isValidEmail("person@example.com")).toBe(true);
    expect(isValidEmail("person@gmail.con")).toBe(false);
    expect(isValidEmail("person@example.photography")).toBe(true);
    expect(isValidEmail("person@company.om")).toBe(true);
    expect(isValidEmail("first..last@example.com")).toBe(false);
    expect(assessEmailAddress("person@gmail.co")).toMatchObject({
      valid: true,
      suggestion: "person@gmail.com",
    });
    expect(assessEmailAddress("person@gmail.con")).toMatchObject({
      valid: false,
      suggestion: "person@gmail.com",
    });
    expect(assessEmailAddress("person@company.con")).toMatchObject({
      valid: false,
      suggestion: undefined,
    });
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("trailing@dot.")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });
});
