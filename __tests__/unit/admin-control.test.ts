import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestAdminApi } from "../../scripts/admin-control";

afterEach(() => vi.unstubAllGlobals());

describe("admin control responses", () => {
  it("preserves binary downloads byte-for-byte", async () => {
    const bytes = Uint8Array.from([0, 255, 1, 128, 10]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { headers: { "content-type": "application/pdf" } })),
    );
    const directory = await mkdtemp(path.join(os.tmpdir(), "mh-admin-control-"));
    const outputPath = path.join(directory, "pack.pdf");
    try {
      const result = await requestAdminApi({
        baseUrl: "https://milkandhenny.com",
        adminToken: "token",
        method: "POST",
        path: "/api/admin/events/test/scoring",
        body: { action: "print-pdf" },
        outputPath,
      });
      expect(new Uint8Array(await readFile(outputPath))).toEqual(bytes);
      expect(result).toMatchObject({
        outputPath,
        bytes: bytes.length,
        contentType: "application/pdf",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("continues to decode JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true })),
    );
    await expect(
      requestAdminApi({
        baseUrl: "https://milkandhenny.com",
        adminToken: "token",
        method: "GET",
        path: "/api/admin/events",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
