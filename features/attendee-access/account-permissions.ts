export const ACCOUNT_PERMISSIONS = ["create_transfers"] as const;

export type AccountPermission = (typeof ACCOUNT_PERMISSIONS)[number];

export function isAccountPermission(value: unknown): value is AccountPermission {
  return typeof value === "string" && ACCOUNT_PERMISSIONS.includes(value as AccountPermission);
}
