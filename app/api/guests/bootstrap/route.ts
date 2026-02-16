import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { parseCSV } from '@/lib/guests/csv-parser';
import { getGuests, setGuests } from '@/lib/guests/kv-client';
import { requireAdminStepUp, requireAuth } from '@/lib/auth';
import { apiError } from '@/lib/api-error';

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
    const existing = await getGuests();
    if (existing.length > 0) {
      return NextResponse.json({
        bootstrapped: false,
        message: 'Guests already exist',
        count: existing.length,
      });
    }

    const guests = await fetchCsvGuests();
    if (!guests) {
      return NextResponse.json({
        bootstrapped: false,
        message: 'No guests.csv found in public folder',
        count: 0,
      });
    }

    await setGuests(guests);
    return NextResponse.json({
      bootstrapped: true,
      message: 'Loaded guests from CSV',
      count: guests.length,
    });
  } catch (error) {
    return apiError('guests.bootstrap', 'Bootstrap failed. Check that Redis is reachable and guests.csv is valid.', error);
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
    await setGuests([]);

    const guests = await fetchCsvGuests();
    if (!guests) {
      return NextResponse.json({
        reset: true,
        bootstrapped: false,
        message: 'Cleared data but no guests.csv found',
        count: 0,
      });
    }

    await setGuests(guests);
    return NextResponse.json({
      reset: true,
      bootstrapped: true,
      message: 'Cleared and reloaded from CSV',
      count: guests.length,
    });
  } catch (error) {
    return apiError('guests.reset', 'Reset failed. Check that Redis is reachable and guests.csv is valid.', error);
  }
}
