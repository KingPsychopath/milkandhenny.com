export const ADMIN_SIGN_IN_STATES = ["failed", "dev-unavailable"] as const;
export type AdminSignInState = (typeof ADMIN_SIGN_IN_STATES)[number];

export function parseAdminSignInState(value: unknown): AdminSignInState | undefined {
  return ADMIN_SIGN_IN_STATES.find((state) => state === value);
}

export function adminSignInMessage(state: AdminSignInState | undefined): string | null {
  if (state === "failed") return "That admin password was not accepted.";
  if (state === "dev-unavailable") return "Local developer sign-in is not available here.";
  return null;
}
