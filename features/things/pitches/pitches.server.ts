import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import {
  adminPitchAssets,
  cleanupStalePitchAssets,
  createPitchAssetUpload,
  deleteAllPitchAssets,
  finalisePitchAsset,
  signedPitchAsset,
  signedPitchAssets,
} from "./assets.server";
import { getPitchMaxSlides } from "./config.server";
import {
  sendPitchPublishedEmail,
  sendPitchRecoveryEmail,
  sendPitchWelcomeEmail,
} from "./email.server";
import {
  addPitchAccessTokens,
  createPitchDeck,
  createPitchOwnerToken,
  hardDeletePitchDeck,
  listPitchDecksForRecovery,
  listPitchAuditForAdmin,
  listPitchBackupsForAdmin,
  listPublicPitchDecks,
  markPitchDeckDeletingForAdmin,
  markExpiredPitchDecksDeleting,
  publishPitchDeck,
  prunePitchMutations,
  readOwnedPitchDeck,
  readPitchDeckForAdmin,
  readPublicPitchDeck,
  recordPitchAudit,
  removePitchAccessTokens,
  restorePitchBackupForAdmin,
  syncPitchDeck,
  updatePitchDeckForAdmin,
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
  origin: string;
}): Promise<PitchStoreResult<{ deck: OwnedPitchDeck; duplicate: boolean }>> {
  const created = await createPitchDeck(input);
  if (!created.ok) return created;
  if (!created.value.duplicate) {
    const delivery = await sendPitchWelcomeEmail({
      email: created.value.deck.ownerEmail,
      origin: input.origin,
      deck: created.value.deck,
      token: input.ownerToken,
    });
    await recordPitchAudit({
      deckId: created.value.deck.id,
      action: delivery.ok ? "email.welcome.sent" : "email.welcome.failed",
      actor: "system",
      metadata: delivery.ok
        ? { messageId: delivery.id }
        : { status: delivery.status, error: delivery.error },
    }).catch((error) =>
      log.warn("pitches.email", "Could not record welcome email result", {
        deckId: created.value.deck.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
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
  origin: string;
}): Promise<PitchStoreResult<OwnedPitchDeck>> {
  const published = await publishPitchDeck(input);
  if (!published.ok) return published;
  const delivery = await sendPitchPublishedEmail({
    email: published.value.ownerEmail,
    origin: input.origin,
    deck: published.value,
    token: input.ownerToken,
  });
  await recordPitchAudit({
    deckId: published.value.id,
    action: delivery.ok ? "email.published.sent" : "email.published.failed",
    actor: "system",
    metadata: delivery.ok
      ? { messageId: delivery.id }
      : { status: delivery.status, error: delivery.error },
  }).catch((error) =>
    log.warn("pitches.email", "Could not record published email result", {
      deckId: published.value.id,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  return { ok: true, value: await ownerView(published.value) };
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
      ...slide.audioCues.map((cue) => cue.assetId),
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
  await Promise.all(
    issued.map(({ deckId }) =>
      recordPitchAudit({
        deckId,
        action: delivery.ok ? "email.recovery.sent" : "email.recovery.failed",
        actor: "system",
        metadata: delivery.ok
          ? { messageId: delivery.id }
          : { status: delivery.status, error: delivery.error },
      }).catch(() => undefined),
    ),
  );
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
  mutationsDeleted: number;
  staleAssets: { attempted: number; deleted: number; failed: number };
}> {
  const [staleAssets, mutationsDeleted] = await Promise.all([
    cleanupStalePitchAssets(limit),
    prunePitchMutations(limit * 10),
  ]);
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
  return { attempted: decks.length, deleted, failed, mutationsDeleted, staleAssets };
}

export async function readPitchForAdmin(deckId: string) {
  const pitch = await readPitchDeckForAdmin(deckId);
  if (!pitch) return null;
  const [assets, backups, audit] = await Promise.all([
    adminPitchAssets(deckId),
    listPitchBackupsForAdmin(deckId),
    listPitchAuditForAdmin(deckId),
  ]);
  return { pitch, assets, backups, audit };
}

export async function updatePitchForAdmin(input: {
  deckId: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<PitchStoreResult<StoredPitchDeck>> {
  const pitch = await updatePitchDeckForAdmin(input);
  return pitch ? { ok: true, value: pitch } : { ok: false, status: 404, error: "Pitch not found" };
}

export async function restorePitchForAdmin(
  deckId: string,
  backupId: string,
): Promise<PitchStoreResult<StoredPitchDeck>> {
  const pitch = await restorePitchBackupForAdmin(deckId, backupId);
  return pitch
    ? { ok: true, value: pitch }
    : { ok: false, status: 404, error: "Pitch backup not found" };
}

export async function resendPitchAccessForAdmin(input: {
  deckId: string;
  origin: string;
}): Promise<PitchStoreResult<{ sent: true }>> {
  const deck = await readPitchDeckForAdmin(input.deckId);
  if (!deck) return { ok: false, status: 404, error: "Pitch not found" };
  const token = createPitchOwnerToken();
  await addPitchAccessTokens([{ deckId: deck.id, token, label: "admin resend", actor: "admin" }]);
  const delivery = await sendPitchRecoveryEmail({
    email: deck.ownerEmail,
    origin: input.origin,
    decks: [{ id: deck.id, title: deck.title, token }],
  });
  await recordPitchAudit({
    deckId: deck.id,
    action: delivery.ok ? "email.recovery.sent" : "email.recovery.failed",
    actor: "admin",
    metadata: delivery.ok
      ? { messageId: delivery.id }
      : { status: delivery.status, error: delivery.error },
  }).catch(() => undefined);
  if (!delivery.ok) {
    await removePitchAccessTokens([token]);
    return { ok: false, status: 502, error: "The recovery email could not be sent" };
  }
  return { ok: true, value: { sent: true } };
}

export async function deletePitchForAdmin(
  deckId: string,
  confirmation: string,
): Promise<PitchStoreResult<{ deleted: true }>> {
  const marked = await markPitchDeckDeletingForAdmin(deckId, confirmation);
  if (!marked.ok) return marked;
  try {
    await deleteAllPitchAssets(deckId);
    if (!(await hardDeletePitchDeck(deckId))) {
      return { ok: false, status: 409, error: "Pitch deletion is already in progress" };
    }
    return { ok: true, value: { deleted: true } };
  } catch (error) {
    log.error("pitches.admin", "Could not finish pitch deletion", { deckId }, error);
    return {
      ok: false,
      status: 503,
      error: "Pitch deletion will be retried by storage cleanup",
    };
  }
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
