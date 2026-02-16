import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { parseCSV } from '@/features/guests/csv-parser';
import { bootstrapGuestsFromCsv } from '@/features/guests/store';
import { requireAdminStepUp, requireAuth } from '@/features/auth/server';
import { apiErrorFromRequest } from '@/lib/platform/api-error';

/** Resolve the origin from request headers (works on Vercel). */
async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || 'http';
  return `${proto}://${host}`;
}

/** Fetch and parse guests.csv from the public folder. Returns null if not found. */
async function fetchCsvGuests() {
  const base = await getBaseUrl();
  const res = await fetch(`${base}/guests.csv`);
  if (!res.ok) return null;
  return parseCSV(await res.text());
}

/**
 * Bootstrap — loads guests from public/guests.csv if no guests exist.
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const guests = await fetchCsvGuests();
    const result = await bootstrapGuestsFromCsv(guests, { force: false });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.value);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      'guests.bootstrap',
      'Bootstrap failed. Check that Redis is reachable and guests.csv is valid.',
      error
    );
  }
}

/**
 * Force re-bootstrap — clears existing data and reloads from CSV.
 */
export async function DELETE(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const guests = await fetchCsvGuests();
    const result = await bootstrapGuestsFromCsv(guests, { force: true });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.value);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      'guests.reset',
      'Reset failed. Check that Redis is reachable and guests.csv is valid.',
      error
    );
  }
}

