import { describe, expect, it, vi } from "vitest";

import { dataUrlToBlob } from "@/features/things/pitches/ui/files.client";

/** Representative PNG bytes, including values that cannot round-trip through UTF-8 text. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

describe("dataUrlToBlob", () => {
  it("decodes a base64 image without touching the network", async () => {
    // `fetch("data:…")` is blocked by the site's CSP connect-src in production,
    // which surfaced as a bare "Failed to fetch" on every canvas image upload.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const blob = await dataUrlToBlob(PNG_DATA_URL);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG_BYTES);
    fetchSpy.mockRestore();
  });

  it("decodes a percent-encoded payload", async () => {
    const blob = await dataUrlToBlob("data:image/svg+xml,%3Csvg%2F%3E");

    expect(blob.type).toBe("image/svg+xml");
    expect(await blob.text()).toBe("<svg/>");
  });

  it("preserves media parameters in the type", async () => {
    const blob = await dataUrlToBlob("data:image/png;charset=utf-8;base64,aGk=");

    expect(blob.type).toBe("image/png;charset=utf-8");
  });

  it("decodes raw percent bytes without UTF-8 replacement", async () => {
    const blob = await dataUrlToBlob("data:image/png,%FF");

    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0xff]));
  });

  it("accepts the case-insensitive base64 marker and encoded payload characters", async () => {
    const blob = await dataUrlToBlob("data:image/png;BASE64,aG%6b=");

    expect(await blob.text()).toBe("hi");
  });

  it("rejects anything that is not a data URL", async () => {
    await expect(dataUrlToBlob("https://example.com/cat.png")).rejects.toThrow(
      "not stored in a readable form",
    );
  });

  it("rejects a truncated payload", async () => {
    await expect(dataUrlToBlob("data:image/png;base64,####")).rejects.toThrow("could not be read");
  });
});
