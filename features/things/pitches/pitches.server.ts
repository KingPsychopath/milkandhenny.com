import { getRedis } from "@/lib/platform/redis.server";
import { log } from "@/lib/platform/logger.server";
import { refreshPersonAchievements } from "@/features/achievements/achievements.server";
import {
  adminPitchAssets,
  cleanupStalePitchAssets,
  cleanupUnreferencedPitchAssets,
  createPitchAssetUpload,
  deleteAllPitchAssets,
  finalisePitchAsset,
  signedPitchAssets,
  signedPitchThumbnail,
  unavailablePitchAssetIds,
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
  listPitchBackupsForOwner,
  listPitchDecksForRecovery,
  listPitchAuditForAdmin,
  listPitchBackupsForAdmin,
  listPitchEditions,
  listPublicPitchDecks,
  listPitchDecksForPerson,
  markPitchDeckDeletingForAdmin,
  markExpiredPitchDecksDeleting,
  publishPitchDeck,
  readPitchBackupForOwner,
  prunePitchCommands,
  readOwnedPitchDeck,
  readOwnedPitchDeckStatus,
  readPitchDeckForAdmin,
  readPublicPitchDeck,
  readPitchEdition,
  recordPitchAudit,
  removePitchAccessTokens,
  issuePitchDeviceAccessForPerson,
  restorePitchBackupForAdmin,
  restorePitchBackupForOwner,
  restorePitchDeckFromTrash,
  restorePitchDeckFromTrashForOwner,
  returnPitchDeckToDraftForAdmin,
  syncPitchDeck,
  updatePitchDeckForAdmin,
  type PitchStoreResult,
  type StoredPitchDeck,
} from "./store.server";
import type {
  OwnedPitchDeck,
  PitchAssetKind,
  PitchCommandOperation,
  PitchDocument,
  PitchOwnerDeckStatus,
  PublicPitchDeck,
  PublicPitchDeckDetail,
} from "./types";

async function ownerView(
  deck: StoredPitchDeck,
  options?: { checkAssetAvailability?: boolean },
): Promise<OwnedPitchDeck> {
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
    currentEditionNumber: deck.currentEditionNumber,
    updatedAt: deck.updatedAt,
    draftExpiresAt: deck.draftExpiresAt,
    thumbnailAssetId: deck.thumbnailAssetId,
    assets: await signedPitchAssets(deck.id, {
      assetIds: referencedPitchAssetIds(deck.draftDocument),
      checkAvailability: options?.checkAssetAvailability,
    }),
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
  ownerPersonId?: string;
  title: string;
  document: PitchDocument;
  origin: string;
}): Promise<PitchStoreResult<{ deck: OwnedPitchDeck; duplicate: boolean; emailQueued: boolean }>> {
  const created = await createPitchDeck(input);
  if (!created.ok) return created;
  const delivery = await sendPitchWelcomeEmail({
    email: created.value.deck.ownerEmail,
    origin: input.origin,
    deck: created.value.deck,
    token: input.ownerToken,
  });
  if (!created.value.duplicate) {
    await recordPitchAudit({
      deckId: created.value.deck.id,
      action: delivery.ok ? "email.welcome.queued" : "email.welcome.failed",
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
      emailQueued: delivery.ok,
    },
  };
}

export { listPitchDecksForPerson };

export async function openPitchForPerson(
  deckId: string,
  personId: string,
): Promise<PitchStoreResult<{ deck: OwnedPitchDeck; token: string }>> {
  const opened = await issuePitchDeviceAccessForPerson(deckId, personId);
  if (!opened.ok) return opened;
  return {
    ok: true,
    value: { deck: await ownerView(opened.value.deck), token: opened.value.token },
  };
}

export async function readOwnedPitch(
  deckId: string,
  ownerToken: string,
): Promise<PitchStoreResult<OwnedPitchDeck>> {
  const loaded = await readOwnedPitchDeck(deckId, ownerToken);
  return loaded.ok ? { ok: true, value: await ownerView(loaded.value) } : loaded;
}

export async function readOwnedPitchStatus(
  deckId: string,
  ownerToken: string,
): Promise<PitchOwnerDeckStatus> {
  return readOwnedPitchDeckStatus(deckId, ownerToken);
}

export async function restoreOwnedPitchFromTrash(
  deckId: string,
  ownerToken: string,
): Promise<PitchStoreResult<OwnedPitchDeck>> {
  const restored = await restorePitchDeckFromTrashForOwner(deckId, ownerToken);
  return restored.ok ? { ok: true, value: await ownerView(restored.value) } : restored;
}

export async function listPitchHistory(deckId: string, ownerToken: string) {
  return listPitchBackupsForOwner(deckId, ownerToken);
}

export async function readPitchVersion(deckId: string, ownerToken: string, backupId: string) {
  return readPitchBackupForOwner(deckId, ownerToken, backupId);
}

export async function restorePitchVersion(
  deckId: string,
  ownerToken: string,
  backupId: string,
): Promise<PitchStoreResult<OwnedPitchDeck>> {
  const restored = await restorePitchBackupForOwner(deckId, ownerToken, backupId);
  return restored.ok ? { ok: true, value: await ownerView(restored.value) } : restored;
}

export async function syncPitch(input: {
  deckId: string;
  ownerToken: string;
  baseVersion: number;
  mutationId: string;
  title: string;
  document: PitchDocument;
  operations: PitchCommandOperation[];
}): Promise<PitchStoreResult<{ deck: OwnedPitchDeck; merged: boolean; duplicate: boolean }>> {
  const synced = await syncPitchDeck(input);
  if (!synced.ok) return synced;
  return {
    ok: true,
    value: {
      deck: await ownerView(synced.value.deck, { checkAssetAvailability: false }),
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
  const current = await readOwnedPitchDeck(input.deckId, input.ownerToken);
  if (!current.ok) return current;
  const referenced = referencedPitchAssetIds(current.value.draftDocument, input.thumbnailAssetId);
  const unavailable = await unavailablePitchAssetIds(input.deckId, referenced);
  if (unavailable.size > 0) {
    return {
      ok: false,
      status: 409,
      error: unavailableMediaMessage(unavailable.size),
    };
  }
  const published = await publishPitchDeck(input);
  if (!published.ok) return published;
  if (published.value.ownerPersonId) {
    await refreshPersonAchievements(published.value.ownerPersonId).catch((error) =>
      log.warn("pitches.achievement", "Pitch published but achievements could not be refreshed", {
        deckId: published.value.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  const delivery = await sendPitchPublishedEmail({
    email: published.value.ownerEmail,
    origin: input.origin,
    deck: published.value,
    token: input.ownerToken,
  });
  await recordPitchAudit({
    deckId: published.value.id,
    action: delivery.ok ? "email.published.queued" : "email.published.failed",
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

export async function listPublishedPitches(
  search?: string,
): Promise<{ pitches: PublicPitchDeck[]; rejectedCount: number }> {
  const result = await listPublicPitchDecks(search);
  const pitches = await Promise.all(
    result.decks.map(async (deck) => {
      const thumbnail = deck.thumbnailAssetId
        ? await signedPitchThumbnail(deck.id, deck.thumbnailAssetId)
        : null;
      const { thumbnailAssetId: _thumbnailAssetId, ...publicDeck } = deck;
      return { ...publicDeck, thumbnail: thumbnail ?? undefined };
    }),
  );
  return { pitches, rejectedCount: result.rejectedCount };
}

export async function readPublishedPitch(
  deckId: string,
  editionNumber?: number,
): Promise<PublicPitchDeckDetail | null> {
  const deck = await readPublicPitchDeck(deckId);
  if (!deck?.publishedDocument || !deck.publishedAt) return null;
  const edition = editionNumber ? await readPitchEdition(deckId, editionNumber) : null;
  const document = edition?.document ?? deck.publishedDocument;
  const title = edition?.title ?? deck.title;
  const ownerName = edition?.ownerName ?? deck.ownerName;
  const publishedAt = edition?.publishedAt ?? deck.publishedAt;
  const thumbnailAssetId = edition?.thumbnailAssetId ?? deck.thumbnailAssetId;
  const referenced = new Set(
    document.slides.flatMap((slide) => [
      ...Object.values(slide.assetIds),
      ...slide.mediaClips.map((clip) => clip.assetId),
    ]),
  );
  const assets = await signedPitchAssets(deck.id, {
    assetIds: referenced,
  });
  const thumbnail = thumbnailAssetId
    ? ((await signedPitchThumbnail(deck.id, thumbnailAssetId)) ?? undefined)
    : undefined;
  return {
    id: deck.id,
    title,
    ownerName,
    publishedAt,
    updatedAt: publishedAt,
    slideCount: document.slides.filter((slide) => !slide.deletedAt).length,
    thumbnail,
    document,
    assets,
    editionNumber: edition?.editionNumber ?? deck.currentEditionNumber ?? 1,
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
}): Promise<{ queued: boolean }> {
  const decks = await listPitchDecksForRecovery(input.email);
  if (decks.length === 0) return { queued: true };

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
        action: delivery.ok ? "email.recovery.queued" : "email.recovery.failed",
        actor: "system",
        metadata: delivery.ok
          ? { messageId: delivery.id }
          : { status: delivery.status, error: delivery.error },
      }).catch(() => undefined),
    ),
  );
  if (!delivery.ok) {
    await removePitchAccessTokens(issued.map(({ token }) => token));
    return { queued: false };
  }
  return { queued: true };
}

export { createPitchAssetUpload, finalisePitchAsset };

export async function cleanupExpiredPitches(limit = 100): Promise<{
  attempted: number;
  deleted: number;
  failed: number;
  commandsDeleted: number;
  staleAssets: { attempted: number; deleted: number; failed: number };
  orphanAssets: { attempted: number; deleted: number; failed: number };
}> {
  const [staleAssets, orphanAssets, commandsDeleted] = await Promise.all([
    cleanupStalePitchAssets(limit),
    cleanupUnreferencedPitchAssets(limit),
    prunePitchCommands(limit * 10),
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
  return {
    attempted: decks.length,
    deleted,
    failed,
    commandsDeleted,
    staleAssets,
    orphanAssets,
  };
}

export async function readPitchForAdmin(deckId: string) {
  const pitch = await readPitchDeckForAdmin(deckId);
  if (!pitch) return null;
  const [assets, backups, audit, editions] = await Promise.all([
    adminPitchAssets(deckId),
    listPitchBackupsForAdmin(deckId),
    listPitchAuditForAdmin(deckId),
    listPitchEditions(deckId),
  ]);
  return { pitch, assets, backups, audit, editions };
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

export async function setPitchPublicationForAdmin(
  deckId: string,
  publication: "draft" | "published",
): Promise<PitchStoreResult<StoredPitchDeck>> {
  if (publication === "published") {
    const deck = await readPitchDeckForAdmin(deckId);
    if (!deck) return { ok: false, status: 404, error: "Pitch not found" };
    const unavailable = await unavailablePitchAssetIds(
      deckId,
      referencedPitchAssetIds(deck.draftDocument),
    );
    if (unavailable.size > 0) {
      return { ok: false, status: 409, error: unavailableMediaMessage(unavailable.size) };
    }
    return publishPitchDeck({ deckId, actor: "admin" });
  }
  const pitch = await returnPitchDeckToDraftForAdmin(deckId);
  return pitch ? { ok: true, value: pitch } : { ok: false, status: 404, error: "Pitch not found" };
}

function referencedPitchAssetIds(document: PitchDocument, thumbnailAssetId?: string): Set<string> {
  return new Set([
    ...document.slides.flatMap((slide) => [
      ...Object.values(slide.assetIds),
      ...slide.mediaClips.map((clip) => clip.assetId),
    ]),
    ...(thumbnailAssetId ? [thumbnailAssetId] : []),
  ]);
}

function unavailableMediaMessage(count: number): string {
  return `${count} referenced media file${count === 1 ? " is" : "s are"} no longer available in storage. Restore a .mahdeck backup, or remove and add ${count === 1 ? "the file" : "those files"} again before publishing.`;
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
}): Promise<PitchStoreResult<{ queued: true }>> {
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
    action: delivery.ok ? "email.recovery.queued" : "email.recovery.failed",
    actor: "admin",
    metadata: delivery.ok
      ? { messageId: delivery.id }
      : { status: delivery.status, error: delivery.error },
  }).catch(() => undefined);
  if (!delivery.ok) {
    await removePitchAccessTokens([token]);
    return { ok: false, status: 502, error: "The recovery email could not be sent" };
  }
  return { ok: true, value: { queued: true } };
}

export async function deletePitchForAdmin(
  deckId: string,
  confirmation: string,
): Promise<PitchStoreResult<{ trashed: true; purgeAfter: string }>> {
  const marked = await markPitchDeckDeletingForAdmin(deckId, confirmation);
  if (!marked.ok) return marked;
  return { ok: true, value: { trashed: true, purgeAfter: marked.value.purgeAfter! } };
}

export async function restorePitchFromTrashForAdmin(
  deckId: string,
): Promise<PitchStoreResult<{ restored: true }>> {
  const restored = await restorePitchDeckFromTrash(deckId);
  return restored
    ? { ok: true, value: { restored: true } }
    : { ok: false, status: 404, error: "Pitch is not in Trash" };
}

export type PitchAssetUploadInput = {
  deckId: string;
  ownerToken: string;
  assetId?: string;
  fileId?: string;
  kind: PitchAssetKind;
  fileName: string;
  mimeType: string;
  bytes: number;
};
