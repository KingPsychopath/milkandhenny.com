import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { __authorizationTesting } from "@/features/auth/internal/authorization.server";

/**
 * Named-admin authorization maps API paths to required permissions by
 * substring, which works only while every admin route actually matches the
 * rule its author expected. This walks the real route tree so that adding an
 * admin route without deciding its permission fails loudly here instead of
 * silently landing on the fallback.
 */

const ADMIN_ROUTES_ROOT = path.resolve(__dirname, "../../src/routes/api/admin");

function collectRouteDirs(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectRouteDirs(full, out);
    else if (entry === "route.ts") out.push(dir);
  }
  return out;
}

function routePathFor(dir: string): string {
  const relative = dir.slice(path.resolve(__dirname, "../../src/routes").length);
  return relative.replace(/\$([A-Za-z]+)/g, "sample-$1");
}

async function permissionFor(routePath: string, method: "GET" | "POST") {
  const request = new Request(`https://milkandhenny.com${routePath}`, {
    method,
    ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}),
  });
  return __authorizationTesting.requiredNamedAdminPermission(request, "admin");
}

/** Every admin route, with the permission a named admin needs for GET / write. */
const EXPECTED: Record<string, { GET: string | null; POST: string | null }> = {
  "/api/admin/albums": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/albums/sample-slug": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/albums/sample-slug/cover": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/albums/sample-slug/order": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/albums/sample-slug/photos": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/albums/sample-slug/photos/sample-photoId": {
    GET: "manageContent",
    POST: "manageContent",
  },
  "/api/admin/albums/sample-slug/photos/sample-photoId/media": {
    GET: "manageContent",
    POST: "manageContent",
  },
  "/api/admin/albums/sample-slug/upload/finalize": {
    GET: "manageContent",
    POST: "manageContent",
  },
  "/api/admin/albums/sample-slug/upload/presign": {
    GET: "manageContent",
    POST: "manageContent",
  },
  "/api/admin/cli-auth/exchange": {
    GET: "manageGlobalSettings",
    POST: "manageGlobalSettings",
  },
  "/api/admin/cli-auth/request": {
    GET: "manageGlobalSettings",
    POST: "manageGlobalSettings",
  },
  "/api/admin/communications": { GET: "manageCommunications", POST: "manageCommunications" },
  "/api/admin/communications/sample-id": {
    GET: "manageCommunications",
    POST: "manageCommunications",
  },
  "/api/admin/content-audit": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/content-summary": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/credits": { GET: "manageCommunications", POST: "manageCommunications" },
  "/api/admin/email": { GET: "manageCommunications", POST: "manageCommunications" },
  "/api/admin/events": { GET: "viewOperations", POST: "manageEvents" },
  "/api/admin/events/sample-slug": { GET: "viewOperations", POST: "manageEvents" },
  "/api/admin/events/sample-slug/checkpoints": { GET: "viewOperations", POST: "manageEvents" },
  "/api/admin/events/sample-slug/drop": { GET: "viewOperations", POST: "manageEvents" },
  "/api/admin/events/sample-slug/email": {
    GET: "manageCommunications",
    POST: "manageCommunications",
  },
  "/api/admin/events/sample-slug/guest-requests": {
    GET: "viewOperations",
    POST: "manageEvents",
  },
  "/api/admin/events/sample-slug/scanner-links": {
    GET: "viewOperations",
    POST: "manageEvents",
  },
  "/api/admin/events/sample-slug/scoring": { GET: "manageScoring", POST: "manageScoring" },
  "/api/admin/events/sample-slug/staff-access": { GET: "viewOperations", POST: "manageEvents" },
  "/api/admin/events/sample-slug/tickets": { GET: "viewOperations", POST: "manageTickets" },
  "/api/admin/events/sample-slug/waitlist": { GET: "viewOperations", POST: "manageEvents" },
  "/api/admin/game-pools": { GET: "manageScoring", POST: "manageScoring" },
  "/api/admin/game-pools/sample-id": { GET: "manageScoring", POST: "manageScoring" },
  "/api/admin/hot-and-cold-review": { GET: "manageScoring", POST: "manageScoring" },
  "/api/admin/operations/access": {
    GET: "manageGlobalSettings",
    POST: "manageGlobalSettings",
  },
  "/api/admin/operations/alerts": {
    GET: "manageGlobalSettings",
    POST: "manageGlobalSettings",
  },
  "/api/admin/operations/inbox": { GET: "viewOperations", POST: "viewOperations" },
  "/api/admin/operations/people": { GET: "managePeople", POST: "managePeople" },
  "/api/admin/operations/settings": {
    GET: "manageGlobalSettings",
    POST: "manageGlobalSettings",
  },
  "/api/admin/pitches": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/reports": { GET: "viewAudit", POST: "viewAudit" },
  "/api/admin/step-up": { GET: null, POST: null },
  "/api/admin/surveys": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/surveys/sample-id": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/polls": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/polls/sample-id": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/tokens/revoke": { GET: "manageGlobalSettings", POST: "manageGlobalSettings" },
  "/api/admin/tokens/sessions": { GET: "manageGlobalSettings", POST: "manageGlobalSettings" },
  "/api/admin/tokens/sessions/sample-jti": {
    GET: "manageGlobalSettings",
    POST: "manageGlobalSettings",
  },
  "/api/admin/transfers": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/transfers/sample-id": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/transfers/sample-id/files/sample-fileId": {
    GET: "manageContent",
    POST: "manageContent",
  },
  "/api/admin/transfers/cleanup": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/transfers/nuke": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/transfers/process-media": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/upload-access": { GET: "manageGlobalSettings", POST: "manageGlobalSettings" },
  "/api/admin/verify": { GET: null, POST: null },
  "/api/admin/word-media": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/word-media/orphans": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/word-shares": { GET: "manageContent", POST: "manageContent" },
  "/api/admin/word-shares/cleanup": { GET: "manageContent", POST: "manageContent" },
};

describe("named-admin route permissions", () => {
  it("covers every admin route on disk", () => {
    const onDisk = collectRouteDirs(ADMIN_ROUTES_ROOT, []).map(routePathFor).sort();
    expect(onDisk).toEqual(Object.keys(EXPECTED).sort());
  });

  it("maps each route to the intended permission", async () => {
    const actual: Record<string, { GET: string | null; POST: string | null }> = {};
    for (const routePath of Object.keys(EXPECTED)) {
      actual[routePath] = {
        GET: await permissionFor(routePath, "GET"),
        POST: await permissionFor(routePath, "POST"),
      };
    }
    expect(actual).toEqual(EXPECTED);
  });

  it("requires the refund permission for refund actions on ticket routes", async () => {
    const request = new Request("https://milkandhenny.com/api/admin/events/sample-slug/tickets", {
      method: "POST",
      body: JSON.stringify({ action: "refund" }),
      headers: { "content-type": "application/json" },
    });
    expect(await __authorizationTesting.requiredNamedAdminPermission(request, "admin")).toBe(
      "executeRefunds",
    );
  });

  it("routes upload-role requests to content management", async () => {
    const request = new Request("https://milkandhenny.com/api/upload/transfer/presign", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });
    expect(await __authorizationTesting.requiredNamedAdminPermission(request, "upload")).toBe(
      "manageContent",
    );
  });
});
