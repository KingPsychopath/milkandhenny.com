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

export interface AdminAuthDiagnosticProbe {
  name: string;
  method: "GET" | "POST";
  path: string;
  ok: boolean;
  status?: number;
  error?: string;
}

export interface AdminAuthDiagnostics {
  baseUrl: string;
  authSource: "password" | "token";
  verify?: {
    ok: boolean;
    status?: number;
    error?: string;
  };
  tokenClaims?: {
    role?: string;
    iat?: number;
    exp?: number;
    tv?: number;
    jti?: string;
  };
  probes: AdminAuthDiagnosticProbe[];
}

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function resolveCanonicalBaseUrl(baseUrl: string): Promise<string> {
  const normalized = normalizeBaseUrl(baseUrl);
  try {
    const res = await fetch(`${normalized}/api/admin/verify`, {
      method: "GET",
      redirect: "follow",
    });
    const finalOrigin = normalizeBaseUrl(new URL(res.url).origin);
    return finalOrigin || normalized;
  } catch {
    return normalized;
  }
}

function decodeJwtClaims(token: string): AdminAuthDiagnostics["tokenClaims"] | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: unknown;
      iat?: unknown;
      exp?: unknown;
      tv?: unknown;
      jti?: unknown;
    };
    return {
      role: typeof payload.role === "string" ? payload.role : undefined,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
      tv: typeof payload.tv === "number" ? payload.tv : undefined,
      jti: typeof payload.jti === "string" ? payload.jti : undefined,
    };
  } catch {
    return undefined;
  }
}

function errorFromBody(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const maybe = (data as { error?: unknown }).error;
  return typeof maybe === "string" && maybe.trim() ? maybe.trim() : undefined;
}

async function runProbe(params: {
  baseUrl: string;
  method: "GET" | "POST";
  path: string;
  adminToken: string;
  body?: Record<string, unknown>;
  name: string;
}): Promise<AdminAuthDiagnosticProbe> {
  try {
    const res = await fetch(`${params.baseUrl}${params.path}`, {
      method: params.method,
      headers: {
        Authorization: `Bearer ${params.adminToken}`,
        ...(params.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(params.body ? { body: JSON.stringify(params.body) } : {}),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    return {
      name: params.name,
      method: params.method,
      path: params.path,
      ok: res.ok,
      status: res.status,
      error: !res.ok ? errorFromBody(data) || `HTTP ${res.status}` : undefined,
    };
  } catch (error) {
    return {
      name: params.name,
      method: params.method,
      path: params.path,
      ok: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

export async function runAdminAuthDiagnostics(params: {
  baseUrl: string;
  adminPassword?: string;
  adminToken?: string;
}): Promise<AdminAuthDiagnostics> {
  const providedToken = params.adminToken?.trim();
  const password = params.adminPassword?.trim();
  let adminToken = providedToken ?? "";

  const diagnostics: AdminAuthDiagnostics = {
    baseUrl: params.baseUrl,
    authSource: providedToken ? "token" : "password",
    probes: [],
  };

  if (!adminToken) {
    try {
      const verifyRes = await fetch(`${params.baseUrl}/api/admin/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await verifyRes.json().catch(() => null)) as unknown;
      const tokenFromVerify =
        data &&
        typeof data === "object" &&
        "token" in data &&
        typeof (data as { token?: unknown }).token === "string"
          ? ((data as { token: string }).token ?? "")
          : "";

      diagnostics.verify = {
        ok: verifyRes.ok && Boolean(tokenFromVerify),
        status: verifyRes.status,
        error:
          verifyRes.ok && tokenFromVerify
            ? undefined
            : errorFromBody(data) || (verifyRes.ok ? "Token missing from verify response" : `HTTP ${verifyRes.status}`),
      };
      adminToken = tokenFromVerify;
    } catch (error) {
      diagnostics.verify = {
        ok: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }

  if (!adminToken) return diagnostics;

  diagnostics.tokenClaims = decodeJwtClaims(adminToken);

  diagnostics.probes.push(
    await runProbe({
      baseUrl: params.baseUrl,
      method: "GET",
      path: "/api/debug",
      adminToken,
      name: "Debug endpoint",
    })
  );

  diagnostics.probes.push(
    await runProbe({
      baseUrl: params.baseUrl,
      method: "GET",
      path: "/api/admin/tokens/sessions",
      adminToken,
      name: "List token sessions",
    })
  );

  if (password) {
    diagnostics.probes.push(
      await runProbe({
        baseUrl: params.baseUrl,
        method: "POST",
        path: "/api/admin/step-up",
        adminToken,
        body: { password },
        name: "Create step-up token",
      })
    );
  }

  return diagnostics;
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
