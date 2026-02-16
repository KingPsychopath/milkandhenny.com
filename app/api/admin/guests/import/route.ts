import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/features/guests/csv-parser';
import { setGuests } from '@/features/guests/store';
import { requireAdminStepUp, requireAuth } from '@/features/auth/server';
import { apiErrorFromRequest } from '@/lib/platform/api-error';

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const content = await file.text();
    const guests = parseCSV(content);
    await setGuests(guests);

    return NextResponse.json({ success: true, count: guests.length });
  } catch (error) {
    return apiErrorFromRequest(request, 'guests.import', 'Failed to import CSV', error);
  }
}

