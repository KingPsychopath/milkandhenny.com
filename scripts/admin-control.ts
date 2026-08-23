/**
 * Small HTTP client for the deployed admin API.
 *
 * The CLI deliberately talks to the same validated routes as the admin panel.
 * It does not expose arbitrary SQL, because SQL would bypass the product rules
 * around tickets, refunds, capacity, and authentication.
 */

export type AdminHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type AdminRequestOptions = {
  baseUrl: string;
  adminToken: string;
  method: AdminHttpMethod;
  path: string;
  body?: unknown;
  stepUpToken?: string;
};

export function normaliseControlPath(path: string, method: AdminHttpMethod): string {
  const value = path.trim();
  if (/[\r\n]/.test(value) || value.includes("..")) {
    throw new Error("Control API path contains an unsafe sequence");
  }

  const isAdminRoute = value.startsWith("/api/admin/") || value === "/api/admin";
  const readOnlyRoute = value === "/api/debug" || value === "/api/health";
  const bestDressedRoute =
    value === "/api/best-dressed" ||
    value === "/api/best-dressed/voting/open" ||
    value === "/api/best-dressed/codes/mint-batch" ||
    value === "/api/best-dressed/codes/revoke-all";

  if (!isAdminRoute && !readOnlyRoute && !bestDressedRoute) {
    throw new Error(
      "Control API paths must be /api/admin/*, a read-only /api/debug or /api/health route, or a supported best-dressed admin route.",
    );
  }

  if (readOnlyRoute && method !== "GET") {
    throw new Error(`${method} is not allowed for ${value}.`);
  }
  if (bestDressedRoute && value === "/api/best-dressed" && method === "POST") {
    throw new Error("POST /api/best-dressed is the public voting endpoint, not an admin control.");
  }
  return value;
}

function responseError(data: unknown, status: number): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.trim();
  }
  return `HTTP ${status}`;
}

export async function requestAdminApi(options: AdminRequestOptions): Promise<unknown> {
  const path = normaliseControlPath(options.path, options.method);
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const url = new URL(path, `${baseUrl}/`);
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.adminToken}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.stepUpToken ? { "x-admin-step-up": options.stepUpToken } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(`${options.method} ${path} failed: ${responseError(data, response.status)}`);
  }

  return data;
}
