import { createFileRoute } from "@tanstack/react-router";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import {
  createScannerLink,
  listScannerLinkDevices,
  listScannerLinks,
  revokeAllScannerLinks,
  revokeScannerLink,
  updateScannerLink,
} from "@/features/tickets/scanner-links.server";
import { SCANNER_PERMISSIONS, type ScannerPermission } from "@/features/tickets/checkpoint-types";

/**
 * Admin scanner-link management for one event.
 *
 * Creating a link is how a helper gets scanning access; revoking it is how
 * that access ends. Creating or changing a link is a step-up protected action;
 * revocation remains available to an authenticated admin for quick shutdown.
 */

async function handleGET(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const [links, devices] = await Promise.all([
      listScannerLinks(slug),
      listScannerLinkDevices(slug),
    ]);
    return Response.json({ links, devices });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.scanner-links",
      "Failed to load scanner links",
      error,
    );
  }
}

async function handlePOST(request: Request, slug: string) {
  const authErr = await requireAdminStepUp(request);
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }
    const record = body as Record<string, unknown>;

    const result = await createScannerLink({
      eventSlug: slug,
      checkpointId:
        typeof record.checkpointId === "string" && record.checkpointId ? record.checkpointId : null,
      label: typeof record.label === "string" ? record.label : "",
      role: record.role === "manager" ? "manager" : "scanner",
      expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : undefined,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ link: result.value });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.scanner-links",
      "Failed to create scanner link",
      error,
    );
  }
}

async function handlePATCH(request: Request, slug: string) {
  const authErr = await requireAdminStepUp(request);
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const token = typeof record.token === "string" ? record.token : "";

    const links = await listScannerLinks(slug);
    if (!links.some((link) => link.token === token)) {
      return Response.json({ error: "Unknown link" }, { status: 404 });
    }

    let permissions: Partial<Record<ScannerPermission, boolean>> | undefined;
    if (record.permissions && typeof record.permissions === "object") {
      permissions = {};
      for (const permission of SCANNER_PERMISSIONS) {
        const value = (record.permissions as Record<string, unknown>)[permission];
        if (typeof value === "boolean") permissions[permission] = value;
      }
    }

    const result = await updateScannerLink(token, {
      role: record.role === "manager" || record.role === "scanner" ? record.role : undefined,
      permissions,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ link: result.value });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.scanner-links",
      "Failed to update scanner link",
      error,
    );
  }
}

async function handleDELETE(request: Request, slug: string) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const body: unknown = await request.json().catch(() => null);
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if (record.all === true) {
      const result = await revokeAllScannerLinks(slug);
      if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ ok: true, revoked: result.value });
    }

    const token = typeof record.token === "string" ? record.token : "";
    const links = await listScannerLinks(slug);
    if (!links.some((link) => link.token === token)) {
      return Response.json({ error: "Unknown link" }, { status: 404 });
    }
    const result = await revokeScannerLink(token);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "events.admin.scanner-links",
      "Failed to revoke scanner link",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/events/$slug/scanner-links")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, params.slug),
      POST: ({ request, params }) => handlePOST(request, params.slug),
      PATCH: ({ request, params }) => handlePATCH(request, params.slug),
      DELETE: ({ request, params }) => handleDELETE(request, params.slug),
    },
  },
});
