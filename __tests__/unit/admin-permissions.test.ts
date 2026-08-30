import { describe, expect, it } from "vitest";

import {
  canAccessAdminDestination,
  canAccessAdminSection,
  canAccessOperationsTab,
  firstAccessibleAdminSection,
} from "@/features/admin/ui/admin-permissions";
import { permissionsForGlobalRole } from "@/features/attendee-operations/types";

describe("admin workspace permissions", () => {
  it("shows content administrators only content-owned destinations", () => {
    const permissions = permissionsForGlobalRole("content");

    expect(canAccessAdminSection("content", permissions)).toBe(true);
    expect(canAccessAdminSection("transfers", permissions)).toBe(true);
    expect(canAccessAdminSection("events", permissions)).toBe(true);
    expect(canAccessAdminSection("communications", permissions)).toBe(false);
    expect(canAccessAdminSection("settings", permissions)).toBe(false);
    expect(firstAccessibleAdminSection(["overview", "content"], permissions)).toBe("content");
  });

  it("keeps identity navigation separate from inbox and preview access", () => {
    const communications = permissionsForGlobalRole("communications");
    const support = permissionsForGlobalRole("support");

    expect(canAccessOperationsTab("inbox", communications)).toBe(true);
    expect(canAccessOperationsTab("preview", communications)).toBe(true);
    expect(canAccessOperationsTab("people", communications)).toBe(false);
    expect(
      canAccessAdminDestination({ section: "operations", operationsTab: "people" }, communications),
    ).toBe(false);
    expect(
      canAccessAdminDestination({ section: "operations", operationsTab: "people" }, support),
    ).toBe(true);
  });

  it("does not expose owner-only settings to ordinary administrators", () => {
    expect(canAccessAdminSection("settings", permissionsForGlobalRole("admin"))).toBe(false);
    expect(canAccessAdminSection("settings", permissionsForGlobalRole("owner"))).toBe(true);
  });
});
