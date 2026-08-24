import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authenticateRequest } from "./auth.server";
import {
  approveCliAuthorization,
  denyCliAuthorization,
  getCliAuthorizationRequest,
} from "./cli-auth.server";
import { verifyAndSetAdminCookieForCli } from "./cli-auth-cookie.server";

function requestIdFromForm(input: unknown): { requestId: string } {
  if (!(input instanceof FormData)) throw new Error("Expected form data");
  return { requestId: input.get("request")?.toString() ?? "" };
}

export const getCliAuthPage = createServerFn({ method: "GET" })
  .validator((data: { requestId: string }) => data)
  .handler(async ({ data }) => {
    const request = await getCliAuthorizationRequest(data.requestId);
    if (!request) return { valid: false as const, authenticated: false as const };
    const auth = await authenticateRequest(getRequest(), "admin");
    return {
      valid: true as const,
      authenticated: auth.ok,
      client: "Milk & Henny CLI",
      expiresAt: request.createdAt + 5 * 60,
    };
  });

export const signInAdminForCli = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    if (!(input instanceof FormData)) throw new Error("Expected form data");
    return {
      requestId: input.get("request")?.toString() ?? "",
      password: input.get("password")?.toString() ?? "",
    };
  })
  .handler(async ({ data }) => {
    const ok = await verifyAndSetAdminCookieForCli(data.password);
    const suffix = ok ? "" : "&auth=failed";
    throw redirect({
      href: `/admin/cli-auth?request=${encodeURIComponent(data.requestId)}${suffix}`,
    });
  });

export const approveCliAuth = createServerFn({ method: "POST" })
  .validator(requestIdFromForm)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) {
      throw redirect({
        href: `/admin/cli-auth?request=${encodeURIComponent(data.requestId)}&auth=required`,
      });
    }
    const result = await approveCliAuthorization(data.requestId);
    throw redirect({
      href:
        result?.redirectUri ??
        `/admin/cli-auth?request=${encodeURIComponent(data.requestId)}&auth=expired`,
    });
  });

export const denyCliAuth = createServerFn({ method: "POST" })
  .validator(requestIdFromForm)
  .handler(async ({ data }) => {
    const result = await denyCliAuthorization(data.requestId);
    throw redirect({
      href:
        result?.redirectUri ??
        `/admin/cli-auth?request=${encodeURIComponent(data.requestId)}&auth=expired`,
    });
  });
