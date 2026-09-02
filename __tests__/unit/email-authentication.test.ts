import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hasTotp: false,
  authenticated: vi.fn(),
  pending: vi.fn(),
}));

vi.mock("@/features/attendee-access/session.server", () => ({
  authenticateAttendeeSession: state.authenticated,
  beginAttendeeMfaSession: state.pending,
}));

vi.mock("@/features/attendee-access/totp.server", () => ({
  personHasTotp: async () => state.hasTotp,
}));

import { establishEmailAuthenticatedSession } from "@/features/attendee-access/email-authentication.server";

beforeEach(() => {
  state.hasTotp = false;
  state.authenticated.mockReset();
  state.pending.mockReset();
});

it("keeps action-link email authentication pending when TOTP is enabled", async () => {
  state.hasTotp = true;

  await expect(
    establishEmailAuthenticatedSession({
      personId: "person_1",
      verifiedEmailHash: "a".repeat(64),
      returnTo: "/ticket/public-ticket",
    }),
  ).resolves.toEqual({ destination: "/access/mfa", mfaRequired: true });
  expect(state.pending).toHaveBeenCalledWith({
    personId: "person_1",
    verifiedEmailHash: "a".repeat(64),
    returnTo: "/ticket/public-ticket",
  });
  expect(state.authenticated).not.toHaveBeenCalled();
});
