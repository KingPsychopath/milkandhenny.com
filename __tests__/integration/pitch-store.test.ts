import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { connectPitchDecksToVerifiedPerson } from "@/features/things/pitches/identity.server";
import {
  createPitchDeck,
  createPitchOwnerToken,
  hardDeletePitchDeck,
  hashPitchValue,
  insertPitchAsset,
  issuePitchDeviceAccessForPerson,
  listPitchDecksForPerson,
  normalisePitchEmail,
  listPitchBackupsForOwner,
  listPitchEditions,
  listPublicPitchDecks,
  markExpiredPitchDecksDeleting,
  markPitchDeckDeletingForAdmin,
  readPitchBackupForOwner,
  readPitchEdition,
  markPitchAssetReady,
  publishPitchDeck,
  readOwnedPitchDeck,
  readOwnedPitchDeckStatus,
  readPublicPitchDeck,
  restorePitchBackupForOwner,
  restorePitchDeckFromTrash,
  restorePitchDeckFromTrashForOwner,
  syncPitchDeck,
} from "@/features/things/pitches/store.server";
import {
  PITCH_DOCUMENT_SCHEMA_VERSION,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
  type PitchCommandOperation,
} from "@/features/things/pitches/types";
import { query, transaction } from "@/lib/platform/postgres.server";
import { readPitchDocumentSchemaInventory, runMigrations } from "@/lib/platform/migrations.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

function element(id: string, updated: number): ExcalidrawElement {
  return {
    id,
    type: "rectangle",
    version: 1,
    versionNonce: updated,
    updated,
    isDeleted: false,
  } as ExcalidrawElement;
}

function documentWith(elements: readonly ExcalidrawElement[]): PitchDocument {
  return {
    schemaVersion: PITCH_DOCUMENT_SCHEMA_VERSION,
    slides: [
      {
        id: "slide_123456",
        name: "Slide 1",
        version: 2,
        updatedAt: 200,
        durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
        elements,
        assetIds: {},
        mediaClips: [],
      },
    ],
  };
}

function operations(id: string, sequence: number): PitchCommandOperation[] {
  return [
    {
      id,
      deviceId: "device_integration_test",
      sequence,
      kind: "element.change",
      payload: { source: "integration test" },
      occurredAt: "2026-08-23T12:00:00.000Z",
    },
  ];
}

async function createPublishedPitch(suffix: string) {
  const ownerToken = createPitchOwnerToken();
  const created = await createPitchDeck({
    createRequestId: `create_wall_${suffix}`,
    ownerName: "Alice",
    ownerEmail: "alice@example.com",
    ownerToken,
    title: `Wall pitch ${suffix}`,
    document: documentWith([]),
  });
  if (!created.ok) throw new Error(created.error);
  const saved = await syncPitchDeck({
    deckId: created.value.deck.id,
    ownerToken,
    baseVersion: 1,
    mutationId: `mutation_wall_${suffix}`,
    operations: operations(`mutation_wall_${suffix}`, 1),
    title: `Wall pitch ${suffix}`,
    document: documentWith([element(`wall_object_${suffix}`, 10)]),
  });
  if (!saved.ok) throw new Error(saved.error);
  const published = await publishPitchDeck({ deckId: created.value.deck.id, ownerToken });
  if (!published.ok) throw new Error(published.error);
  return created.value.deck.id;
}

describeWithDatabase("pitch storage (postgres)", () => {
  beforeAll(async () => {
    await applySchema();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await query("truncate pitch_decks restart identity cascade");
  });

  it("creates, saves, merges, publishes, and keeps the public edition sealed", async () => {
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "create_12345678",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      ownerToken,
      title: "First edition",
      document: documentWith([]),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const duplicate = await createPitchDeck({
      createRequestId: "create_12345678",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      ownerToken,
      title: "First edition",
      document: documentWith([]),
    });
    expect(duplicate.ok && duplicate.value.duplicate).toBe(true);

    const asset = await insertPitchAsset({
      id: "pa_1234567890123456789012",
      deckId: created.value.deck.id,
      objectKey: `pitches/${created.value.deck.id}/image/asset.png`,
      fileId: "file_123",
      kind: "image",
      fileName: "asset.png",
      mimeType: "image/png",
      bytes: 123,
    });
    expect(asset.file_id).toBe("file_123");
    expect((await markPitchAssetReady(asset.id))?.state).toBe("ready");

    const firstSave = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 1,
      mutationId: "mutation_first",
      operations: operations("mutation_first", 1),
      title: "First edition",
      document: documentWith([element("first_object", 10)]),
    });
    expect(firstSave.ok && firstSave.value.deck.draftVersion).toBe(2);
    const journal = await query<{
      operations: Array<{ kind: string }>;
      result_document: PitchDocument;
    }>(
      `select operations, result_document from pitch_commands
        where deck_id = $1 and command_id = $2`,
      [created.value.deck.id, "mutation_first"],
    );
    expect(journal[0].operations).toMatchObject([{ kind: "element.change" }]);
    expect(journal[0].result_document.slides[0].elements[0]?.id).toBe("first_object");

    const repeatedSave = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 1,
      mutationId: "mutation_first",
      operations: operations("mutation_first", 1),
      title: "First edition",
      document: documentWith([element("first_object", 10)]),
    });
    expect(repeatedSave.ok && repeatedSave.value.duplicate).toBe(true);
    expect(repeatedSave.ok && repeatedSave.value.deck.draftVersion).toBe(2);

    const staleSave = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 1,
      mutationId: "mutation_stale",
      operations: operations("mutation_stale", 2),
      title: "Merged edition",
      document: documentWith([element("second_object", 20)]),
    });
    expect(staleSave.ok && staleSave.value.merged).toBe(true);
    if (!staleSave.ok) return;
    expect(staleSave.value.deck.draftDocument.slides[0].elements.map(({ id }) => id)).toEqual([
      "second_object",
      "first_object",
    ]);

    const published = await publishPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
    });
    expect(published.ok && published.value.publishedVersion).toBe(3);

    const laterDraft = documentWith([
      element("second_object", 20),
      element("first_object", 10),
      element("draft_only_object", 30),
    ]);
    const laterSave = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 3,
      mutationId: "mutation_later",
      operations: operations("mutation_later", 3),
      title: "Later draft",
      document: laterDraft,
    });
    expect(laterSave.ok && laterSave.value.deck.draftVersion).toBe(4);

    const owned = await readOwnedPitchDeck(created.value.deck.id, ownerToken);
    expect(owned.ok && owned.value.title).toBe("Later draft");
    const publicDeck = await readPublicPitchDeck(created.value.deck.id);
    expect(publicDeck?.title).toBe("Merged edition");
    expect(publicDeck?.publishedDocument?.slides[0].elements.map(({ id }) => id)).toEqual([
      "second_object",
      "first_object",
    ]);

    const republished = await publishPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
    });
    expect(republished.ok && republished.value.currentEditionNumber).toBe(2);
    const editions = await listPitchEditions(created.value.deck.id);
    expect(editions.map((edition) => edition.editionNumber)).toEqual([2, 1]);
    expect(editions[0].document.slides[0].elements.at(-1)?.id).toBe("draft_only_object");
    const firstEdition = await readPitchEdition(created.value.deck.id, 1);
    expect(firstEdition?.document.slides[0].elements.map(({ id }) => id)).toEqual([
      "second_object",
      "first_object",
    ]);
  });

  it("keeps valid wall pitches visible when one published document is invalid", async () => {
    const validDeckId = await createPublishedPitch("valid");
    const invalidDeckId = await createPublishedPitch("invalid");
    await query(
      `update pitch_editions
          set document = jsonb_set(document, '{schemaVersion}', '3'::jsonb, true)
        where deck_id = $1`,
      [invalidDeckId],
    );

    const wall = await listPublicPitchDecks();
    expect(wall.rejectedCount).toBe(1);
    expect(wall.decks.map((deck) => deck.id)).toContain(validDeckId);
    expect(wall.decks.map((deck) => deck.id)).not.toContain(invalidDeckId);
  });

  it("repairs schema-one editions and verifies the stored schema inventory", async () => {
    const deckId = await createPublishedPitch("migration");
    const legacyDocument = {
      schemaVersion: 1,
      slides: [
        {
          id: "slide_legacy_migration",
          name: "Legacy slide",
          version: 1,
          updatedAt: 100,
          durationMs: 15_000,
          elements: [],
          assetIds: {},
          audioCues: [
            {
              id: "audio_legacy_migration",
              assetId: "pa_1234567890123456789012",
              trigger: "enter",
              delayMs: 1_000,
              sourceDurationMs: 5_000,
              startAtMs: 0,
              playForMs: 3_000,
              volume: 0.8,
              end: "slide-exit",
            },
          ],
        },
      ],
    };
    await query(`update pitch_editions set document = $2::jsonb where deck_id = $1`, [
      deckId,
      JSON.stringify(legacyDocument),
    ]);
    await query(`delete from schema_migrations where id = '0026_pitch_document_schema_contract'`);

    const migration = await runMigrations();
    expect(migration.applied).toContain("0026_pitch_document_schema_contract");
    const inventory = await readPitchDocumentSchemaInventory();
    expect(inventory.unsupported).toBe(0);
    expect(inventory.current).toBe(inventory.total);
    const edition = await readPitchEdition(deckId, 1);
    expect(edition?.document.slides[0].mediaClips).toMatchObject([
      {
        id: "audio_legacy_migration",
        kind: "audio",
        timelineStartMs: 1_000,
        durationMs: 3_000,
      },
    ]);
  });

  it("moves a pitch to recoverable Trash before purge", async () => {
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "create_trash_1234",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      ownerToken,
      title: "Recoverable pitch",
      document: documentWith([]),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const trashed = await markPitchDeckDeletingForAdmin(created.value.deck.id, "Recoverable pitch");
    expect(trashed.ok && trashed.value.lifecycle).toBe("trashed");
    expect(trashed.ok && trashed.value.purgeAfter).toBeTruthy();
    const blocked = await readOwnedPitchDeck(created.value.deck.id, ownerToken);
    expect(blocked.ok).toBe(false);

    const restored = await restorePitchDeckFromTrash(created.value.deck.id);
    expect(restored?.lifecycle).toBe("active");
    expect(restored?.purgeAfter).toBeUndefined();
    expect((await readOwnedPitchDeck(created.value.deck.id, ownerToken)).ok).toBe(true);
  });

  it("tells an owner whether the server copy is active, in Trash or gone", async () => {
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "create_status_1234",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      ownerToken,
      title: "Status pitch",
      document: documentWith([]),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const deckId = created.value.deck.id;

    expect(await readOwnedPitchDeckStatus(deckId, ownerToken)).toMatchObject({
      state: "active",
      title: "Status pitch",
    });
    expect(await readOwnedPitchDeckStatus(deckId, createPitchOwnerToken())).toMatchObject({
      state: "gone",
    });

    await markPitchDeckDeletingForAdmin(deckId, "Status pitch");
    const trashed = await readOwnedPitchDeckStatus(deckId, ownerToken);
    expect(trashed.state).toBe("trashed");
    expect(trashed.purgeAfter).toBeTruthy();

    await query(`update pitch_decks set lifecycle = 'deleting' where id = $1`, [deckId]);
    expect(await readOwnedPitchDeckStatus(deckId, ownerToken)).toMatchObject({ state: "gone" });

    expect(await hardDeletePitchDeck(deckId)).toBe(true);
    expect(await readOwnedPitchDeckStatus(deckId, ownerToken)).toMatchObject({ state: "gone" });
  });

  it("lets an owner restore their own pitch from Trash with a fresh draft clock", async () => {
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "create_owner_trash_1",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      ownerToken,
      title: "Owner restored pitch",
      document: documentWith([]),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const deckId = created.value.deck.id;

    await query(
      `update pitch_decks set draft_expires_at = now() - interval '1 hour' where id = $1`,
      [deckId],
    );
    await markExpiredPitchDecksDeleting();
    expect(await readOwnedPitchDeckStatus(deckId, ownerToken)).toMatchObject({ state: "trashed" });
    expect((await readOwnedPitchDeck(deckId, ownerToken)).ok).toBe(false);

    const stranger = await restorePitchDeckFromTrashForOwner(deckId, createPitchOwnerToken());
    expect(stranger.ok).toBe(false);

    const restored = await restorePitchDeckFromTrashForOwner(deckId, ownerToken);
    expect(restored.ok && restored.value.lifecycle).toBe("active");
    expect(restored.ok && restored.value.purgeAfter).toBeUndefined();
    // The draft clock has to move forward, or the next expiry sweep re-trashes it.
    expect(restored.ok && new Date(restored.value.draftExpiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect((await readOwnedPitchDeck(deckId, ownerToken)).ok).toBe(true);

    // Restoring an already active pitch is a no-op rather than an error.
    const again = await restorePitchDeckFromTrashForOwner(deckId, ownerToken);
    expect(again.ok).toBe(true);
  });

  it("checkpoints destructive saves and lets the owner move backward and forward", async () => {
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "create_history_123",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
      ownerToken,
      title: "Versioned pitch",
      document: documentWith([]),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const blankPublish = await publishPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
    });
    expect(blankPublish).toMatchObject({
      ok: false,
      status: 409,
      error: "Add something to a slide before publishing",
    });

    const contentful = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 1,
      mutationId: "mutation_contentful",
      operations: operations("mutation_contentful", 1),
      title: "Versioned pitch",
      document: documentWith([element("kept_object", 10)]),
    });
    expect(contentful.ok).toBe(true);
    if (!contentful.ok) return;

    const emptied = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 2,
      mutationId: "mutation_empty",
      operations: operations("mutation_empty", 2),
      title: "Versioned pitch",
      document: documentWith([]),
    });
    expect(emptied.ok).toBe(true);

    const history = await listPitchBackupsForOwner(created.value.deck.id, ownerToken);
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const contentfulVersion = history.value.find((item) => item.version === 2);
    expect(contentfulVersion).toMatchObject({ reason: "safety", contentCount: 1 });
    if (!contentfulVersion) return;

    const preview = await readPitchBackupForOwner(
      created.value.deck.id,
      ownerToken,
      contentfulVersion.id,
    );
    expect(preview.ok && preview.value.document.slides[0].elements.map(({ id }) => id)).toEqual([
      "kept_object",
    ]);

    const restored = await restorePitchBackupForOwner(
      created.value.deck.id,
      ownerToken,
      contentfulVersion.id,
    );
    expect(
      restored.ok && restored.value.draftDocument.slides[0].elements.map(({ id }) => id),
    ).toEqual(["kept_object"]);

    const forwardHistory = await listPitchBackupsForOwner(created.value.deck.id, ownerToken);
    expect(forwardHistory.ok).toBe(true);
    expect(
      forwardHistory.ok &&
        forwardHistory.value.some(
          (item) => item.version === 3 && item.reason === "restore" && item.contentCount === 0,
        ),
    ).toBe(true);
  });

  it("links email-hash pitches to a verified person and opens them per device", async () => {
    const email = "linked@example.com";
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "create_person_link_1",
      ownerName: "Linked Alice",
      ownerEmail: email,
      ownerToken,
      title: "Account pitch",
      document: documentWith([]),
    });
    if (!created.ok) throw new Error(created.error);
    const deckId = created.value.deck.id;

    const people = await query<{ id: string }>(
      `insert into event_people (canonical_name) values ('Linked Alice') returning id::text`,
    );
    const personId = people[0]!.id;
    const strangers = await query<{ id: string }>(
      `insert into event_people (canonical_name) values ('Someone Else') returning id::text`,
    );
    const strangerId = strangers[0]!.id;
    const emailHash = hashPitchValue(normalisePitchEmail(email));
    await query(
      `insert into event_person_identifiers (person_id,kind,value_hash,verified_at,email_address)
       values ($1,'email',$2,now(),$3)`,
      [personId, emailHash, email],
    );

    const linked = await transaction((client) =>
      connectPitchDecksToVerifiedPerson(client, { personId, emailHash }),
    );
    expect(linked).toBe(1);

    const owned = await listPitchDecksForPerson(personId);
    expect(owned.map((pitch) => pitch.id)).toEqual([deckId]);
    expect(await listPitchDecksForPerson(strangerId)).toEqual([]);

    const denied = await issuePitchDeviceAccessForPerson(deckId, strangerId);
    expect(denied.ok).toBe(false);

    const opened = await issuePitchDeviceAccessForPerson(deckId, personId);
    if (!opened.ok) throw new Error(opened.error);
    const readBack = await readOwnedPitchDeck(deckId, opened.value.token);
    expect(readBack.ok && readBack.value.id).toBe(deckId);

    // Re-linking is idempotent and never steals a deck already owned by a person.
    const relinked = await transaction((client) =>
      connectPitchDecksToVerifiedPerson(client, { personId: strangerId, emailHash }),
    );
    expect(relinked).toBe(0);
    expect((await listPitchDecksForPerson(personId)).map((pitch) => pitch.id)).toEqual([deckId]);
  });
});
