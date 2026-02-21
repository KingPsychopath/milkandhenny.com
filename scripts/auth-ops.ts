export type RevokeRole = "admin" | "staff" | "upload" | "all";
export const REVOKE_ROLES: readonly RevokeRole[] = ["admin", "staff", "upload", "all"];

export type TokenSession = {
  jti: string;
  role: "admin" | "staff" | "upload";
  iat: number;
  exp: number;
  tv: number;
  ip?: string;
  ua?: string;
  status: "active" | "expired" | "revoked" | "invalidated";
};

export type TokenSessionsListResponse =
  | {
      success: true;
      count: number;
      sessions: TokenSession[];
      now: number;
      currentTv: { admin: number; staff: number; upload: number };
    }
  | { error?: string };

export type StepUpResponse = { ok: true; token: string; expiresInSeconds: number } | { error?: string };

export type RevokeResponse =
  | {
      success: true;
      revoked: Array<{ role: string; tokenVersion: number }>;
      timestamp: string;
    }
  | { error?: string };

export type AdminVerifyResponse = { ok: true; token: string } | { error?: string };

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function issueAdminToken(params: { baseUrl: string; adminPassword: string }): Promise<string> {
  const res = await fetch(`${params.baseUrl}/api/admin/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: params.adminPassword }),
  });
  const data = (await res.json().catch(() => ({}))) as AdminVerifyResponse;
  if (!res.ok || !("ok" in data) || data.ok !== true || typeof data.token !== "string") {
    throw new Error((data as { error?: string }).error || `Admin verify failed (${res.status})`);
  }
  return data.token;
}

export async function listTokenSessions(params: { baseUrl: string; adminToken: string }) {
  const res = await fetch(`${params.baseUrl}/api/admin/tokens/sessions`, {
    method: "GET",
    headers: { Authorization: `Bearer ${params.adminToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as TokenSessionsListResponse;
  if (!res.ok || !("success" in data)) {
    throw new Error((data as { error?: string }).error || `List failed (${res.status})`);
  }
  return data;
}

export async function createStepUpToken(params: {
  baseUrl: string;
  adminToken: string;
  adminPassword: string;
}) {
  const res = await fetch(`${params.baseUrl}/api/admin/step-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.adminToken}`,
    },
    body: JSON.stringify({ password: params.adminPassword }),
  });
  const data = (await res.json().catch(() => ({}))) as StepUpResponse;
  if (!res.ok || !("ok" in data) || data.ok !== true) {
    throw new Error((data as { error?: string }).error || `Step-up failed (${res.status})`);
  }
  return data;
}

export async function revokeRoleSessions(params: {
  baseUrl: string;
  adminToken: string;
  stepUpToken: string;
  role: RevokeRole;
}) {
  const res = await fetch(`${params.baseUrl}/api/admin/tokens/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.adminToken}`,
      "x-admin-step-up": params.stepUpToken,
    },
    body: JSON.stringify({ role: params.role }),
  });
  const data = (await res.json().catch(() => ({}))) as RevokeResponse;
  if (!res.ok || !("success" in data) || data.success !== true) {
    throw new Error((data as { error?: string }).error || `Revoke failed (${res.status})`);
  }
  return data;
}
