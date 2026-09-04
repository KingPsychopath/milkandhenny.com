import { afterEach, describe, expect, it, vi } from "vitest";

import { __surveyInvitationTesting } from "@/features/surveys/invitations.server";

describe("survey invitation tokens", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps identity out of signed links and rejects tampering", () => {
    vi.stubEnv("AUTH_SECRET", "survey-test-secret");
    const token = __surveyInvitationTesting.createToken(
      "11111111-1111-4111-8111-111111111111",
      new Date(Date.now() + 60_000),
    );
    expect(token).toBeTruthy();
    expect(token).not.toContain("person@example.com");
    expect(__surveyInvitationTesting.verifyToken(token ?? "")).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(__surveyInvitationTesting.verifyToken(`${token}changed`)).toBeNull();
  });

  it("only recognises first-party survey destinations", () => {
    expect(
      __surveyInvitationTesting.surveySlug(
        "https://milkandhenny.com/surveys/after-school-feedback",
        "https://milkandhenny.com",
      ),
    ).toBe("after-school-feedback");
    expect(
      __surveyInvitationTesting.surveySlug(
        "https://example.com/surveys/after-school-feedback",
        "https://milkandhenny.com",
      ),
    ).toBeNull();
  });
});
