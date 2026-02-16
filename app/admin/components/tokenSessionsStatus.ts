export const TOKEN_SESSION_STATUS = {
  active: { label: "usable", dotClass: "bg-[var(--foreground)]" },
  revoked: { label: "revoked", dotClass: "bg-[var(--prose-hashtag)]" },
  invalidated: { label: "signed out", dotClass: "bg-[var(--stone-400)]" },
  expired: { label: "expired", dotClass: "bg-[var(--stone-400)]" },
} as const;

export type TokenSessionStatusKey = keyof typeof TOKEN_SESSION_STATUS;

