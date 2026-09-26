import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const CIPHER_VERSION = "auth-secret-v1";

function tokenKey(): Buffer {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Transfer token encryption key unavailable");
  return createHmac("sha256", secret).update("mah:transfer:delete-token:aes-gcm:v1").digest();
}

function associatedData(transferId: string): Buffer {
  return Buffer.from(`mah:transfer:delete-token:${CIPHER_VERSION}:${transferId}`, "utf8");
}

export function hashTransferDeleteToken(token: string): string {
  return createHash("sha256")
    .update("mah:transfer:delete-token:lookup:v1:")
    .update(token)
    .digest("hex");
}

export function verifyTransferDeleteToken(token: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(
    Buffer.from(hashTransferDeleteToken(token), "hex"),
    Buffer.from(expectedHash, "hex"),
  );
}

export function encryptTransferDeleteToken(
  transferId: string,
  token: string,
): {
  ciphertext: Buffer;
  nonce: Buffer;
  hash: string;
} {
  if (!transferId || !token) throw new Error("Invalid transfer token");
  const key = tokenKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(associatedData(transferId));
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return { ciphertext, nonce, hash: hashTransferDeleteToken(token) };
  } finally {
    key.fill(0);
  }
}

export function decryptTransferDeleteToken(
  transferId: string,
  ciphertext: Buffer,
  nonce: Buffer,
): string {
  if (!transferId || nonce.length !== 12 || ciphertext.length < 17)
    throw new Error("Invalid encrypted transfer token");
  const key = tokenKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(associatedData(transferId));
    decipher.setAuthTag(ciphertext.subarray(-16));
    return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString(
      "utf8",
    );
  } finally {
    key.fill(0);
  }
}
