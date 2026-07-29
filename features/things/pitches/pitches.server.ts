import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import {
  createPitchAssetUpload,
  deleteAllPitchAssets,
  finalisePitchAsset,
  signedPitchAsset,
  signedPitchAssets,
} from "./assets.server";
import { getPitchMaxSlides } from "./config.server";
import { sendPitchRecoveryEmail } from "./email.server";
import {
  addPitchAccessTokens,
  createPitchDeck,
  createPitchOwnerToken,
  hardDeletePitchDeck,
  listPitchDecksForRecovery,
  listPublicPitchDecks,
  markExpiredPitchDecksDeleting,
  publishPitchDeck,
  readOwnedPitchDeck,
  readPublicPitchDeck,
  removePitchAccessTokens,
  syncPitchDeck,
  type PitchStoreResult,
  type StoredPitchDeck,
} from "./store.server";
import type {
  OwnedPitchDeck,
  PitchAssetKind,
  PitchDocument,
  PublicPitchDeck,
  PublicPitchDeckDetail,
} from "./types";

async function ownerView(deck: StoredPitchDeck): Promise<OwnedPitchDeck> {
  return {
    id: deck.id,
    title: deck.title,
    ownerName: deck.ownerName,
    ownerEmail: deck.ownerEmail,
    lifecycle: deck.lifecycle,
    document: deck.draftDocument,
    version: deck.draftVersion,
    publishedVersion: deck.publishedVersion,
    publishedAt: deck.publishedAt,
    updatedAt: deck.updatedAt,
    draftExpiresAt: deck.draftExpiresAt,
    thumbnailAssetId: deck.thumbnailAssetId,
    assets: await signedPitchAssets(deck.id),
  };
}

export function pitchEditorConfig() {
  return { maximumSlides: getPitchMaxSlides() };
}

export async function createPitch(input: {
  createRequestId: string;
  ownerName: string;
  ownerEmail: string;
  ownerToken: string;
  title: string;
  document: PitchDocument;
}): Promise<PitchStoreResult<{ deck: OwnedPitchDeck; duplicate: boolean }>> {
  const created = await createPitchDeck(input);
  if (!created.ok) return created;
  return {
    ok: true,
    value: {
      deck: await ownerView(created.value.deck),
      duplicate: created.value.duplicate,
    },
  };
}

export async function readOwnedPitch(
  deckId: string,
  ownerToken: string,
): Promise<PitchStoreResult<OwnedPitchDeck>> {
  const loaded = await readOwnedPitchDeck(deckId, ownerToken);
  return loaded.ok ? { ok: true, value: await ownerView(loaded.value) } : loaded;
}

export async function syncPitch(input: {
  deckId: string;
  ownerToken: string;
  baseVersion: number;
  mutationId: string;
  title: string;
  document: PitchDocument;
}): Promise<PitchStoreResult<{ deck: OwnedPitchDeck; merged: boolean; duplicate: boolean }>> {
  const synced = await syncPitchDeck(input);
  if (!synced.ok) return synced;
  return {
    ok: true,
    value: {
      deck: await ownerView(synced.value.deck),
      merged: synced.value.merged,
      duplicate: synced.value.duplicate,
    },
  };
}

export async function publishPitch(input: {
  deckId: string;
  ownerToken: string;
  thumbnailAssetId?: string;
}): Promise<PitchStoreResult<OwnedPitchDeck>> {
  const published = await publishPitchDeck(input);
  return published.ok ? { ok: true, value: await ownerView(published.value) } : published;
}

export async function listPublishedPitches(search?: string): Promise<PublicPitchDeck[]> {
  const decks = await listPublicPitchDecks(search);
  return Promise.all(
    decks.map(async (deck) => {
      const thumbnail = deck.thumbnailUrl
        ? await signedPitchAsset(deck.id, deck.thumbnailUrl)
        : null;
      return { ...deck, thumbnailUrl: thumbnail?.url };
    }),
  );
}

export async function readPublishedPitch(deckId: string): Promise<PublicPitchDeckDetail | null> {
  const deck = await readPublicPitchDeck(deckId);
  if (!deck?.publishedDocument || !deck.publishedAt) return null;
  const referenced = new Set(
    deck.publishedDocument.slides.flatMap((slide) => [
      ...Object.values(slide.assetIds),
      ...(slide.audioAssetId ? [slide.audioAssetId] : []),
    ]),
  );
  if (deck.thumbnailAssetId) referenced.add(deck.thumbnailAssetId);
  const assets = await signedPitchAssets(deck.id, {
    assetIds: referenced,
    includeImports: false,
  });
  const thumbnail = deck.thumbnailAssetId
    ? assets.find((asset) => asset.id === deck.thumbnailAssetId)
    : undefined;
  return {
    id: deck.id,
    title: deck.title,
    ownerName: deck.ownerName,
    publishedAt: deck.publishedAt,
    updatedAt: deck.publishedAt,
    slideCount: deck.publishedDocument.slides.filter((slide) => !slide.deletedAt).length,
    thumbnailUrl: thumbnail?.url,
    document: deck.publishedDocument,
    assets,
  };
}

export async function allowPitchRecovery(ip: string, email: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return process.env.NODE_ENV !== "production";
  try {
    const key = `pitches:recover:${ip}:${email.trim().toLowerCase()}`;
    const next = await redis.incr(key);
    if (next === 1) await redis.expire(key, 60 * 60);
    return next <= 4;
  } catch (error) {
    log.warn("pitches.recovery", "Recovery rate limit unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return process.env.NODE_ENV !== "production";
  }
}

export async function recoverPitchAccess(input: {
  email: string;
  origin: string;
}): Promise<{ sent: boolean }> {
  const decks = await listPitchDecksForRecovery(input.email);
  if (decks.length === 0) return { sent: true };

  const issued = decks.map((deck) => ({
    deckId: deck.id,
    title: deck.title,
    token: createPitchOwnerToken(),
  }));
  await addPitchAccessTokens(
    issued.map(({ deckId, token }) => ({ deckId, token, label: "email recovery" })),
  );
  const delivery = await sendPitchRecoveryEmail({
    email: input.email.trim().toLowerCase(),
    origin: input.origin,
    decks: issued.map(({ deckId: id, title, token }) => ({ id, title, token })),
  });
  if (!delivery.ok) {
    await removePitchAccessTokens(issued.map(({ token }) => token));
    return { sent: false };
  }
  return { sent: true };
}

export { createPitchAssetUpload, finalisePitchAsset };

export async function cleanupExpiredPitches(limit = 100): Promise<{
  attempted: number;
  deleted: number;
  failed: number;
}> {
  const decks = await markExpiredPitchDecksDeleting(limit);
  let deleted = 0;
  let failed = 0;
  for (const deck of decks) {
    try {
      await deleteAllPitchAssets(deck.id);
      if (await hardDeletePitchDeck(deck.id)) deleted += 1;
    } catch (error) {
      failed += 1;
      log.error("pitches.cleanup", "Could not delete abandoned pitch", { deckId: deck.id }, error);
    }
  }
  return { attempted: decks.length, deleted, failed };
}

export type PitchAssetUploadInput = {
  deckId: string;
  ownerToken: string;
  fileId?: string;
  kind: PitchAssetKind;
  fileName: string;
  mimeType: string;
  bytes: number;
};
