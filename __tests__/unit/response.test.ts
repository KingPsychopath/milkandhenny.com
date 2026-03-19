import { describe, expect, it } from "vitest";

describe("response helpers", () => {
  it("parses json bodies when available", async () => {
    const { readResponsePayload } = await import("@/lib/client/response");
    const payload = await readResponsePayload(
      new Response(JSON.stringify({ error: "nope" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    );

    expect(payload.json).toEqual({ error: "nope" });
    expect(payload.text).toContain("nope");
  });

  it("keeps plain text bodies available for error messaging", async () => {
    const { getResponseErrorMessage, readResponsePayload } = await import("@/lib/client/response");
    const payload = await readResponsePayload(
      new Response("An error occurred while preparing the download.", {
        status: 500,
        headers: { "content-type": "text/plain" },
      })
    );

    expect(payload.json).toBeNull();
    expect(getResponseErrorMessage(payload, "fallback")).toBe(
      "An error occurred while preparing the download."
    );
  });
});
