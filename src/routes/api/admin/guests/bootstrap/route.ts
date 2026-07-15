import { createFileRoute } from "@tanstack/react-router";
import { parseCSV } from "@/features/guests/csv-parser";
import { bootstrapGuestsFromCsv } from "@/features/guests/store";
import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

/** Resolve the public origin from proxy-aware request headers. */
function getBaseUrl(request: Request): string {
  return new URL(request.url).origin;
}

/** Fetch and parse guests.csv from the public folder. Returns null if not found. */
async function fetchCsvGuests(request: Request) {
  const base = getBaseUrl(request);
  const res = await fetch(`${base}/guests.csv`);
  if (!res.ok) return null;
  return parseCSV(await res.text());
}

/**
 * Bootstrap — loads guests from public/guests.csv if no guests exist.
 */
async function handlePOST(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const guests = await fetchCsvGuests(request);
    const result = await bootstrapGuestsFromCsv(guests, { force: false });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result.value);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "guests.bootstrap",
      "Bootstrap failed. Check that Redis is reachable and guests.csv is valid.",
      error,
    );
  }
}

/**
 * Force re-bootstrap — clears existing data and reloads from CSV.
 */
async function handleDELETE(request: Request) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const guests = await fetchCsvGuests(request);
    const result = await bootstrapGuestsFromCsv(guests, { force: true });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result.value);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "guests.reset",
      "Reset failed. Check that Redis is reachable and guests.csv is valid.",
      error,
    );
  }
}

export const Route = createFileRoute("/api/admin/guests/bootstrap")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
