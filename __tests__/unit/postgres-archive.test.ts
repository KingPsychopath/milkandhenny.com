import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("rejects a tampered PostgreSQL archive before invoking database tools", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mah-archive-"));
  const file = join(directory, "backup.dump");
  try {
    await writeFile(file, "tampered");
    await writeFile(
      `${file}.json`,
      JSON.stringify({ format: "postgres-custom", bytes: 8, sha256: "0".repeat(64) }),
    );
    const result = spawnSync(
      process.execPath,
      ["ops/postgres-archive.mjs", "restore", file, "--confirm-empty-target"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "postgres://unused@127.0.0.1:1/unused",
          PATH: directory,
        },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Archive checksum or size does not match");
    expect(result.stderr).not.toContain("spawn pg_restore");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
