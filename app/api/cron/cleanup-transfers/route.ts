import { NextRequest, NextResponse } from "next/server";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getRedis } from "@/lib/redis";

/**
 * Daily cron job: deletes orphaned R2 objects for expired transfers.
 *
 * How it works:
 * 1. Lists all transfer prefixes in R2 (transfers/{id}/)
 * 2. Checks Redis for each — if the key is gone (TTL expired), delete R2 objects
 * 3. Cleans up the transfer:index SET
 *
 * Cost: 1 Vercel invocation/day + a few Redis reads + R2 list/delete ops.
 * Vercel Hobby plan: 2 cron jobs allowed, daily minimum frequency.
 */
export const dynamic = "force-dynamic";

/** Vercel sends CRON_SECRET in Authorization: Bearer header. Set in Vercel env vars. */
const CRON_SECRET = process.env.CRON_SECRET;

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY;
  const secretKey = process.env.R2_SECRET_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKey || !secretKey || !bucket) return null;
  return {
    client: new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    }),
    bucket,
  };
}

export async function GET(request: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json(
      {
        error: "CRON_SECRET not configured",
        help: "Set CRON_SECRET in Vercel Environment Variables. Generate with: openssl rand -hex 32. Without it, cron jobs are unauthenticated.",
      },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const redis = getRedis();
  const r2 = getR2Client();

  if (!redis || !r2) {
    return NextResponse.json({
      skipped: true,
      reason: "Redis or R2 not configured",
    });
  }

  const { client, bucket } = r2;

  // Get all transfer IDs from the index
  const indexedIds: string[] = await redis.smembers("transfer:index");

  // Check which ones are still alive in Redis
  let expiredIds: string[] = [];
  if (indexedIds.length > 0) {
    const pipeline = redis.pipeline();
    for (const id of indexedIds) {
      pipeline.exists(`transfer:${id}`);
    }
    const results = await pipeline.exec();
    expiredIds = indexedIds.filter((_, i) => results[i] === 0);
  }

  // Clean up index for expired entries
  if (expiredIds.length > 0) {
    const cleanupPipeline = redis.pipeline();
    for (const id of expiredIds) {
      cleanupPipeline.srem("transfer:index", id);
    }
    await cleanupPipeline.exec();
  }

  // Also scan R2 for any orphaned transfer prefixes not in the index
  let deletedObjects = 0;
  const allR2Ids = new Set<string>();

  let continuationToken: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "transfers/",
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    );

    for (const prefix of listed.CommonPrefixes ?? []) {
      if (prefix.Prefix) {
        // Extract transfer ID from "transfers/{id}/"
        const id = prefix.Prefix.replace("transfers/", "").replace("/", "");
        if (id) allR2Ids.add(id);
      }
    }

    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);

  // For each R2 transfer prefix, check if it's still alive in Redis
  for (const id of allR2Ids) {
    const exists = await redis.exists(`transfer:${id}`);
    if (exists) continue;

    // Transfer expired — delete all R2 objects under this prefix
    let objectContinuation: string | undefined;
    const keysToDelete: string[] = [];

    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `transfers/${id}/`,
          ContinuationToken: objectContinuation,
        })
      );

      for (const obj of listed.Contents ?? []) {
        if (obj.Key) keysToDelete.push(obj.Key);
      }
      objectContinuation = listed.NextContinuationToken;
    } while (objectContinuation);

    // Delete in batches of 1000
    for (let i = 0; i < keysToDelete.length; i += 1000) {
      const batch = keysToDelete.slice(i, i + 1000);
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        })
      );
      deletedObjects += batch.length;
    }

    // Remove from index (belt + suspenders)
    await redis.srem("transfer:index", id);
  }

  return NextResponse.json({
    success: true,
    expiredIndexEntries: expiredIds.length,
    orphanedR2Prefixes: [...allR2Ids].filter(
      (id) => !indexedIds.includes(id) || expiredIds.includes(id)
    ).length,
    deletedObjects,
    timestamp: new Date().toISOString(),
  });
}
