import { describe, expect, it } from "vitest";

import {
  ATTENDEE_CAPABILITIES,
  DEFAULT_GLOBAL_AVAILABILITY,
  DEFAULT_NEW_EVENT_CAPABILITIES,
  effectiveCapability,
  isTerminalTicketTransfer,
  permissionsForGlobalRole,
  type CapabilityMap,
} from "@/features/attendee-operations/types";

describe("attendee operation capabilities", () => {
  it("keeps transfers off at both global and new-event boundaries", () => {
    expect(DEFAULT_GLOBAL_AVAILABILITY.transfers).toBe(false);
    expect(DEFAULT_NEW_EVENT_CAPABILITIES.transfers).toBe(false);
  });

  it("requires global, event, emergency, and time-window permission", () => {
    const global = {
      globalAvailability: { ...DEFAULT_GLOBAL_AVAILABILITY, transfers: true },
      emergencyPaused: DEFAULT_NEW_EVENT_CAPABILITIES,
    };
    const event = {
      capabilities: { ...DEFAULT_NEW_EVENT_CAPABILITIES, transfers: true },
      transferOpensAt: "2026-08-25T10:00:00.000Z",
      transferClosesAt: "2026-08-25T12:00:00.000Z",
    };

    expect(effectiveCapability(global, event, "transfers", Date.parse("2026-08-25T11:00Z"))).toBe(
      true,
    );
    expect(effectiveCapability(global, event, "transfers", Date.parse("2026-08-25T13:00Z"))).toBe(
      false,
    );
    expect(
      effectiveCapability(
        {
          ...global,
          emergencyPaused: { ...DEFAULT_NEW_EVENT_CAPABILITIES, transfers: true },
        },
        event,
        "transfers",
        Date.parse("2026-08-25T11:00Z"),
      ),
    ).toBe(false);
  });

  it("lets the emergency pause stop every capability without changing event policy", () => {
    const enabled = Object.fromEntries(
      ATTENDEE_CAPABILITIES.map((capability) => [capability, true]),
    ) as CapabilityMap;
    for (const capability of ATTENDEE_CAPABILITIES) {
      expect(
        effectiveCapability(
          {
            globalAvailability: enabled,
            emergencyPaused: { ...DEFAULT_NEW_EVENT_CAPABILITIES, [capability]: true },
          },
          { capabilities: enabled },
          capability,
        ),
      ).toBe(false);
    }
  });
});

describe("attendee operation authority", () => {
  it("keeps finance and scanner-style authority separate", () => {
    const finance = permissionsForGlobalRole("finance");
    const support = permissionsForGlobalRole("support");

    expect(finance.executeRefunds).toBe(true);
    expect(finance.manageGlobalSettings).toBe(false);
    expect(support.executeRefunds).toBe(false);
    expect(support.managePeople).toBe(true);
  });

  it("allows explicit grant overrides without changing the preset", () => {
    expect(permissionsForGlobalRole("auditor", { viewSensitiveData: true })).toMatchObject({
      viewAudit: true,
      executeRefunds: false,
      viewSensitiveData: true,
    });
  });

  it("treats every transfer state except pending as terminal", () => {
    expect(isTerminalTicketTransfer("pending")).toBe(false);
    for (const state of ["accepted", "declined", "cancelled", "expired", "invalidated"] as const) {
      expect(isTerminalTicketTransfer(state)).toBe(true);
    }
  });
});
