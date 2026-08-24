import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __emailLinksTesting,
  recordCommunicationLinkClick,
} from "@/features/communications/email-links.server";
import {
  communicationLinkKey,
  renderCommunicationMessage,
} from "@/features/communications/email.server";

describe("communication email links", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs a destination without putting the recipient in the token", () => {
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    const token = __emailLinksTesting.signedToken(
      "11111111-1111-4111-8111-111111111111",
      "/things/spelling-bee",
      new Date(Date.now() + 60_000),
    );
    expect(token).toBeTruthy();
    expect(token).not.toContain("@example.com");
    expect(__emailLinksTesting.verifyToken(token ?? "")).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      destination: "/things/spelling-bee",
    });
  });

  it("rejects altered or expired redirect tokens", async () => {
    vi.stubEnv("AUTH_SECRET", "test-auth-secret");
    const token = __emailLinksTesting.signedToken(
      "22222222-2222-4222-8222-222222222222",
      "https://milkandhenny.com/contact",
      new Date(Date.now() - 1_000),
    );
    expect(__emailLinksTesting.verifyToken(token ?? "")).toBeNull();
    await expect(recordCommunicationLinkClick(`${token ?? ""}altered`)).resolves.toBeNull();
  });

  it("uses the first-party URL in HTML and plain text while previews stay direct", () => {
    const direct = "https://milkandhenny.com/things/spelling-bee";
    const tracked = "https://milkandhenny.com/api/communications/click?token=signed";
    const rendered = renderCommunicationMessage({
      kind: "pitch_nudge",
      subject: "A small invitation",
      body: `[Practise your spelling](${direct})`,
      trackingLinks: new Map([[communicationLinkKey(direct) ?? "", tracked]]),
    });
    expect(rendered.html).toContain(tracked);
    expect(rendered.text).toContain(tracked);
    expect(communicationLinkKey(direct)).toBe("things-spelling-bee");
  });
});
