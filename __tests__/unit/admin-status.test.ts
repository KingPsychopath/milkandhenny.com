import { describe, expect, it } from "vitest";

import { adminToneForStatus } from "@/features/admin/ui/components/AdminStatus";

describe("adminToneForStatus", () => {
  it.each([
    "active",
    "healthy",
    "provider accepted",
    "confirmed delivered",
    "published",
    "committed",
    "verified",
  ])("treats %s as a positive state", (status) =>
    expect(adminToneForStatus(status)).toBe("positive"),
  );

  it.each([
    "pending",
    "processing",
    "draft",
    "investigating",
    "rate limited",
    "2 warnings",
    "held",
    "invited",
  ])("treats %s as an attention state", (status) =>
    expect(adminToneForStatus(status)).toBe("attention"),
  );

  it.each([
    "failed",
    "3 failures",
    "2 errors",
    "unavailable",
    "invalid",
    "stale",
    "critical",
    "bounced",
  ])("treats %s as a danger state", (status) => expect(adminToneForStatus(status)).toBe("danger"));

  it.each(["disabled", "expired", "revoked", "cancelled", undefined])(
    "keeps %s neutral",
    (status) => expect(adminToneForStatus(status)).toBe("neutral"),
  );
});
