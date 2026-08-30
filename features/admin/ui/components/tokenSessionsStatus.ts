import type { AdminStatusTone } from "./AdminStatus";

export const TOKEN_SESSION_STATUS = {
  active: { label: "usable", tone: "positive" },
  revoked: { label: "revoked", tone: "neutral" },
  invalidated: { label: "signed out", tone: "neutral" },
  expired: { label: "expired", tone: "neutral" },
} as const satisfies Record<string, { label: string; tone: AdminStatusTone }>;

export type TokenSessionStatusKey = keyof typeof TOKEN_SESSION_STATUS;
