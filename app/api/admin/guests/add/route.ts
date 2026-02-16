import { NextRequest, NextResponse } from 'next/server';
import { addGuest } from '@/lib/guests/kv-client';
import { requireAdminStepUp, requireAuth } from '@/lib/auth';
import { GuestStatus } from '@/lib/guests/types';
import { apiError } from '@/lib/api-error';

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const body = await request.json();
    const { name, fullName, status, plusOneOf } = body;

    const result = await addGuest({
      name,
      fullName,
      status: typeof status === 'string' ? (status as GuestStatus) : undefined,
      plusOneOf,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, guest: result.value });
  } catch (error) {
    return apiError('guests.add', 'Failed to add guest', error);
  }
}

