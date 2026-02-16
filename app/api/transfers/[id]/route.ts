import { NextRequest, NextResponse } from 'next/server';
import { getTransfer, deleteTransferData, validateDeleteToken } from '@/lib/transfers/store';
import { deleteObjects, isConfigured, listObjects } from '@/lib/platform/r2';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/transfers/[id]
 *
 * Returns transfer metadata (without delete token) for the share page.
 * Keeps the delete token server-side — never exposed to the public.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const transfer = await getTransfer(id);
  if (!transfer) {
    return NextResponse.json(
      { error: 'Transfer not found or expired' },
      { status: 404 }
    );
  }

  const remainingSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000
  );

  if (remainingSeconds <= 0) {
    return NextResponse.json(
      { error: 'Transfer has expired' },
      { status: 410 }
    );
  }

  // Return public data — no deleteToken
  return NextResponse.json({
    id: transfer.id,
    title: transfer.title,
    files: transfer.files,
    createdAt: transfer.createdAt,
    expiresAt: transfer.expiresAt,
    remainingSeconds,
  });
}

/**
 * DELETE /api/transfers/[id]
 *
 * Takes down a transfer. Requires valid delete token in the request body.
 * Deletes both the R2 objects and the Redis metadata.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  let token: string | null = null;
  try {
    const body = await request.json();
    token = body?.token ?? null;
  } catch {
    return NextResponse.json(
      { error: 'Request body must include { token: string }' },
      { status: 400 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: 'Delete token is required' },
      { status: 400 }
    );
  }

  // Validate the token
  const valid = await validateDeleteToken(id, token);
  if (!valid) {
    return NextResponse.json(
      { error: 'Invalid delete token or transfer not found' },
      { status: 403 }
    );
  }

  // Delete R2 objects
  const prefix = `transfers/${id}/`;
  let deletedFiles = 0;
  if (isConfigured()) {
    const objects = await listObjects(prefix);
    const keys = objects.map((o) => o.key).filter((k) => k && k.startsWith(prefix));
    deletedFiles = await deleteObjects(keys);
  }

  // Delete Redis metadata
  const dataDeleted = await deleteTransferData(id);

  return NextResponse.json({
    success: true,
    deletedFiles,
    dataDeleted,
    message: 'Transfer has been taken down.',
  });
}
