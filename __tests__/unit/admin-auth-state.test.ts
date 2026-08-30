import { describe, expect, it } from "vitest";

import { adminSignInMessage, parseAdminSignInState } from "@/features/admin/ui/admin-auth-state";

describe("admin sign-in state", () => {
  it("keeps only known redirect states", () => {
    expect(parseAdminSignInState("failed")).toBe("failed");
    expect(parseAdminSignInState("dev-unavailable")).toBe("dev-unavailable");
    expect(parseAdminSignInState("unexpected")).toBeUndefined();
    expect(parseAdminSignInState(["failed"])).toBeUndefined();
  });

  it("turns failed sign-ins into actionable messages", () => {
    expect(adminSignInMessage("failed")).toBe("That admin password was not accepted.");
    expect(adminSignInMessage("dev-unavailable")).toBe(
      "Local developer sign-in is not available here.",
    );
    expect(adminSignInMessage(undefined)).toBeNull();
  });
});
