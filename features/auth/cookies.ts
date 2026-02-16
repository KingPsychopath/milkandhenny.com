import "server-only";

export const AUTH_COOKIES = {
  staff: "mah-auth-staff",
  admin: "mah-auth-admin",
  upload: "mah-auth-upload",
} as const;

export type AuthCookieRole = keyof typeof AUTH_COOKIES;

export function getAuthCookieName(role: AuthCookieRole): string {
  return AUTH_COOKIES[role];
}

export function getAuthCookieMaxAgeSeconds(role: AuthCookieRole): number {
  // Keep in sync with TOKEN_EXPIRY_SECONDS_BY_ROLE in `features/auth/server.ts`.
  if (role === "staff") return 24 * 60 * 60;
  if (role === "admin") return 60 * 60;
  return 12 * 60 * 60; // upload
}
