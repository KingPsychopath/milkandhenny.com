import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Client } from "pg";

const MAX_GUEST_JSON_BYTES = 16 * 1024 * 1024;
const ARCHIVE_ROLE = "mah_legacy_archive_importer";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function guestCounts(payload) {
  const guests = JSON.parse(payload.toString("utf8"));
  if (!Array.isArray(guests)) throw new Error("Guest archive must be a JSON array");
  let plusOnes = 0;
  for (const guest of guests) {
    if (
      guest === null ||
      typeof guest !== "object" ||
      typeof guest.id !== "string" ||
      typeof guest.name !== "string" ||
      !Array.isArray(guest.plusOnes)
    ) {
      throw new Error("Guest archive contains an invalid top-level guest");
    }
    plusOnes += guest.plusOnes.length;
  }
  return { guestCount: guests.length, plusOneCount: plusOnes };
}

function archiveKey() {
  const hex = process.env.ARCHIVE_KEY_HEX;
  if (!hex || !HASH_PATTERN.test(hex)) {
    throw new Error("ARCHIVE_KEY_HEX must contain a dedicated 32-byte lowercase hex key");
  }
  return Buffer.from(hex, "hex");
}

function associatedData(sourceHash) {
  return Buffer.from(`mah:legacy-guest-list:v1:${sourceHash}`, "utf8");
}

function decryptRow(row, key) {
  if (
    row.encryption_version !== 1 ||
    !Buffer.isBuffer(row.nonce) ||
    !Buffer.isBuffer(row.auth_tag) ||
    !Buffer.isBuffer(row.ciphertext)
  ) {
    throw new Error("Archive encryption metadata is invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, row.nonce);
  decipher.setAAD(associatedData(row.source_rdb_sha256));
  decipher.setAuthTag(row.auth_tag);
  const payload = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);
  if (sha256(payload) !== row.payload_sha256) {
    throw new Error("Archive payload checksum mismatch");
  }
  const counts = guestCounts(payload);
  if (counts.guestCount !== row.guest_count || counts.plusOneCount !== row.plus_one_count) {
    throw new Error("Archive guest counts mismatch");
  }
  return counts;
}

async function readArchive(client, sourceHash) {
  const result = await client.query(
    `select source_rdb_sha256, payload_sha256, guest_count, plus_one_count,
            encryption_version, nonce, auth_tag, ciphertext
       from legacy_archive.guest_list_exports
      where source_rdb_sha256 = $1`,
    [sourceHash],
  );
  return result.rows[0] ?? null;
}

async function main() {
  const [action, sourceHash, filePath] = process.argv.slice(2);
  if (
    !["import", "verify"].includes(action) ||
    !sourceHash ||
    !HASH_PATTERN.test(sourceHash) ||
    (action === "import" && (!filePath || !isAbsolute(filePath))) ||
    (action === "verify" && filePath)
  ) {
    throw new Error(
      "Usage: node ops/legacy-guest-archive.mjs import <rdb-sha256> <absolute-guest-json-path> | verify <rdb-sha256>",
    );
  }
  const connectionString = process.env.ARCHIVE_DATABASE_URL;
  if (!connectionString) throw new Error("ARCHIVE_DATABASE_URL is required");
  const key = archiveKey();
  const client = new Client({ connectionString });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const identity = await client.query("select current_user as role");
    if (identity.rows[0]?.role !== ARCHIVE_ROLE) {
      throw new Error(`Archive connection must use the ${ARCHIVE_ROLE} role`);
    }

    if (action === "verify") {
      const row = await readArchive(client, sourceHash);
      if (!row) throw new Error("Archive source hash was not found");
      const counts = decryptRow(row, key);
      console.log(
        JSON.stringify({ event: "legacy_guest_archive.verified", sourceHash, ...counts }),
      );
      return;
    }

    const file = await stat(filePath);
    if (!file.isFile() || file.size > MAX_GUEST_JSON_BYTES || (file.mode & 0o077) !== 0) {
      throw new Error("Input must be a private regular JSON file no larger than 16 MiB");
    }
    const payload = await readFile(filePath);
    const counts = guestCounts(payload);
    const payloadHash = sha256(payload);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(associatedData(sourceHash));
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const authTag = cipher.getAuthTag();

    await client.query(
      `insert into legacy_archive.guest_list_exports
         (source_rdb_sha256, payload_sha256, guest_count, plus_one_count,
          nonce, auth_tag, ciphertext)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (source_rdb_sha256) do nothing`,
      [sourceHash, payloadHash, counts.guestCount, counts.plusOneCount, nonce, authTag, ciphertext],
    );
    const row = await readArchive(client, sourceHash);
    if (!row || row.payload_sha256 !== payloadHash) {
      throw new Error("Archive source hash already holds different guest data");
    }
    decryptRow(row, key);
    console.log(JSON.stringify({ event: "legacy_guest_archive.imported", sourceHash, ...counts }));
  } finally {
    key.fill(0);
    if (connected) await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Guest archive operation failed");
  process.exitCode = 1;
});
