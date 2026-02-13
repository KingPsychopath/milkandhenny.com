import { NextRequest, NextResponse } from 'next/server';
import { getTransfer, deleteTransferData, validateDeleteToken } from '@/lib/transfers';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Get R2 client for server-side cleanup */
function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY;
  const secretKey = process.env.R2_SECRET_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKey || !secretKey || !bucket) {
    return null;
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });

  return { client, bucket };
}

/** Delete all R2 objects under a prefix */
async function deleteR2Prefix(prefix: string) {
  const r2 = getR2Client();
  if (!r2) return 0;

  const { client, bucket } = r2;

  // List all objects under the prefix
  const listed = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })
  );

  const keys = (listed.Contents ?? [])
    .map((o) => o.Key)
    .filter((k): k is string => !!k);

  if (keys.length === 0) return 0;

  // Delete in batches of 1000
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    deleted += batch.length;
  }

  return deleted;
}

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
  const deletedFiles = await deleteR2Prefix(prefix);

  // Delete Redis metadata
  const dataDeleted = await deleteTransferData(id);

  return NextResponse.json({
    success: true,
    deletedFiles,
    dataDeleted,
    message: 'Transfer has been taken down.',
  });
}
