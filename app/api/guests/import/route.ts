import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/lib/csv-parser';
import { setGuests } from '@/lib/kv-client';
import { requireManagementAuth } from '@/lib/management-auth';

export async function POST(request: NextRequest) {
  const authError = requireManagementAuth(request);
  if (authError) return authError;

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
    console.error('Error importing CSV:', error);
    return NextResponse.json({ error: 'Failed to import CSV' }, { status: 500 });
  }
}
