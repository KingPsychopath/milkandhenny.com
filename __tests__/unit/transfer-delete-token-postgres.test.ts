import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decryptTransferDeleteToken,
  encryptTransferDeleteToken,
  verifyTransferDeleteToken,
} from "@/features/transfers/delete-token-postgres.server";

describe("Postgres transfer deletion-token codec", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_SECRET", "unit-test-transfer-key-material-at-least-32-bytes");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips with transfer-bound authenticated encryption", () => {
    const first = encryptTransferDeleteToken("transfer-one", "private-delete-token");
    const second = encryptTransferDeleteToken("transfer-one", "private-delete-token");
    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext.includes(Buffer.from("private-delete-token"))).toBe(false);
    expect(decryptTransferDeleteToken("transfer-one", first.ciphertext, first.nonce)).toBe(
      "private-delete-token",
    );
    expect(verifyTransferDeleteToken("private-delete-token", first.hash)).toBe(true);
    expect(verifyTransferDeleteToken("wrong-token", first.hash)).toBe(false);
  });

  it("rejects a different transfer identity and modified ciphertext", () => {
    const sealed = encryptTransferDeleteToken("transfer-one", "private-delete-token");
    expect(() =>
      decryptTransferDeleteToken("transfer-two", sealed.ciphertext, sealed.nonce),
    ).toThrow();
    const changed = Buffer.from(sealed.ciphertext);
    changed[0] ^= 1;
    expect(() => decryptTransferDeleteToken("transfer-one", changed, sealed.nonce)).toThrow();
  });

  it("fails closed without the web encryption secret", () => {
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => encryptTransferDeleteToken("transfer-one", "private-delete-token")).toThrow(
      "Transfer token encryption key unavailable",
    );
  });
});
