import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import {
  createPitchDeck,
  createPitchOwnerToken,
  insertPitchAsset,
  markPitchAssetReady,
  publishPitchDeck,
  readOwnedPitchDeck,
  readPublicPitchDeck,
  syncPitchDeck,
} from "@/features/things/pitches/store.server";
import {
  PITCH_DOCUMENT_SCHEMA_VERSION,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
} from "@/features/things/pitches/types";
import { query } from "@/lib/platform/postgres.server";
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
        audioCues: [],
      },
    ],
  };
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
      title: "First edition",
      document: documentWith([element("first_object", 10)]),
    });
    expect(firstSave.ok && firstSave.value.deck.draftVersion).toBe(2);

    const repeatedSave = await syncPitchDeck({
      deckId: created.value.deck.id,
      ownerToken,
      baseVersion: 1,
      mutationId: "mutation_first",
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
  });
});
