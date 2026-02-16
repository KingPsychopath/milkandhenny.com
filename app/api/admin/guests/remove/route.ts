import { NextRequest, NextResponse } from 'next/server';
import { removeGuest } from '@/features/guests/store';
import { requireAdminStepUp, requireAuth } from '@/features/auth/server';
import { apiErrorFromRequest } from '@/lib/platform/api-error';

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
    return apiErrorFromRequest(request, 'guests.remove', 'Failed to remove guest', error);
  }
}

