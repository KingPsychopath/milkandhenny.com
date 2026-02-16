import { NextRequest, NextResponse } from 'next/server';
import { removeGuest } from '@/lib/guests/kv-client';
import { requireAdminStepUp, requireAuth } from '@/lib/auth';
import { apiError } from '@/lib/api-error';

export async function DELETE(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    const result = await removeGuest(id ?? '');
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return apiError('guests.remove', 'Failed to remove guest', error);
  }
}

